import type { IncomingMessage, ServerResponse } from 'node:http'
import type { BackupEngine } from './core/engine.js'
import { testBackendConfig } from './backends/index.js'
import { resolveConfig, type LikeZcodeConfig } from './config.js'

const MAX_BODY_BYTES = 256 * 1024

export function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/** 浏览器来源围栏(dsh-cli-bridge 同款):跨站 POST / DNS rebinding 防线。 */
export function assertTrustedOrigin(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  const host = req.headers.host
  let originHost = ''
  try {
    originHost = new URL(origin).host
  } catch {
    originHost = ''
  }
  if (!host || originHost !== host) {
    writeJson(res, 403, { ok: false, error: '已拒绝跨站请求(Origin 与 Host 不符)' })
    return false
  }
  const hostName = host.replace(/:\d+$/, '')
  const loopback = hostName === 'localhost' || hostName === '127.0.0.1' || hostName === '[::1]' || hostName === '::1'
  if (!loopback) {
    const sock = (req as { socket?: { localAddress?: string } }).socket
    if (!sock?.localAddress) {
      writeJson(res, 403, { ok: false, error: '请求的 Host 与本机服务地址不符,已拒绝' })
      return false
    }
  }
  return true
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer)
    size += buf.length
    if (size > MAX_BODY_BYTES) throw new Error('请求体超过 256KB 上限')
    chunks.push(buf)
  }
  if (chunks.length === 0) return {} as Record<string, unknown>
  return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>
}

/** 凭据脱敏:HTTP 响应不回传任何密钥字段。 */
export function redactConfig(cfg: LikeZcodeConfig): Record<string, unknown> {
  return {
    enabled: cfg.enabled,
    workspaces: cfg.workspaces,
    includeGit: cfg.includeGit,
    respectGitignore: cfg.respectGitignore,
    excludePatterns: cfg.excludePatterns,
    maxFileMB: cfg.maxFileMB,
    backend: cfg.backend,
    remotePrefix: cfg.remotePrefix,
    localDir: cfg.localDir,
    webdavUrl: cfg.webdavUrl,
    webdavUsername: cfg.webdavUsername,
    webdavPassword: cfg.webdavPassword ? '••••••' : '',
    s3Endpoint: cfg.s3Endpoint,
    s3Region: cfg.s3Region,
    s3Bucket: cfg.s3Bucket,
    s3AccessKeyId: cfg.s3AccessKeyId ? '••••••' : '',
    s3SecretAccessKey: cfg.s3SecretAccessKey ? '••••••' : '',
    s3PathStyle: cfg.s3PathStyle,
    maxUploadKBps: cfg.maxUploadKBps,
    concurrency: cfg.concurrency,
    scheduleMode: cfg.scheduleMode,
    intervalHours: cfg.intervalHours,
    windowStart: cfg.windowStart,
    windowEnd: cfg.windowEnd,
    encryptionEnabled: cfg.encryptionEnabled,
    passphrase: cfg.passphrase ? '••••••' : '',
    retentionRuns: cfg.retentionRuns,
  }
}

export interface RouteDeps {
  engine: BackupEngine
  getConfig(): LikeZcodeConfig
}

export function createRouteHandlers(deps: RouteDeps) {
  const { engine, getConfig } = deps

  async function statusHandler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    const status = engine.status()
    writeJson(res, 200, { ok: true, status, stateDir: engine.stateDirPath })
  }

  async function snapshotsHandler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    writeJson(res, 200, { ok: true, history: engine.history() })
  }

  async function logHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/log', 'http://localhost')
    const lines = Number(url.searchParams.get('lines') ?? 80)
    writeJson(res, 200, { ok: true, log: await engine.tailLog(lines) })
  }

  async function runHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!assertTrustedOrigin(req, res)) return
    const body = await readJsonBody(req).catch(() => ({}) as Record<string, unknown>)
    const dirs = Array.isArray(body.dirs) ? (body.dirs as unknown[]).map(String) : typeof body.dirs === 'string' ? [body.dirs] : []
    try {
      const started = await engine.start(dirs.length ? dirs : [], 'manual')
      writeJson(res, 200, { ok: true, ...started })
    } catch (err) {
      writeJson(res, 200, { ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  async function pauseHandler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!assertTrustedOrigin(_req, res)) return
    engine.pause()
    writeJson(res, 200, { ok: true })
  }

  async function resumeHandler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!assertTrustedOrigin(_req, res)) return
    engine.resume()
    writeJson(res, 200, { ok: true })
  }

  async function cancelHandler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!assertTrustedOrigin(_req, res)) return
    engine.cancel()
    writeJson(res, 200, { ok: true })
  }

  /** 连通性测试:请求体携带设置页当前的表单值(未保存也能测)。 */
  async function testHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!assertTrustedOrigin(req, res)) return
    const body = await readJsonBody(req).catch(() => ({}) as Record<string, unknown>)
    const merged = resolveConfig({ ...getConfig(), ...body })
    try {
      const message = await testBackendConfig(merged)
      writeJson(res, 200, { ok: true, message })
    } catch (err) {
      writeJson(res, 200, { ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return { statusHandler, snapshotsHandler, logHandler, runHandler, pauseHandler, resumeHandler, cancelHandler, testHandler }
}
