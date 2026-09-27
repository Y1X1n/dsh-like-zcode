import { decompressBuffer, compressBuffer, decryptBuffer, encryptBuffer, type CryptoMaterial } from './crypto.js'

export interface ManifestFile {
  p: string
  h: string
  s: number
  m: number
}

export interface SnapshotCounts {
  files: number
  bytes: number
  uploaded: number
  uploadedBytes: number
  skippedUnchanged: number
  skippedTooBig: number
  errors: number
}

export interface SnapshotManifest {
  v: 1
  id: string
  root: string
  startedAt: number
  finishedAt: number
  host: string
  enc: boolean
  counts: SnapshotCounts
  files: ManifestFile[]
  /** 本次运行中逐文件错误(截断至前 20 条)。 */
  fileErrors?: string[]
}

/** 快照 id:YYYYMMDD-HHmmss(本地时区,人类可读;同秒冲突由引擎重试自增后缀)。 */
export function snapshotId(date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
}

export function serializeManifest(m: SnapshotManifest, crypto: CryptoMaterial | null): Promise<Buffer> {
  const json = Buffer.from(JSON.stringify(m), 'utf-8')
  return compressThenSeal(json, m.files[0]?.h ?? m.id, crypto)
}

export async function parseManifest(raw: Buffer, crypto: CryptoMaterial | null): Promise<SnapshotManifest> {
  const json = await unsealThenDecompress(raw, crypto)
  const parsed = JSON.parse(json.toString('utf-8')) as SnapshotManifest
  if (parsed?.v !== 1 || !Array.isArray(parsed.files)) throw new Error('快照清单格式不符')
  return parsed
}

async function compressThenSeal(json: Buffer, ivSeed: string, crypto: CryptoMaterial | null): Promise<Buffer> {
  const gz = await compressBuffer(json)
  if (!crypto) return gz
  return encryptBuffer(crypto.key, ivSeed, gz)
}

async function unsealThenDecompress(raw: Buffer, crypto: CryptoMaterial | null): Promise<Buffer> {
  const gz = crypto ? decryptBuffer(crypto.key, raw) : raw
  return decompressBuffer(gz)
}

/** 保留策略:按 id 升序(时间序)保留最近 keep 份,返回应删除的 id。 */
export function retentionTargets(entries: { id: string }[], keep: number): string[] {
  if (entries.length <= keep) return []
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id))
  return sorted.slice(0, sorted.length - keep).map((e) => e.id)
}
