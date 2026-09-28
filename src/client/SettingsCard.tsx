import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { StatusController } from './controller.js'

/** 设置面(settingsScope.bind 的保守子集;值可能缺字段,全部按 Partial 处理)。 */
export interface LikeZcodeSettingsValue {
  enabled?: boolean
  storageLayout?: string
  workspaces?: string
  includeGit?: boolean
  respectGitignore?: boolean
  excludePatterns?: string
  maxFileMB?: number
  backend?: string
  remotePrefix?: string
  localDir?: string
  webdavUrl?: string
  webdavUsername?: string
  webdavPassword?: string
  s3Endpoint?: string
  s3Region?: string
  s3Bucket?: string
  s3AccessKeyId?: string
  s3SecretAccessKey?: string
  s3PathStyle?: boolean
  maxUploadKBps?: number
  concurrency?: number
  scheduleMode?: string
  intervalHours?: number
  windowStart?: number
  windowEnd?: number
  encryptionEnabled?: boolean
  passphrase?: string
  backupOnStartup?: boolean
  retentionRuns?: number
}

export interface BoundSettingsScope {
  subscribe(fn: () => void): () => void
  getSnapshot(): { value?: Partial<LikeZcodeSettingsValue> }
  set<K extends keyof LikeZcodeSettingsValue>(key: K, value: LikeZcodeSettingsValue[K]): Promise<void>
}

const styles = {
  card: {
    borderRadius: 10,
    border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3))',
    background: 'var(--dsw-alias-bg-layer-2, transparent)',
    color: 'var(--dsw-alias-label-primary, inherit)',
    padding: '8px 12px',
    fontSize: 12.5,
    lineHeight: 1.6,
  } as const,
  title: { fontWeight: 600, fontSize: 13 } as const,
  summary: { color: 'var(--dsw-alias-label-primary-dimmed, rgba(128,128,128,0.9))', fontSize: 11.5, flex: 1 } as const,
  desc: { color: 'var(--dsw-alias-label-primary-dimmed, rgba(128,128,128,0.9))', fontSize: 11.5, marginTop: 2 } as const,
  group: { marginTop: 8, borderTop: '1px solid var(--dsw-alias-border-l3, rgba(128,128,128,0.15))', paddingTop: 6 } as const,
  groupTitle: { fontWeight: 600, fontSize: 11.5, color: 'var(--dsw-alias-label-primary-dimmed, rgba(128,128,128,0.9))' } as const,
  fieldBlock: { marginTop: 10 } as const,
  fieldLabel: { fontSize: 11.5, color: 'var(--dsw-alias-label-primary-dimmed, rgba(128,128,128,0.9))', marginBottom: 3 } as const,
  fieldControl: { display: 'flex' } as const,
  miniRow: { display: 'flex', gap: 12, marginTop: 10 } as const,
  row: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' as const },
  label: { fontSize: 12 } as const,
  input: {
    flex: 1,
    minWidth: 140,
    borderRadius: 6,
    border: '1px solid var(--dsw-alias-border-l3, rgba(128,128,128,0.2))',
    background: 'var(--dsw-alias-bg-layer-3, transparent)',
    color: 'var(--dsw-alias-label-primary, inherit)',
    font: 'inherit',
    fontSize: 12,
    padding: '2px 8px',
  } as const,
  area: {
    flex: 1,
    minWidth: 200,
    minHeight: 48,
    borderRadius: 6,
    border: '1px solid var(--dsw-alias-border-l3, rgba(128,128,128,0.2))',
    background: 'var(--dsw-alias-bg-layer-3, transparent)',
    color: 'var(--dsw-alias-label-primary, inherit)',
    font: 'inherit',
    fontSize: 11.5,
    padding: '3px 8px',
  } as const,
  select: {
    flex: 1,
    borderRadius: 6,
    border: '1px solid var(--dsw-alias-border-l3, rgba(128,128,128,0.2))',
    background: 'var(--dsw-alias-bg-layer-2, #fff)',
    color: 'var(--dsw-alias-label-primary, inherit)',
    font: 'inherit',
    fontSize: 12,
    padding: '2px 6px',
  } as const,
  hint: { color: 'var(--dsw-alias-label-primary-dimmed, rgba(128,128,128,0.9))', fontSize: 11, marginTop: 4 } as const,
  btn: {
    borderRadius: 6,
    border: '1px solid var(--dsw-alias-border-l3, rgba(128,128,128,0.25))',
    background: 'var(--dsw-alias-bg-layer-3, transparent)',
    color: 'var(--dsw-alias-label-primary, inherit)',
    font: 'inherit',
    fontSize: 12,
    padding: '3px 10px',
    cursor: 'pointer',
  } as const,
  barOuter: {
    height: 8,
    borderRadius: 4,
    background: 'var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.2))',
    overflow: 'hidden',
    flex: 1,
  } as const,
  barInner: {
    height: '100%',
    borderRadius: 4,
    background: 'linear-gradient(90deg, #e8890c, #f6c344)',
    transition: 'width 0.4s ease',
  } as const,
  footer: { marginTop: 8, paddingTop: 6, borderTop: '1px dashed var(--dsw-alias-border-l3, rgba(128,128,128,0.2))', color: 'var(--dsw-alias-label-primary-dimmed, rgba(128,128,128,0.9))', fontSize: 10.5 } as const,
  meme: { marginTop: 4, fontStyle: 'italic', fontSize: 11 } as const,
  groupToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    width: '100%',
    border: 'none',
    background: 'transparent',
    color: 'var(--dsw-alias-label-primary, inherit)',
    font: 'inherit',
    fontSize: 11.5,
    fontWeight: 600,
    padding: '2px 0',
    cursor: 'pointer',
    textAlign: 'left',
  } as const,
  caret: { display: 'inline-block', width: 10, color: 'var(--dsw-alias-label-primary-dimmed, rgba(128,128,128,0.9))' } as const,
  cardHeader: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    width: '100%',
    border: 'none',
    background: 'transparent',
    color: 'var(--dsw-alias-label-primary, inherit)',
    font: 'inherit',
    padding: 0,
    cursor: 'pointer',
    textAlign: 'left',
  } as const,
}

const PHASE_TEXT: Record<string, string> = {
  idle: '空闲',
  scanning: '扫描中',
  uploading: '静默上传中',
  finalizing: '打包清单',
  done: '已完成',
  error: '出错',
  cancelled: '已取消',
}

const RUNNING = new Set(['scanning', 'uploading', 'finalizing'])

function humanBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(2)} GB`
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${Math.round(n)} B`
}

function fmtEta(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  if (m >= 60) return `${Math.floor(m / 60)}h${m % 60}m`
  return `${m}m${s}s`
}

// ── 可折叠配置组:展开状态存 localStorage,跨会话记住 ──────────────────────────

const GROUP_PREF_KEY = 'lz-open-groups'

function readGroupPrefs(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(GROUP_PREF_KEY) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

function CollapsibleGroup(props: { groupKey: string; title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState<boolean>(() => {
    const pref = readGroupPrefs()[props.groupKey]
    return typeof pref === 'boolean' ? pref : (props.defaultOpen ?? false)
  })
  const toggle = () => {
    setOpen((prev) => {
      const next = !prev
      try {
        const prefs = readGroupPrefs()
        prefs[props.groupKey] = next
        localStorage.setItem(GROUP_PREF_KEY, JSON.stringify(prefs))
      } catch {
        /* 存储不可用时只在本次会话内记忆 */
      }
      return next
    })
  }
  return (
    <div style={styles.group}>
      <button style={styles.groupToggle} onClick={toggle} aria-expanded={open}>
        <span style={styles.caret}>{open ? '▾' : '▸'}</span>
        {props.title}
      </button>
      {open && props.children}
    </div>
  )
}

/** 官方风格字段块:标签在上、控件通栏。 */
function FieldBlock(props: { label: string; children: ReactNode }) {
  return (
    <div style={styles.fieldBlock}>
      <div style={styles.fieldLabel}>{props.label}</div>
      <div style={styles.fieldControl}>{props.children}</div>
    </div>
  )
}

// ── 草稿输入框:输入时写本地草稿(不受状态轮询重渲染影响),防抖自动提交 ────────

interface DraftFieldProps {
  value?: string
  placeholder?: string
  onCommit(value: string): void
  password?: boolean
  multiline?: boolean
  numeric?: boolean
}

function DraftField(props: DraftFieldProps) {
  const [draft, setDraft] = useState(props.value ?? '')
  const focused = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft
  useEffect(() => {
    // 非聚焦时同步外部值(预设填充/其他端修改);聚焦中绝不覆盖用户输入
    if (!focused.current) setDraft(props.value ?? '')
  }, [props.value])
  const doCommit = () => {
    const v = draftRef.current
    if (props.numeric) {
      const parsed = Number.parseInt(v, 10)
      if (Number.isFinite(parsed)) props.onCommit(String(parsed))
    } else {
      props.onCommit(v)
    }
  }
  const scheduleCommit = () => {
    // 宿主弹窗层会吞掉 focusout(实测 blur 不回传),所以不能依赖失焦提交:
    // 变更后 700ms 防抖自动保存;blur 作为立即提交的补充,能触发就提前保存。
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      doCommit()
    }, 700)
  }
  const flushCommit = () => {
    focused.current = false
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
      doCommit()
    }
  }
  const shared = {
    style: props.multiline ? styles.area : styles.input,
    placeholder: props.placeholder,
    value: draft,
    onFocus: () => {
      focused.current = true
    },
    onChange: (e: { target: { value: string } }) => {
      const next = e.target.value
      setDraft(next)
      draftRef.current = next
      focused.current = true
      scheduleCommit()
    },
    onBlur: flushCommit,
  }
  // 卸载兜底:还有未落盘的草稿就立刻提交
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current)
        doCommit()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  if (props.multiline) return <textarea {...shared} />
  return <input type={props.password ? 'password' : 'text'} {...shared} />
}

// ── 服务商预设:选厂商 → 自动填 endpoint/region/寻址等通用字段 ────────────────

interface ProviderPreset {
  label: string
  fields: Partial<LikeZcodeSettingsValue>
  hint: string
}

const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  aliyun: {
    label: '阿里云 OSS',
    fields: {
      backend: 's3',
      s3Endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
      s3Region: 'oss-cn-hangzhou',
      s3PathStyle: true,
    },
    hint: '地域按你的 Bucket 调整(如 oss-cn-beijing);ECS 同地域可用内网端点 oss-cn-xxx-internal.aliyuncs.com 免流量费。详细步骤见 docs/BACKENDS.md。',
  },
  tencent: {
    label: '腾讯云 COS',
    fields: {
      backend: 's3',
      s3Endpoint: 'https://cos.ap-beijing.myqcloud.com',
      s3Region: 'ap-beijing',
      s3PathStyle: true,
    },
    hint: '桶名要带 APPID 后缀整体填入;SecretId 填 AccessKeyId、SecretKey 填 SecretAccessKey(腾讯的字段名反着叫)。详见 docs/BACKENDS.md。',
  },
  huawei: {
    label: '华为云 OBS',
    fields: {
      backend: 's3',
      s3Endpoint: 'https://obs.cn-north-4.myhuaweicloud.com',
      s3Region: 'cn-north-4',
      s3PathStyle: true,
    },
    hint: '地域按你的桶调整;密钥在"我的凭证 → 访问密钥"创建下载。详见 docs/BACKENDS.md。',
  },
  jdcloud: {
    label: '京东云 OSS',
    fields: {
      backend: 's3',
      s3Endpoint: 'https://s3.cn-north-1.jdcloud-oss.com',
      s3Region: 'cn-north-1',
      s3PathStyle: true,
    },
    hint: 'S3 兼容端点格式 s3.{region}.jdcloud-oss.com,以控制台"空间详情 → 兼容 S3"为准。详见 docs/BACKENDS.md。',
  },
  r2: {
    label: 'Cloudflare R2',
    fields: {
      backend: 's3',
      s3Endpoint: 'https://<账户ID>.r2.cloudflarestorage.com',
      s3Region: 'auto',
      s3PathStyle: true,
    },
    hint: 'Endpoint 里的 <账户ID> 换成 R2 概览页右侧的账户 ID;Bucket=控制台建的桶名;AccessKeyId/SecretAccessKey 在"管理 R2 API 令牌"创建(Object Read & Write,只授该桶),Secret 只显示一次。免费 10GB/月。详见 docs/BACKENDS.md。',
  },
  jianguoyun: {
    label: '坚果云',
    fields: {
      backend: 'webdav',
      webdavUrl: 'https://dav.jianguoyun.com/dav/',
    },
    hint: '用户名=注册邮箱,密码=应用密码(网页版 → 账户信息 → 安全选项);免费版每月上传 1GB。详见 docs/BACKENDS.md。',
  },
  synology: {
    label: '群晖 DSM',
    fields: {
      backend: 'webdav',
      webdavUrl: 'http://NAS局域网IP:5005',
    },
    hint: '先在套件中心安装 WebDAV Server 并启用 5005(HTTP)/5006(HTTPS);建议为备份单开一个受限账号。详见 docs/BACKENDS.md。',
  },
  ecs: {
    label: 'ECS 自建(like-zdav.py)',
    fields: {
      backend: 'webdav',
      webdavUrl: 'http://ECS公网IP:8060',
    },
    hint: '先在服务器上跑 server/like-zdav.py(两条命令,见 docs/BACKENDS.md),密码填启动时的 --token。',
  },
}

const CARD_OPEN_KEY = 'lz-card-open'

function readCardOpen(): boolean {
  try {
    const raw = localStorage.getItem(CARD_OPEN_KEY)
    if (raw === null) return true
    return raw === '1'
  } catch {
    return true
  }
}

export function createSettingsCard(scope: BoundSettingsScope, controller: StatusController) {
  return function LikeZcodeSettingsCard() {
    useSyncExternalStore((cb) => scope.subscribe(cb), () => scope.getSnapshot())
    useSyncExternalStore((cb) => controller.subscribe(cb), () => controller.getSnapshot())
    const value = scope.getSnapshot().value ?? {}
    const { status, history, error, busy, testResult } = controller.getSnapshot()
    const [runScope, setRunScope] = useState<'all' | 'dir' | 'session'>('all')
    const [runDir, setRunDir] = useState('')
    const [sessionsList, setSessionsList] = useState<import('./controller.js').SessionInfoLike[]>([])
    const [sessionsLoading, setSessionsLoading] = useState(false)
    const [selectedSessionId, setSelectedSessionId] = useState('')
    const [cardOpen, setCardOpen] = useState<boolean>(readCardOpen)
    const [preset, setPreset] = useState<string>('custom')
    const toggleCard = () => {
      setCardOpen((prev) => {
        const next = !prev
        try {
          localStorage.setItem(CARD_OPEN_KEY, next ? '1' : '0')
        } catch {
          /* 存储不可用时只在本次会话内记忆 */
        }
        return next
      })
    }
    const applyPreset = (key: string) => {
      const presetDef = PROVIDER_PRESETS[key]
      if (!presetDef) return
      for (const [field, fieldValue] of Object.entries(presetDef.fields)) {
        void scope.set(field as keyof LikeZcodeSettingsValue, fieldValue as never)
      }
    }
    const setBool = (key: 'enabled' | 'includeGit' | 'respectGitignore' | 's3PathStyle' | 'encryptionEnabled' | 'backupOnStartup') =>
      (e: { target: { checked: boolean } }) => {
        void scope.set(key, e.target.checked)
      }
    const setText = (key: 'storageLayout' | 'workspaces' | 'excludePatterns' | 'localDir' | 'webdavUrl' | 'webdavUsername' | 'webdavPassword' | 's3Endpoint' | 's3Region' | 's3Bucket' | 's3AccessKeyId' | 's3SecretAccessKey' | 'passphrase' | 'remotePrefix' | 'backend' | 'scheduleMode') =>
      (v: string) => {
        void scope.set(key, v)
      }
    const setNumber = (key: 'maxFileMB' | 'maxUploadKBps' | 'concurrency' | 'intervalHours' | 'windowStart' | 'windowEnd' | 'retentionRuns') =>
      (v: string) => {
        const n = Number.parseInt(v, 10)
        if (Number.isFinite(n)) void scope.set(key, n)
      }
    const loadSessions = () => {
      setSessionsLoading(true)
      void controller.actions
        .listSessions()
        .then((list) => {
          const usable = list.filter((s) => s.workspace)
          setSessionsList(usable)
          setSelectedSessionId((prev) => (prev && usable.some((s) => s.sessionId === prev) ? prev : (usable[0]?.sessionId ?? '')))
        })
        .finally(() => setSessionsLoading(false))
    }
    const changeRunScope = (next: 'all' | 'dir' | 'session') => {
      setRunScope(next)
      if (next === 'session' && sessionsList.length === 0) loadSessions()
    }

    const backend = value.backend ?? 'localdir'
    const mirror = value.storageLayout === 'mirror'
    const running = status ? RUNNING.has(status.phase) : false
    const run = status?.run
    const pct = run && run.bytesTotal > 0 ? Math.min(1, run.bytesDone / run.bytesTotal) : run?.phase === 'done' ? 1 : 0

    const currentFields = (): Record<string, unknown> => ({ ...value })

    const summary = status
      ? `${PHASE_TEXT[status.phase] ?? status.phase}${status.paused ? '(暂停)' : ''}${running && run ? ` · ${(pct * 100).toFixed(0)}%` : ''} · 后端 ${status.backend} · ${status.enabled ? '已启用' : '未启用'}`
      : '连接中…'

    return (
      <div style={styles.card}>
        <button style={styles.cardHeader} onClick={toggleCard} aria-expanded={cardOpen}>
          <span style={styles.caret}>{cardOpen ? '▾' : '▸'}</span>
          <span style={styles.title}>🐦‍🔥 Like ZCode 静默备份</span>
          <span style={styles.summary}>{summary}</span>
        </button>
        {cardOpen && (
          <>
        <div style={styles.desc}>
          致敬 2026-09-18「ZCode 静默备份事件」的镜像版:同样全量、同样静默、连 .git 历史都备——
          但服务器是你自己填的、开关默认关、私钥在你手里、带宽你限速。会话内零通知(梗本体),进度只在这里。
        </div>

        {error && <div style={{ ...styles.hint, color: '#e05252' }}>状态服务不可用:{error}(路由未挂载或宿主不兼容)</div>}

        {status && (
          <div style={styles.group}>
            <div style={styles.groupTitle}>实时进度(自动备份不出声,但这里看得见)</div>
            <div style={styles.row}>
              <div style={styles.barOuter}>
                <div style={{ ...styles.barInner, width: `${(pct * 100).toFixed(1)}%` }} />
              </div>
              <span style={{ fontSize: 11, minWidth: 38, textAlign: 'right' }}>{(pct * 100).toFixed(0)}%</span>
            </div>
            {run && (
              <div style={styles.hint}>
                {run.filesDone}/{run.filesTotal} 文件 · {humanBytes(run.bytesDone)}/{humanBytes(run.bytesTotal)}
                {run.phase === 'uploading' ? ` · ${humanBytes(run.speedBps)}/s · ETA ${fmtEta(run.etaSec)} · 实传 ${run.uploadedFiles} 块 · 去重跳过 ${run.skippedUnchanged}` : ''}
                {run.currentPath ? ` · ${run.currentPath}` : ''}
              </div>
            )}
            <div style={styles.meme}>{status.meme}</div>
            <div style={styles.row}>
              <span style={styles.label}>备份范围</span>
              <select
                style={styles.select}
                value={runScope}
                onChange={(e) => {
                  const next = e.target.value
                  changeRunScope(next === 'dir' ? 'dir' : next === 'session' ? 'session' : 'all')
                }}
              >
                <option value="all">全部配置目录</option>
                <option value="session">按会话(工作区)</option>
                <option value="dir">指定目录(本次)</option>
              </select>
              {runScope === 'session' &&
                (sessionsLoading ? (
                  <span style={styles.hint}>会话列表加载中…</span>
                ) : sessionsList.length === 0 ? (
                  <span style={styles.hint}>没有找到带有效工作区的会话</span>
                ) : (
                  <select
                    style={styles.select}
                    value={selectedSessionId}
                    onChange={(e) => setSelectedSessionId(e.target.value)}
                  >
                    {sessionsList.map((s) => (
                      <option key={s.sessionId} value={s.sessionId}>
                        {(s.workspace ?? '').split('\\').pop()} · {s.sessionId.slice(0, 8)} · {new Date(s.updatedAt).toLocaleString()}
                      </option>
                    ))}
                  </select>
                ))}
              {runScope === 'dir' && (
                <input
                  style={styles.input}
                  value={runDir}
                  placeholder="本次要备份的目录绝对路径"
                  onChange={(e) => setRunDir(e.target.value)}
                />
              )}
            </div>
            <div style={styles.row}>
              <button
                style={styles.btn}
                disabled={busy || running || (runScope === 'dir' && !runDir.trim()) || (runScope === 'session' && !selectedSessionId)}
                onClick={() =>
                  void controller.actions.run(
                    runScope === 'dir' && runDir.trim()
                      ? { dirs: [runDir.trim()] }
                      : runScope === 'session' && selectedSessionId
                        ? { sessionId: selectedSessionId }
                        : undefined,
                  )
                }
              >
                立即备份
              </button>
              {status.paused ? (
                <button style={styles.btn} disabled={busy || !running} onClick={() => void controller.actions.resume()}>
                  继续
                </button>
              ) : (
                <button style={styles.btn} disabled={busy || !running} onClick={() => void controller.actions.pause()}>
                  暂停
                </button>
              )}
              <button style={styles.btn} disabled={busy || !running} onClick={() => void controller.actions.cancel()}>
                取消
              </button>
              <button style={styles.btn} disabled={busy} onClick={() => void controller.actions.test(currentFields())}>
                测试连接
              </button>
            </div>
            {testResult && (
              <div style={{ ...styles.hint, color: testResult.ok ? '#3aa655' : '#e05252' }}>
                {testResult.ok ? '✓ ' : '✗ '}
                {testResult.text}
              </div>
            )}
            {history.length > 0 && (
              <div style={styles.hint}>
                最近快照:
                {history
                  .slice(0, 3)
                  .map(
                    (h) =>
                      `${h.mirror ? '镜像' : h.id}${h.sessionId ? '(会话 ' + h.sessionId.slice(0, 8) + ')' : ''}(${h.files} 文件 / 实传 ${humanBytes(h.uploadedBytes)}${h.enc ? ' · 加密' : ''}${h.cancelled ? ' · 取消' : ''})`,
                  )
                  .join(' · ')}
              </div>
            )}
            {status.nextAutoRunAt && <div style={styles.hint}>下次自动备份:{new Date(status.nextAutoRunAt).toLocaleString()}</div>}
            {status.lastError && <div style={{ ...styles.hint, color: '#e05252' }}>最近错误:{status.lastError}</div>}
            <div style={styles.hint}>只备份当前会话的工作区:在会话里输入 /backup here(自动向上归一到仓库根)。</div>
          </div>
        )}

        <CollapsibleGroup groupKey="content" title="备份内容" defaultOpen>
          <FieldBlock label="备份目录(每行一个绝对路径)">
            <DraftField
              multiline
              value={value.workspaces ?? ''}
              placeholder={'E:\\work\\project-a\nE:\\work\\project-b'}
              onCommit={setText('workspaces')}
            />
          </FieldBlock>
          <div style={styles.row}>
            <label style={styles.row}>
              <input type="checkbox" checked={value.includeGit !== false} onChange={setBool('includeGit')} />
              <span style={styles.label}>备份 .git 历史(致敬"全量")</span>
            </label>
            <label style={styles.row}>
              <input type="checkbox" checked={value.respectGitignore !== false} onChange={setBool('respectGitignore')} />
              <span style={styles.label}>尊重 .gitignore</span>
            </label>
          </div>
          <div style={styles.miniRow}>
            <div style={{ ...styles.fieldBlock, flex: 1, marginTop: 0 }}>
              <div style={styles.fieldLabel}>单文件上限(MB)</div>
              <div style={styles.fieldControl}>
                <DraftField numeric value={String(value.maxFileMB ?? 512)} onCommit={setNumber('maxFileMB')} />
              </div>
            </div>
            <div style={{ ...styles.fieldBlock, flex: 2, marginTop: 0 }}>
              <div style={styles.fieldLabel}>存储布局</div>
              <div style={styles.fieldControl}>
                <select style={styles.select} value={value.storageLayout ?? 'snapshot'} onChange={(e) => setText('storageLayout')(e.target.value)}>
                  <option value="snapshot">快照 + 去重(可回溯历史)</option>
                  <option value="mirror">源码镜像(远端直接浏览源文件)</option>
                </select>
              </div>
            </div>
          </div>
          <div style={styles.hint}>
            {mirror
              ? '源码镜像:文件按原始路径直存(远端可直接浏览),mtime 未变的文件自动跳过;不含快照历史与加密。'
              : '快照 + 去重:内容寻址存储,第二次备份近乎零上传,可回溯每一时点。'}
          </div>
          <FieldBlock label="额外排除 pattern(每行一个,gitignore 风格;node_modules 等默认已排除,可用 ! 反选救回)">
            <DraftField
              multiline
              value={value.excludePatterns ?? ''}
              onCommit={setText('excludePatterns')}
            />
          </FieldBlock>
        </CollapsibleGroup>

        <CollapsibleGroup groupKey="destination" title="备份目标(你自己的服务器;接入指南见 docs/BACKENDS.md,含 ECS 一条命令方案)">
          <FieldBlock label="服务商预设">
            <select
              style={styles.select}
              value={preset}
              onChange={(e) => {
                const key = e.target.value
                setPreset(key)
                applyPreset(key)
              }}
            >
              <option value="custom">自定义(手动填写)</option>
              {Object.entries(PROVIDER_PRESETS).map(([key, presetDef]) => (
                <option key={key} value={key}>
                  {presetDef.label}
                </option>
              ))}
            </select>
          </FieldBlock>
          {preset !== 'custom' && PROVIDER_PRESETS[preset] && (
            <div style={styles.hint}>{PROVIDER_PRESETS[preset].hint}</div>
          )}
          <div style={styles.miniRow}>
            <div style={{ ...styles.fieldBlock, flex: 1, marginTop: 0 }}>
              <div style={styles.fieldLabel}>类型</div>
              <div style={styles.fieldControl}>
                <select style={styles.select} value={backend} onChange={(e) => setText('backend')(e.target.value)}>
                  <option value="localdir">localdir(本地盘 / NAS 映射盘)</option>
                  <option value="webdav">WebDAV(群晖/威联通/坚果云/Nextcloud)</option>
                  <option value="s3">S3 兼容(阿里云OSS/腾讯COS/R2/B2/MinIO…)</option>
                </select>
              </div>
            </div>
            <div style={{ ...styles.fieldBlock, flex: 1, marginTop: 0 }}>
              <div style={styles.fieldLabel}>路径前缀</div>
              <div style={styles.fieldControl}>
                <DraftField value={value.remotePrefix ?? 'dsh-like-zcode'} onCommit={setText('remotePrefix')} />
              </div>
            </div>
          </div>
          {backend === 'localdir' && (
            <FieldBlock label="目录(可以是 NAS 的 Windows 映射盘)">
              <DraftField value={value.localDir ?? ''} placeholder="如 E:\\backups 或 Z:\\backups" onCommit={setText('localDir')} />
            </FieldBlock>
          )}
          {backend === 'webdav' && (
            <>
              <FieldBlock label="服务地址">
                <DraftField value={value.webdavUrl ?? ''} placeholder="http://nas:5005 或 https://dav.jianguoyun.com/dav/" onCommit={setText('webdavUrl')} />
              </FieldBlock>
              <div style={styles.miniRow}>
                <div style={{ ...styles.fieldBlock, flex: 1, marginTop: 0 }}>
                  <div style={styles.fieldLabel}>用户名</div>
                  <div style={styles.fieldControl}>
                    <DraftField value={value.webdavUsername ?? ''} onCommit={setText('webdavUsername')} />
                  </div>
                </div>
                <div style={{ ...styles.fieldBlock, flex: 1, marginTop: 0 }}>
                  <div style={styles.fieldLabel}>密码</div>
                  <div style={styles.fieldControl}>
                    <DraftField password value={value.webdavPassword ?? ''} placeholder={'坚果云请用"应用密码"'} onCommit={setText('webdavPassword')} />
                  </div>
                </div>
              </div>
            </>
          )}
          {backend === 's3' && (
            <>
              <div style={styles.miniRow}>
                <div style={{ ...styles.fieldBlock, flex: 2, marginTop: 0 }}>
                  <div style={styles.fieldLabel}>Endpoint</div>
                  <div style={styles.fieldControl}>
                    <DraftField value={value.s3Endpoint ?? ''} placeholder="https://oss-cn-hangzhou.aliyuncs.com" onCommit={setText('s3Endpoint')} />
                  </div>
                </div>
                <div style={{ ...styles.fieldBlock, flex: 1, marginTop: 0 }}>
                  <div style={styles.fieldLabel}>Region</div>
                  <div style={styles.fieldControl}>
                    <DraftField value={value.s3Region ?? ''} placeholder="oss-cn-hangzhou / auto" onCommit={setText('s3Region')} />
                  </div>
                </div>
              </div>
              <div style={styles.miniRow}>
                <div style={{ ...styles.fieldBlock, flex: 1, marginTop: 0 }}>
                  <div style={styles.fieldLabel}>Bucket</div>
                  <div style={styles.fieldControl}>
                    <DraftField value={value.s3Bucket ?? ''} onCommit={setText('s3Bucket')} />
                  </div>
                </div>
                <div style={{ ...styles.fieldBlock, flex: 1, marginTop: 0 }}>
                  <div style={styles.fieldLabel}>AccessKeyId</div>
                  <div style={styles.fieldControl}>
                    <DraftField value={value.s3AccessKeyId ?? ''} onCommit={setText('s3AccessKeyId')} />
                  </div>
                </div>
                <div style={{ ...styles.fieldBlock, flex: 1, marginTop: 0 }}>
                  <div style={styles.fieldLabel}>SecretAccessKey</div>
                  <div style={styles.fieldControl}>
                    <DraftField password value={value.s3SecretAccessKey ?? ''} onCommit={setText('s3SecretAccessKey')} />
                  </div>
                </div>
              </div>
              <div style={styles.row}>
                <label style={styles.row}>
                  <input type="checkbox" checked={value.s3PathStyle !== false} onChange={setBool('s3PathStyle')} />
                  <span style={styles.label}>path-style 寻址(MinIO/R2/B2 勾选;多数公有云可留勾) </span>
                </label>
              </div>
            </>
          )}
        </CollapsibleGroup>

        <CollapsibleGroup groupKey="schedule" title="限速与计划(不影响你正常上网)">
          <div style={styles.row}>
            <label style={styles.row}>
              <input type="checkbox" checked={value.backupOnStartup === true} onChange={setBool('backupOnStartup')} />
              <span style={styles.label}>每次启动 dsh 后约 45 秒自动静默备份(未变更文件自动跳过)</span>
            </label>
          </div>
          <div style={styles.miniRow}>
            <div style={{ ...styles.fieldBlock, flex: 1, marginTop: 0 }}>
              <div style={styles.fieldLabel}>限速(KB/s)</div>
              <div style={styles.fieldControl}>
                <DraftField numeric value={String(value.maxUploadKBps ?? 4096)} onCommit={setNumber('maxUploadKBps')} />
              </div>
            </div>
            <div style={{ ...styles.fieldBlock, flex: 1, marginTop: 0 }}>
              <div style={styles.fieldLabel}>并发</div>
              <div style={styles.fieldControl}>
                <DraftField numeric value={String(value.concurrency ?? 2)} onCommit={setNumber('concurrency')} />
              </div>
            </div>
            <div style={{ ...styles.fieldBlock, flex: 2, marginTop: 0 }}>
              <div style={styles.fieldLabel}>自动备份模式</div>
              <div style={styles.fieldControl}>
                <select style={styles.select} value={value.scheduleMode ?? 'manual'} onChange={(e) => setText('scheduleMode')(e.target.value)}>
                  <option value="manual">手动(只按"立即备份")</option>
                  <option value="interval">按间隔自动</option>
                  <option value="window">夜间窗口自动</option>
                </select>
              </div>
            </div>
          </div>
          {(value.scheduleMode ?? 'manual') !== 'manual' && (
            <div style={styles.miniRow}>
              <div style={{ ...styles.fieldBlock, flex: 1, marginTop: 0 }}>
                <div style={styles.fieldLabel}>间隔(小时)</div>
                <div style={styles.fieldControl}>
                  <DraftField numeric value={String(value.intervalHours ?? 24)} onCommit={setNumber('intervalHours')} />
                </div>
              </div>
              <div style={{ ...styles.fieldBlock, flex: 1, marginTop: 0 }}>
                <div style={styles.fieldLabel}>窗口起(时)</div>
                <div style={styles.fieldControl}>
                  <DraftField numeric value={String(value.windowStart ?? 2)} onCommit={setNumber('windowStart')} />
                </div>
              </div>
              <div style={{ ...styles.fieldBlock, flex: 1, marginTop: 0 }}>
                <div style={styles.fieldLabel}>窗口止(时)</div>
                <div style={styles.fieldControl}>
                  <DraftField numeric value={String(value.windowEnd ?? 7)} onCommit={setNumber('windowEnd')} />
                </div>
              </div>
            </div>
          )}
        </CollapsibleGroup>

        <CollapsibleGroup groupKey="security" title={mirror ? '加密与保留(镜像模式下不可用)' : '加密与保留(私钥永远只在你本机)'}>
          {mirror ? (
            <div style={styles.hint}>源码镜像模式按原始路径直存源文件,不做加密与快照保留;需要加密和可回溯历史请切回「快照 + 去重」布局。</div>
          ) : (
            <>
              <div style={styles.row}>
                <label style={styles.row}>
                  <input type="checkbox" checked={value.encryptionEnabled === true} onChange={setBool('encryptionEnabled')} />
                  <span style={styles.label}>端到端加密(AES-256-GCM)</span>
                </label>
              </div>
              {value.encryptionEnabled === true && (
                <FieldBlock label="加密口令(丢失无法找回;开启后建议同时更换路径前缀)">
                  <DraftField password value={value.passphrase ?? ''} onCommit={setText('passphrase')} />
                </FieldBlock>
              )}
              <FieldBlock label="保留快照份数(超出自动清理旧清单)">
                <DraftField numeric value={String(value.retentionRuns ?? 30)} onCommit={setNumber('retentionRuns')} />
              </FieldBlock>
            </>
          )}
        </CollapsibleGroup>

        <div style={styles.footer}>
          <div>
            本插件在每一个环节都由你亲手控制:服务器是你填的、开关是你开的、限速是你定的、口令只有你有。
            我们没有"默认开启",也永远不会上传到任何你不知道的地方。
          </div>
          <div style={{ marginTop: 2 }}>
            致敬 2026-09-18 · 42,411 files · 313MB · 564 uploads · Repo Wiki —— 下一次,数据应该在用户手里。🐦‍🔥
          </div>
        </div>
          </>
        )}
      </div>
    )
  }
}
