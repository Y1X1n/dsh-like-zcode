import { access, copyFile, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { BackupBackend, RemoteEntry } from './types.js'
import type { BackendKind } from '../config.js'

/**
 * localdir 后端:本地目录 / 移动硬盘 / U 盘 / Windows 映射盘(自动覆盖
 * SMB/CIFS 直连的 NAS 场景——把 NAS 共享映射成 Z:\ 即可)。
 */
export class LocalDirBackend implements BackupBackend {
  readonly kind: BackendKind = 'localdir'
  private readonly base: string

  constructor(dir: string, prefix: string) {
    this.base = join(dir, prefix)
  }

  async init(): Promise<void> {
    await mkdir(join(this.base, 'blobs'), { recursive: true })
    await mkdir(join(this.base, 'snapshots'), { recursive: true })
    await writeFile(
      join(this.base, 'meta.json'),
      JSON.stringify({
        plugin: 'dsh-like-zcode',
        kind: 'localdir',
        note: '此目录由 dsh-like-zcode 创建:用户本人主动开启并知情。别学 ZCode。',
        createdAt: new Date().toISOString(),
      }, null, 1),
      'utf-8',
    )
  }

  private blobPath(hash: string): string {
    return join(this.base, 'blobs', hash.slice(0, 2), hash)
  }

  private manifestPath(id: string): string {
    return join(this.base, 'snapshots', `${id}.json.gz`)
  }

  async hasBlob(hash: string): Promise<boolean> {
    try {
      await access(this.blobPath(hash))
      return true
    } catch {
      return false
    }
  }

  async putBlob(hash: string, filePath: string, size: number): Promise<void> {
    void size
    const dest = this.blobPath(hash)
    await mkdir(dirname(dest), { recursive: true })
    const tmp = `${dest}.tmp-${Date.now()}`
    await copyFile(filePath, tmp)
    await rm(dest, { force: true })
    // rename 才是原子的;Windows 上 rename 到已存在目标会失败,先清后改
    await rename(tmp, dest)
  }

  async getBlob(hash: string): Promise<Buffer> {
    return readFile(this.blobPath(hash))
  }

  async putManifest(id: string, data: Buffer): Promise<void> {
    await mkdir(join(this.base, 'snapshots'), { recursive: true })
    await writeFile(this.manifestPath(id), data)
  }

  async listManifests(): Promise<RemoteEntry[]> {
    let names: string[]
    try {
      names = await readdir(join(this.base, 'snapshots'))
    } catch {
      return []
    }
    const out: RemoteEntry[] = []
    for (const name of names) {
      const m = /^([0-9]{8}-[0-9]{6}(?:-\d+)?)\.json\.gz$/.exec(name)
      if (!m?.[1]) continue
      try {
        const st = await stat(join(this.base, 'snapshots', name))
        out.push({ id: m[1], size: st.size, lastModified: st.mtimeMs })
      } catch {
        /* 竞态删除,忽略 */
      }
    }
    return out
  }

  async getManifest(id: string): Promise<Buffer> {
    return readFile(this.manifestPath(id))
  }

  async deleteObject(key: string): Promise<void> {
    await rm(join(this.base, key), { force: true })
  }

  async putKeyMeta(data: Buffer): Promise<void> {
    await writeFile(join(this.base, 'keymeta.json'), data)
  }

  async getKeyMeta(): Promise<Buffer | null> {
    try {
      return await readFile(join(this.base, 'keymeta.json'))
    } catch {
      return null
    }
  }

  async test(): Promise<string> {
    const probe = join(this.base, '.probe')
    await mkdir(this.base, { recursive: true })
    await writeFile(probe, 'like-zcode probe')
    await unlink(probe)
    return `本地目录可用:${this.base}`
  }

  async probeLatency(): Promise<number | null> {
    return null
  }
}
