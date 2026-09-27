import { LocalDirBackend } from './localdir.js'
import { WebDavBackend } from './webdav.js'
import { S3Backend } from './s3.js'
import type { BackupBackend } from './types.js'
import { normalizeBackend, type LikeZcodeConfig } from '../config.js'

export * from './types.js'

export function createBackend(cfg: LikeZcodeConfig): BackupBackend {
  const kind = normalizeBackend(cfg.backend)
  const prefix = (cfg.remotePrefix || 'dsh-like-zcode').replace(/^[\\/]+|[\\/]+$/g, '')
  switch (kind) {
    case 'webdav':
      return new WebDavBackend(cfg.webdavUrl, cfg.webdavUsername, cfg.webdavPassword, prefix)
    case 's3':
      return new S3Backend(
        {
          endpoint: cfg.s3Endpoint,
          region: cfg.s3Region,
          bucket: cfg.s3Bucket,
          accessKeyId: cfg.s3AccessKeyId,
          secretAccessKey: cfg.s3SecretAccessKey,
          pathStyle: cfg.s3PathStyle,
        },
        prefix,
      )
    default:
      return new LocalDirBackend(cfg.localDir, prefix)
  }
}

/** 连通性测试(设置页按钮):只读探测,不落任何数据。 */
export async function testBackendConfig(cfg: LikeZcodeConfig): Promise<string> {
  const backend = createBackend(cfg)
  return backend.test()
}
