import Schema from '@deepseek-ai/schemastery'

/**
 * 插件配置。schema 用宽松 string 承载枚举(设置文档持久化在 ~/.dsh/settings.yaml,
 * 严格 union 撞上旧值会让整个命名空间注册失败)——使用处用 normalize* 归一化。
 */
export interface LikeZcodeConfig {
  /** 总闸:默认 false。不开就不动一个字节——这一点和某个叫 ZCode 的不一样。 */
  enabled: boolean
  /** 备份目录清单,每行一个绝对路径。 */
  workspaces: string
  /** 备份 .git 版本历史(致敬"全量",不过这次落在你自己手里)。 */
  includeGit: boolean
  /** 尊重各仓库根目录的 .gitignore(节点:排除规则仍始终生效)。 */
  respectGitignore: boolean
  /** 额外排除,每行一个 gitignore 风格 pattern(支持 ! 重新包含)。 */
  excludePatterns: string
  /** 单文件大小上限(MB),超限跳过并记录。 */
  maxFileMB: number

  /** localdir | webdav | s3(宽松 string,运行时归一化)。 */
  backend: string
  /** 远端路径前缀(同一路径下以目录区分插件数据)。 */
  remotePrefix: string

  localDir: string
  webdavUrl: string
  webdavUsername: string
  webdavPassword: string
  s3Endpoint: string
  s3Region: string
  s3Bucket: string
  s3AccessKeyId: string
  s3SecretAccessKey: string
  s3PathStyle: boolean

  /** 全局上传限速(KB/s)——保你正常上网,564 次上传也不许挤爆宽带。 */
  maxUploadKBps: number
  /** 并发上传数。 */
  concurrency: number
  /** manual | interval | window(宽松 string,运行时归一化)。 */
  scheduleMode: string
  /** interval 模式的间隔(小时);window 模式下的最小间隔同样用它。 */
  intervalHours: number
  /** window 模式起始小时(0-23)。 */
  windowStart: number
  /** window 模式结束小时(0-23,可小于 start 表示跨零点)。 */
  windowEnd: number

  /** 端到端加密(AES-256-GCM,私钥只在你本机)。 */
  encryptionEnabled: boolean
  passphrase: string
  /** 保留最近 N 份快照清单,超出清理(内容块跨快照去重共享)。 */
  retentionRuns: number
}

export const NS = 'like-zcode'

export type BackendKind = 'localdir' | 'webdav' | 's3'
export type ScheduleMode = 'manual' | 'interval' | 'window'

export const ConfigSchema: Schema<LikeZcodeConfig> = Schema.object({
  enabled: Schema.boolean().default(false).description('总开关(默认关;开启前请先配好目标并点"测试连接")'),
  workspaces: Schema.string().default('').description('备份目录,每行一个绝对路径(如 E:\\work\\project-a)'),
  includeGit: Schema.boolean().default(true).description('备份 .git 版本历史(致敬"全量",这次在你自己手里)'),
  respectGitignore: Schema.boolean().default(true).description('尊重仓库根目录 .gitignore'),
  excludePatterns: Schema.string().default('').description('额外排除 pattern(每行一个,gitignore 风格,支持 ! 反选)'),
  maxFileMB: Schema.number().min(1).max(4096).default(512).description('单文件上限(MB),超限跳过'),

  backend: Schema.string().default('localdir').description('备份目标类型:localdir(本地/映射盘)· webdav(NAS/坚果云)· s3(云厂商)'),
  remotePrefix: Schema.string().default('dsh-like-zcode').description('远端路径前缀'),

  localDir: Schema.string().default('').description('localdir:备份到该目录(可以是 NAS 的 Windows 映射盘,如 Z:\\backups)'),
  webdavUrl: Schema.string().default('').description('webdav:服务地址(如 http://nas:5005 或 https://dav.jianguoyun.com/dav/)'),
  webdavUsername: Schema.string().default('').description('webdav:用户名(坚果云用账号,密码用"应用密码")'),
  webdavPassword: Schema.string().default('').description('webdav:密码'),
  s3Endpoint: Schema.string().default('').description('s3:Endpoint(如 https://oss-cn-hangzhou.aliyuncs.com)'),
  s3Region: Schema.string().default('').description('s3:Region(如 oss-cn-hangzhou / ap-beijing / auto)'),
  s3Bucket: Schema.string().default('').description('s3:Bucket 名'),
  s3AccessKeyId: Schema.string().default('').description('s3:AccessKeyId'),
  s3SecretAccessKey: Schema.string().default('').description('s3:SecretAccessKey'),
  s3PathStyle: Schema.boolean().default(true).description('s3:path-style 寻址(MinIO/R2/B2 用 true;部分厂商用虚拟主机式 false)'),

  maxUploadKBps: Schema.number().min(64).max(1_048_576).default(4096).description('上传限速(KB/s)——不影响正常网络'),
  concurrency: Schema.number().min(1).max(8).default(2).description('并发上传数'),
  scheduleMode: Schema.string().default('manual').description('自动备份:manual(只手动)· interval(按间隔)· window(夜间窗口)'),
  intervalHours: Schema.number().min(1).max(720).default(24).description('自动备份最小间隔(小时)'),
  windowStart: Schema.number().min(0).max(23).default(2).description('夜间窗口开始(时)'),
  windowEnd: Schema.number().min(0).max(23).default(7).description('夜间窗口结束(时)'),

  encryptionEnabled: Schema.boolean().default(false).description('端到端加密 AES-256-GCM(私钥只在你本机;开启后建议同时更换 remotePrefix)'),
  passphrase: Schema.string().default('').description('加密口令(丢失无法找回——我们学不到"私钥存云端"的先进经验)'),
  retentionRuns: Schema.number().min(3).max(365).default(30).description('保留快照份数'),
})

export function normalizeBackend(value: unknown): BackendKind {
  if (value === 'webdav' || value === 's3') return value
  return 'localdir'
}

export function normalizeScheduleMode(value: unknown): ScheduleMode {
  if (value === 'interval' || value === 'window') return value
  return 'manual'
}

/** 解析多行目录清单:去空行/注释,去重复(大小写不敏感,Windows 路径特点)。 */
export function parseWorkspaces(value: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of String(value ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const key = line.replace(/[\\/]+$/, '').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(line.replace(/[\\/]+$/, ''))
  }
  return out
}

/** 运行时补齐默认值:cordis.patch.yml 的 insert 不携带 config 时,loader 传来空对象。 */
export function resolveConfig(input: unknown): LikeZcodeConfig {
  return (ConfigSchema as unknown as (v: unknown) => LikeZcodeConfig)(input ?? {})
}
