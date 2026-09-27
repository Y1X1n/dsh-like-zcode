import { createHash, createHmac } from 'node:crypto'
import { open, readFile } from 'node:fs/promises'
import type { BackupBackend, RemoteEntry } from './types.js'
import type { BackendKind } from '../config.js'

const MULTIPART_THRESHOLD = 32 * 1024 * 1024
const PART_SIZE = 16 * 1024 * 1024

export interface S3Options {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  pathStyle: boolean
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

function sha256HexBuf(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/** AWS 风格 key 编码:逐段 RFC3986(我们自己的 key 只含 [a-z0-9/.\-],稳)。导出供测试。 */
export function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

/** 规范化查询串:按 key 名排序后逐项编码(导出供测试)。 */
export function canonicalQuery(params: { k: string; v: string }[]): { encoded: string; canonical: string } {
  const enc = (s: string) => encodeURIComponent(s)
  const sorted = [...params].sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
  const pairs = sorted.map((p) => ({ k: enc(p.k), v: enc(p.v) }))
  return {
    encoded: pairs.map((p) => `${p.k}=${p.v}`).join('&'),
    canonical: pairs.map((p) => `${p.k}=${p.v}`).join('&'),
  }
}

/**
 * S3 兼容后端(SigV4 手写,零依赖):阿里云 OSS / 腾讯云 COS / 七牛 Kodo /
 * 华为 OBS / Cloudflare R2 / Backblaze B2 / MinIO / AWS S3 ……
 */
export class S3Backend implements BackupBackend {
  readonly kind: BackendKind = 's3'
  private readonly opts: S3Options
  private readonly origin: string
  private readonly host: string

  constructor(opts: S3Options, prefix: string) {
    const endpoint = opts.endpoint.trim().replace(/\/+$/, '')
    const withScheme = /^https?:\/\//.test(endpoint) ? endpoint : `https://${endpoint}`
    const url = new URL(withScheme)
    this.origin = url.origin
    this.host = url.host
    this.opts = { ...opts, region: opts.region.trim() || 'us-east-1', pathStyle: opts.pathStyle !== false, bucket: opts.bucket.trim() }
    this.prefix = prefix.split('/').filter(Boolean).join('/')
  }

  private readonly prefix: string

  private urlFor(key: string, query: { k: string; v: string }[]): { url: string; canonicalUri: string; host: string } {
    const encKey = encodeKey(this.prefix ? `${this.prefix}/${key}` : key)
    const { encoded } = canonicalQuery(query)
    if (this.opts.pathStyle) {
      const canonicalUri = `/${this.opts.bucket}/${encKey}`
      return { url: `${this.origin}${canonicalUri}${encoded ? `?${encoded}` : ''}`, canonicalUri, host: this.host }
    }
    const host = `${this.opts.bucket.toLowerCase()}.${this.host}`
    return { url: `https://${host}/${encKey}${encoded ? `?${encoded}` : ''}`, canonicalUri: `/${encKey}`, host }
  }

  private sign(method: string, canonicalUri: string, query: { k: string; v: string }[], host: string, payloadHash: string, headers: Record<string, string>): Record<string, string> {
    const now = new Date()
    const p = (n: number, w = 2) => String(n).padStart(w, '0')
    const amzDate = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}T${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}Z`
    const dateStamp = amzDate.slice(0, 8)
    const region = this.opts.region

    const extra = { ...headers }
    delete extra.authorization
    const headerNames = new Set(['host', ...Object.keys(extra).map((h) => h.toLowerCase()), 'x-amz-content-sha256', 'x-amz-date'])
    const signedHeaders = [...headerNames].sort().join(';')
    const headerMap: Record<string, string> = { ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k.toLowerCase(), String(v).trim()])), 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate }
    headerMap.host = host

    const canonicalHeaders = signedHeaders.split(';').map((name) => `${name}:${headerMap[name] ?? ''}\n`).join('')
    const { canonical } = canonicalQuery(query)
    const canonicalRequest = [method, canonicalUri, canonical, canonicalHeaders, signedHeaders, payloadHash].join('\n')
    const scope = `${dateStamp}/${region}/s3/aws4_request`
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256HexBuf(Buffer.from(canonicalRequest, 'utf-8'))].join('\n')
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.opts.secretAccessKey}`, dateStamp), region), 's3'), 'aws4_request')
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
    return {
      ...extra,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      authorization: `AWS4-HMAC-SHA256 Credential=${this.opts.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    }
  }

  private async request(
    method: string,
    key: string,
    init?: { query?: { k: string; v: string }[]; body?: Buffer; headers?: Record<string, string>; payloadHash?: string; timeoutMs?: number },
  ): Promise<Response> {
    const { url, canonicalUri, host } = this.urlFor(key, init?.query ?? [])
    const payloadHash = init?.payloadHash ?? (init?.body ? sha256HexBuf(init.body) : 'UNSIGNED-PAYLOAD')
    const signed = this.sign(method, canonicalUri, init?.query ?? [], host, payloadHash, init?.headers ?? {})
    return fetch(url, {
      method,
      headers: signed,
      body: init?.body ? new Uint8Array(init.body) : undefined,
      signal: init?.timeoutMs && init.timeoutMs > 0 ? AbortSignal.timeout(init.timeoutMs) : undefined,
    })
  }

  private static async assertOk(res: Response, what: string): Promise<void> {
    if (res.status >= 200 && res.status < 300) return
    const text = await res.text().catch(() => '')
    throw new Error(`S3 ${what} → ${res.status} ${text.slice(0, 300)}`)
  }

  async init(): Promise<void> {
    await S3Backend.assertOk(
      await this.request('PUT', 'meta.json', {
        body: Buffer.from(JSON.stringify({
          plugin: 'dsh-like-zcode',
          kind: 's3',
          note: '此 bucket 前缀由 dsh-like-zcode 写入:用户本人主动开启并知情。别学 ZCode。',
          createdAt: new Date().toISOString(),
        })),
        timeoutMs: 30_000,
      }),
      '写 meta.json',
    )
  }

  private blobKey(hash: string): string {
    return `blobs/${hash.slice(0, 2)}/${hash}`
  }

  async hasBlob(hash: string): Promise<boolean> {
    const res = await this.request('HEAD', this.blobKey(hash), { timeoutMs: 20_000 })
    if (res.status === 200) return true
    if (res.status === 404) return false
    await S3Backend.assertOk(res, `HEAD blob ${hash.slice(0, 8)}`)
    return true
  }

  async putBlob(hash: string, filePath: string, size: number): Promise<void> {
    if (size <= MULTIPART_THRESHOLD) {
      const body = await readFile(filePath)
      await S3Backend.assertOk(
        await this.request('PUT', this.blobKey(hash), {
          body,
          headers: { 'content-type': 'application/octet-stream' },
          timeoutMs: 600_000,
        }),
        `PUT blob ${hash.slice(0, 8)}`,
      )
      return
    }
    await this.uploadMultipart(this.blobKey(hash), filePath, size)
  }

  /** multipart:>32MB 的大块(典型:.git packfile),16MB 分片,峰值内存 ~2×16MB。 */
  private async uploadMultipart(key: string, filePath: string, size: number): Promise<void> {
    const createRes = await this.request('POST', key, { query: [{ k: 'uploads', v: '' }], timeoutMs: 60_000 })
    await S3Backend.assertOk(createRes, `创建 multipart ${key.slice(0, 8)}`)
    const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(await createRes.text())?.[1]
    if (!uploadId) throw new Error('S3 multipart 响应缺少 UploadId')

    const parts: { partNumber: number; etag: string }[] = []
    try {
      const fh = await open(filePath, 'r')
      try {
        const partCount = Math.ceil(size / PART_SIZE)
        for (let i = 0; i < partCount; i++) {
          const buf = Buffer.alloc(Math.min(PART_SIZE, size - i * PART_SIZE))
          const { bytesRead } = await fh.read(buf, 0, buf.length, i * PART_SIZE)
          const part = buf.subarray(0, bytesRead)
          const putRes = await this.request('PUT', key, {
            query: [
              { k: 'partNumber', v: String(i + 1) },
              { k: 'uploadId', v: uploadId },
            ],
            body: part,
            headers: { 'content-type': 'application/octet-stream' },
            timeoutMs: 600_000,
          })
          await S3Backend.assertOk(putRes, `上传分片 ${i + 1}/${partCount}`)
          const etag = putRes.headers.get('etag') ?? ''
          if (!etag) throw new Error(`分片 ${i + 1} 响应缺少 ETag`)
          parts.push({ partNumber: i + 1, etag })
        }
      } finally {
        await fh.close()
      }
      const completeXml = `<CompleteMultipartUpload>${parts
        .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`)
        .join('')}</CompleteMultipartUpload>`
      const completeRes = await this.request('POST', key, {
        query: [{ k: 'uploadId', v: uploadId }],
        body: Buffer.from(completeXml, 'utf-8'),
        timeoutMs: 120_000,
      })
      // 个别实现对已完成请求返回 200 + 错误体(惰性竞态),校验关键字段
      const text = await completeRes.text()
      if (completeRes.status < 200 || completeRes.status >= 300 || /<Error>/i.test(text)) {
        throw new Error(`S3 完成 multipart → ${completeRes.status} ${text.slice(0, 300)}`)
      }
    } catch (err) {
      await this.request('DELETE', key, { query: [{ k: 'uploadId', v: uploadId }], timeoutMs: 30_000 }).catch(() => undefined)
      throw err
    }
  }

  async getBlob(hash: string): Promise<Buffer> {
    const res = await this.request('GET', this.blobKey(hash), { timeoutMs: 120_000 })
    if (res.status === 404) throw new Error(`S3 GET blob ${hash.slice(0, 8)} → 404`)
    await S3Backend.assertOk(res, `GET blob ${hash.slice(0, 8)}`)
    return Buffer.from(await res.arrayBuffer())
  }

  async putManifest(id: string, data: Buffer): Promise<void> {
    await S3Backend.assertOk(
      await this.request('PUT', `snapshots/${id}.json.gz`, {
        body: data,
        headers: { 'content-type': 'application/gzip' },
        timeoutMs: 120_000,
      }),
      'PUT manifest',
    )
  }

  async listManifests(): Promise<RemoteEntry[]> {
    const prefix = this.prefix ? `${this.prefix}/snapshots/` : 'snapshots/'
    const res = await this.request('GET', '', {
      query: [
        { k: 'list-type', v: '2' },
        { k: 'max-keys', v: '1000' },
        { k: 'prefix', v: prefix },
      ],
      timeoutMs: 30_000,
    })
    await S3Backend.assertOk(res, '列举快照')
    const xml = await res.text()
    const out: RemoteEntry[] = []
    const items = xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? []
    for (const item of items) {
      const fullKey = /<Key>([\s\S]*?)<\/Key>/.exec(item)?.[1] ?? ''
      const m = /([0-9]{8}-[0-9]{6}(?:-\d+)?)\.json\.gz$/.exec(fullKey)
      if (!m?.[1]) continue
      const size = Number(/<Size>(\d+)<\/Size>/.exec(item)?.[1] ?? 0)
      const lm = /<LastModified>([\s\S]*?)<\/LastModified>/.exec(item)?.[1]
      out.push({ id: m[1], size, lastModified: lm ? Date.parse(lm) || 0 : 0 })
    }
    return out
  }

  async getManifest(id: string): Promise<Buffer> {
    const res = await this.request('GET', `snapshots/${id}.json.gz`, { timeoutMs: 120_000 })
    if (res.status === 404) throw new Error(`S3 GET manifest ${id} → 404`)
    await S3Backend.assertOk(res, `GET manifest ${id}`)
    return Buffer.from(await res.arrayBuffer())
  }

  async deleteObject(key: string): Promise<void> {
    await this.request('DELETE', key, { timeoutMs: 30_000 }).catch(() => undefined)
  }

  async putKeyMeta(data: Buffer): Promise<void> {
    await S3Backend.assertOk(await this.request('PUT', 'keymeta.json', { body: data, timeoutMs: 30_000 }), 'PUT keymeta')
  }

  async getKeyMeta(): Promise<Buffer | null> {
    const res = await this.request('GET', 'keymeta.json', { timeoutMs: 30_000 })
    if (res.status === 404) return null
    await S3Backend.assertOk(res, 'GET keymeta')
    return Buffer.from(await res.arrayBuffer())
  }

  async test(): Promise<string> {
    const res = await this.request('HEAD', '', { timeoutMs: 30_000 })
    if (res.status === 200) {
      return `S3 兼容端点可用:${this.opts.bucket} @ ${this.opts.endpoint}(region ${this.opts.region},${this.opts.pathStyle ? 'path-style' : 'virtual-host'})`
    }
    const detail = await res.text().catch(() => '')
    throw new Error(`S3 HEAD bucket → ${res.status} ${detail.slice(0, 200)}`)
  }

  async probeLatency(): Promise<number | null> {
    const t0 = Date.now()
    try {
      const res = await this.request('HEAD', 'meta.json', { timeoutMs: 8_000 })
      await res.arrayBuffer().catch(() => undefined)
      return res.status === 200 || res.status === 404 ? Date.now() - t0 : null
    } catch {
      return null
    }
  }
}
