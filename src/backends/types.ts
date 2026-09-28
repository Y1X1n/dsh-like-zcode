import type { BackendKind } from '../config.js'

export interface RemoteEntry {
  id: string
  size: number
  lastModified: number
}

export interface BackupBackend {
  kind: BackendKind
  /** 建目录骨架 / 写 meta.json(幂等)。mirror 布局只写标记,不建 blobs/snapshots。 */
  init(layout?: 'snapshot' | 'mirror'): Promise<void>
  /** 内容块是否存在(按明文内容哈希寻址)。 */
  hasBlob(hash: string): Promise<boolean>
  /** 上传内容块:filePath 是已变换(gzip[+加密])的暂存文件。 */
  putBlob(hash: string, filePath: string, size: number): Promise<void>
  /** 源码镜像模式:按原始相对路径('/' 分隔)原样存储文件。 */
  putObject(relKey: string, filePath: string, size: number): Promise<void>
  /** 读取内容块(还原/测试用;仅限小块)。 */
  getBlob(hash: string): Promise<Buffer>
  putManifest(id: string, data: Buffer): Promise<void>
  listManifests(): Promise<RemoteEntry[]>
  getManifest(id: string): Promise<Buffer>
  /** 删除相对 key('blobs/..' | 'snapshots/..')——保留策略清理用。 */
  deleteObject(key: string): Promise<void>
  putKeyMeta(data: Buffer): Promise<void>
  getKeyMeta(): Promise<Buffer | null>
  /** 连通性测试(设置页"测试连接")。返回人类可读结果;失败抛错。 */
  test(): Promise<string>
  /** 轻量延迟探测(ms);不适用返回 null(如 localdir)。 */
  probeLatency(): Promise<number | null>
}
