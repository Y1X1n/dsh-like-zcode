import { createHash, createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, type CipherGCM } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { appendFile, writeFile } from 'node:fs/promises'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip, gzip, gunzip, gzipSync } from 'node:zlib'
import { promisify } from 'node:util'

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/** 流式哈希大文件(不整读进内存)。 */
export function hashFile(absPath: string): Promise<{ hash: string; size: number }> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    let size = 0
    const stream = createReadStream(absPath, { highWaterMark: 1024 * 1024 })
    stream.on('data', (chunk: string | Buffer) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      size += buf.length
      h.update(buf)
    })
    stream.on('error', reject)
    stream.on('end', () => resolve({ hash: h.digest('hex'), size }))
  })
}

// ── 加密(可选):AES-256-GCM,收敛 IV 保证同内容同密文,去重不受影响 ───────────

export interface CryptoMaterial {
  key: Buffer
  saltHex: string
}

export function makeSalt(): string {
  return randomBytes(16).toString('hex')
}

export function deriveKey(passphrase: string, saltHex: string): Buffer {
  // N=2^15/r=8 需要 32MB 工作内存,超过 Node 默认 maxmem(32MB)——显式放宽
  return scryptSync(passphrase, Buffer.from(saltHex, 'hex'), 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
}

/** 口令校验令牌(存 keymeta.json;不含密钥本身)。 */
export function checkToken(key: Buffer): string {
  return createHmac('sha256', key).update('like-zcode-check').digest('hex')
}

export function verifyPassphrase(key: Buffer, storedCheck: string): boolean {
  const a = Buffer.from(checkToken(key))
  const b = Buffer.from(String(storedCheck ?? ''))
  return a.length === b.length && a.equals(b)
}

/** 收敛 IV:同一(密钥, 内容)恒定 → 同内容同密文 → 内容寻址去重成立。 */
export function ivFor(key: Buffer, plainHash: string): Buffer {
  return createHmac('sha256', key).update(`iv:${plainHash}`).digest().subarray(0, 12)
}

/** 存储格式:[version=1][12B IV][ciphertext][16B tag]。 */
export function encryptBuffer(key: Buffer, plainHash: string, plain: Buffer): Buffer {
  const iv = ivFor(key, plainHash)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([1]), iv, enc, tag])
}

export function decryptBuffer(key: Buffer, stored: Buffer): Buffer {
  if (stored.length < 1 + 12 + 16 || stored[0] !== 1) throw new Error('密文格式不符')
  const iv = stored.subarray(1, 13)
  const tag = stored.subarray(stored.length - 16)
  const body = stored.subarray(13, stored.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()])
}

// ── 存储变换:gzip(默认) → [AES-GCM(可选)] ────────────────────────────────────

export async function compressBuffer(plain: Buffer): Promise<Buffer> {
  // 小数据走同步(免一次微任务往返);大数据走异步 API 让事件循环喘口气。
  // zlib.gzip 头部 MTIME 恒为 0(Node 实现),同输入恒同输出 → 内容寻址稳定。
  if (plain.length > 8 * 1024 * 1024) return (await gzipAsync(plain, { level: 6 })) as Buffer
  return gzipSync(plain, { level: 6 })
}

export async function decompressBuffer(stored: Buffer): Promise<Buffer> {
  return (await gunzipAsync(stored)) as Buffer
}

/**
 * 流式变换:源文件 → gzip → [AES-256-GCM] → 暂存文件。
 * 常量内存(约 2MB),数 GB 的 .git packfile 也不会撑爆进程。
 * 加密时头部为 [version=1][12B IV],尾部追加 16B auth tag——与 encryptBuffer
 * 的字节布局完全一致,任何密文产物都能用 decryptBuffer 统一解开。
 * 返回存储体大小与存储体哈希(签名、断点校验用)。
 */
export async function transformFileToFile(
  src: string,
  dest: string,
  crypto: CryptoMaterial | null,
  plainHash: string,
): Promise<{ storedSize: number; storedHash: string }> {
  const storedHash = createHash('sha256')
  let storedSize = 0
  const meter = new Transform({
    transform(chunk: Buffer, _enc: string, cb: (err: Error | null, data?: Buffer) => void) {
      storedSize += chunk.length
      storedHash.update(chunk)
      cb(null, chunk)
    },
  })
  const source = createReadStream(src, { highWaterMark: 1024 * 1024 })
  const out = createWriteStream(dest)
  const gzipStream = createGzip({ level: 6 })

  let cipher: CipherGCM | null = null
  let ivHeader: Buffer | null = null
  const chain: (NodeJS.ReadableStream | NodeJS.WritableStream)[] = [source, gzipStream]
  if (crypto) {
    const iv = ivFor(crypto.key, plainHash)
    cipher = createCipheriv('aes-256-gcm', crypto.key, iv)
    ivHeader = Buffer.concat([Buffer.from([1]), iv])
    chain.push(cipher)
  }
  chain.push(meter, out)
  if (cipher && ivHeader) {
    await new Promise<void>((resolve, reject) => {
      out.on('error', reject)
      out.write(ivHeader, (err) => (err ? reject(err) : resolve()))
    })
    storedSize += ivHeader.length
  }
  // @ts-expect-error -- pipeline 的重载对异构 ReadWriteStream 数组收窄不佳,运行时形态正确
  await pipeline(...chain)
  if (cipher) {
    const tag = cipher.getAuthTag()
    await writeFile(dest, tag, { flag: 'a' })
    storedSize += tag.length
  }
  return { storedSize, storedHash: storedHash.digest('hex') }
}

/** 逆向:存储块 → 明文缓冲(还原/测试用;仅限小块)。 */
export async function restoreStoredToBuffer(stored: Buffer, crypto: CryptoMaterial | null): Promise<Buffer> {
  const gz = crypto ? decryptBuffer(crypto.key, stored) : stored
  return decompressBuffer(gz)
}

/** 随机字节(测试用)。 */
export function randomId(bytes = 8): string {
  return randomBytes(bytes).toString('hex')
}
