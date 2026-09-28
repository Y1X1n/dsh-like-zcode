import { createReadStream } from 'node:fs'
import type { BackupBackend, RemoteEntry } from './types.js'
import type { BackendKind } from '../config.js'

interface WebDavRequestInit {
  body?: unknown
  headers?: Record<string, string>
  /** 0 = 不限时(大块上传)。 */
  timeoutMs?: number
}

/**
 * WebDAV 后端:群晖/威联通 NAS(WebDAV Server 套件)、坚果云、Nextcloud、
 * Alist、InfiniCloud 等。零依赖,fetch + 递归 MKCOL 兜底各级目录。
 */
export class WebDavBackend implements BackupBackend {
  readonly kind: BackendKind = 'webdav'
  private readonly base: string
  private readonly auth: string | null

  constructor(url: string, username: string, password: string, prefix: string) {
    const cleaned = url.trim().replace(/\/+$/, '')
    this.base = `${cleaned}/${prefix.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`
    this.auth = username ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` : null
  }

  private request(method: string, path: string, init?: WebDavRequestInit): Promise<Response> {
    const headers: Record<string, string> = { ...(init?.headers ?? {}) }
    if (this.auth) headers.authorization = this.auth
    const timeoutMs = init?.timeoutMs ?? 30_000
    const body = init?.body as RequestInit['body']
    const isStreamBody = Boolean(body) && typeof body !== 'string' && !(body instanceof Uint8Array) && typeof (body as { pipe?: unknown }).pipe === 'function'
    return fetch(`${this.base}${path}`, {
      method,
      headers,
      body,
      // @ts-expect-error -- Node fetch 的 duplex 选项未进 RequestInit 类型
      duplex: isStreamBody ? 'half' : undefined,
      signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
    })
  }

  private static isOk(status: number): boolean {
    return status >= 200 && status < 300
  }

  /** 逐级 MKCOL(nginx/Apache 的 dav 都不自动建父目录)。 */
  private async mkdirp(dirPath: string): Promise<void> {
    const segments = dirPath.split('/').filter(Boolean)
    let current = ''
    for (const seg of segments) {
      current += `/${seg}`
      const res = await this.request('MKCOL', current).catch((err) => {
        throw new Error(`WebDAV MKCOL ${current} 失败:${err instanceof Error ? err.message : String(err)}`)
      })
      // 405 = 已存在;301 = 路径规范化;5xx 中 507 空间不足照抛
      if (!WebDavBackend.isOk(res.status) && res.status !== 405 && res.status !== 301) {
        const body = await res.text().catch(() => '')
        if (res.status >= 500) throw new Error(`WebDAV MKCOL ${current} → ${res.status} ${body.slice(0, 200)}`)
      }
    }
  }

  async init(layout: 'snapshot' | 'mirror' = 'snapshot'): Promise<void> {
    if (layout === 'snapshot') {
      await this.mkdirp('/blobs')
      await this.mkdirp('/snapshots')
    }
    try {
      await this.request('PUT', '/meta.json', { body: JSON.stringify({
        plugin: 'dsh-like-zcode',
        kind: 'webdav',
        note: '此目录由 dsh-like-zcode 创建:用户本人主动开启并知情。别学 ZCode。',
        createdAt: new Date().toISOString(),
      }), headers: { 'content-type': 'application/json' }, timeoutMs: 20_000 })
    } catch {
      /* 标记文件可选(镜像模式下前缀目录可能尚未创建,putObject 时会自动建) */
    }
  }

  private blobPath(hash: string): string {
    return `/blobs/${hash.slice(0, 2)}/${hash}`
  }

  async hasBlob(hash: string): Promise<boolean> {
    const res = await this.request('HEAD', this.blobPath(hash), { timeoutMs: 15_000 })
    if (WebDavBackend.isOk(res.status)) return true
    if (res.status === 404 || res.status === 409) return false
    // 个别实现 HEAD 不支持:退回 GET range 探测
    if (res.status === 405) {
      const get = await this.request('GET', this.blobPath(hash), { headers: { range: 'bytes=0-0' }, timeoutMs: 15_000 })
      return WebDavBackend.isOk(get.status) || get.status === 206
    }
    throw new Error(`WebDAV HEAD → ${res.status}`)
  }

  async putBlob(hash: string, filePath: string, size: number): Promise<void> {
    await this.putObject(`blobs/${hash.slice(0, 2)}/${hash}`, filePath, size)
  }

  async putObject(relKey: string, filePath: string, size: number): Promise<void> {
    const dir = relKey.split('/').slice(0, -1).join('/')
    if (dir) await this.mkdirp(`/${dir}`)
    const key = `/${relKey.split('/').map(encodeURIComponent).join('/')}`
    // 同名覆盖:先删(WebDAV 对覆盖 PUT 行为不一,删了再传最稳)
    await this.request('DELETE', key, { timeoutMs: 15_000 }).catch(() => undefined)
    const body = createReadStream(filePath)
    const res = await this.request('PUT', key, {
      body: body as unknown as WebDavRequestInit['body'],
      headers: { 'content-length': String(size), 'content-type': 'application/octet-stream' },
      timeoutMs: 0,
    })
    if (!WebDavBackend.isOk(res.status)) {
      const text = await res.text().catch(() => '')
      throw new Error(`WebDAV PUT ${relKey} → ${res.status} ${text.slice(0, 200)}`)
    }
  }

  async getBlob(hash: string): Promise<Buffer> {
    const res = await this.request('GET', this.blobPath(hash), { timeoutMs: 60_000 })
    if (!WebDavBackend.isOk(res.status)) throw new Error(`WebDAV GET blob → ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }

  async putManifest(id: string, data: Buffer): Promise<void> {
    await this.mkdirp('/snapshots')
    const res = await this.request('PUT', `/snapshots/${encodeURIComponent(id)}.json.gz`, {
      body: new Uint8Array(data),
      headers: { 'content-length': String(data.length), 'content-type': 'application/gzip' },
    })
    if (!WebDavBackend.isOk(res.status)) throw new Error(`WebDAV PUT manifest → ${res.status}`)
  }

  async listManifests(): Promise<RemoteEntry[]> {
    const res = await this.request('PROPFIND', '/snapshots/', {
      headers: { depth: '1', 'content-type': 'application/xml' },
      body: '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:getcontentlength/><D:getlastmodified/></D:prop></D:propfind>',
    }).catch(async () =>
      // 部分服务器要求尾斜杠,有的又拒绝:双形态各试一次
      this.request('PROPFIND', '/snapshots', {
        headers: { depth: '1' },
        body: '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop/></D:propfind>',
      }),
    )
    if (res.status === 404) return []
    if (!WebDavBackend.isOk(res.status) && res.status !== 207) throw new Error(`WebDAV PROPFIND → ${res.status}`)
    const xml = await res.text()
    const out: RemoteEntry[] = []
    const responses = xml.match(/<(?:[\w-]+:)?response\b[\s\S]*?<\/(?:[\w-]+:)?response>/g) ?? []
    for (const block of responses) {
      const href = /<(?:[\w-]+:)?href>\s*([^<]+?)\s*<\/(?:[\w-]+:)?href>/.exec(block)?.[1] ?? ''
      const file = decodeURIComponent(href.split('/').pop() ?? '')
      const m = /^([0-9]{8}-[0-9]{6}(?:-\d+)?)\.json\.gz$/.exec(file)
      if (!m?.[1]) continue
      const size = Number(/<(?:[\w-]+:)?getcontentlength>\s*(\d+)\s*<\/(?:[\w-]+:)?getcontentlength>/.exec(block)?.[1] ?? 0)
      const lm = /<(?:[\w-]+:)?getlastmodified>\s*([^<]+?)\s*<\/(?:[\w-]+:)?getlastmodified>/.exec(block)?.[1]
      out.push({ id: m[1], size, lastModified: lm ? Date.parse(lm) || 0 : 0 })
    }
    return out
  }

  async getManifest(id: string): Promise<Buffer> {
    const res = await this.request('GET', `/snapshots/${encodeURIComponent(id)}.json.gz`, { timeoutMs: 60_000 })
    if (!WebDavBackend.isOk(res.status)) throw new Error(`WebDAV GET manifest → ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }

  async deleteObject(key: string): Promise<void> {
    await this.request('DELETE', `/${key.split('/').map(encodeURIComponent).join('/')}`, { timeoutMs: 20_000 }).catch(() => undefined)
  }

  async putKeyMeta(data: Buffer): Promise<void> {
    const res = await this.request('PUT', '/keymeta.json', {
      body: new Uint8Array(data),
      headers: { 'content-length': String(data.length) },
    })
    if (!WebDavBackend.isOk(res.status)) throw new Error(`WebDAV PUT keymeta → ${res.status}`)
  }

  async getKeyMeta(): Promise<Buffer | null> {
    const res = await this.request('GET', '/keymeta.json', { timeoutMs: 20_000 })
    if (res.status === 404) return null
    if (!WebDavBackend.isOk(res.status)) return null
    return Buffer.from(await res.arrayBuffer())
  }

  async test(): Promise<string> {
    const res = await this.request('PROPFIND', '/', { headers: { depth: '0' }, body: '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop/></D:propfind>' })
    if (WebDavBackend.isOk(res.status) || res.status === 207) return `WebDAV 可达:${this.base}`
    throw new Error(`WebDAV PROPFIND → ${res.status}(检查地址/账号/密码/应用密码)`)
  }

  async probeLatency(): Promise<number | null> {
    const t0 = Date.now()
    try {
      const res = await this.request('PROPFIND', '/', {
        headers: { depth: '0' },
        body: '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop/></D:propfind>',
        timeoutMs: 8_000,
      })
      await res.arrayBuffer().catch(() => undefined)
      return WebDavBackend.isOk(res.status) || res.status === 207 || res.status === 404 ? Date.now() - t0 : null
    } catch {
      return null
    }
  }
}
