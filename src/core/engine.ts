import { hostname } from 'node:os'
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { normalizeBackend, normalizeScheduleMode, parseWorkspaces, type LikeZcodeConfig } from '../config.js'
import { createBackend } from '../backends/index.js'
import type { BackupBackend } from '../backends/types.js'
import { StateStore, emptyProgress, type HistoryEntry, type RunProgress } from '../state.js'
import { deriveKey, hashFile, makeSalt, checkToken, verifyPassphrase, transformFileToFile, type CryptoMaterial } from './crypto.js'
import { retentionTargets, serializeManifest, snapshotId, type ManifestFile, type SnapshotManifest } from './manifest.js'
import { scanRoot, type ScannedFile } from './scanner.js'
import { TokenBucket, inWindow } from './throttle.js'

const MEMES: Record<string, string[]> = {
  idle: [
    '待命。ZCode 都替你着急了,但我们还是等你先点"启用"。',
    '空闲中。你不说,我们一个字节都不动——这叫尊重。',
    '静默待机。同样的安静,不一样的是:服务器是你填的。',
  ],
  scanning: ['正在盘点全量代码库(致敬 42,411 个文件)……', '扫描中。这次连 .git 历史也备,但备到你自己的服务器。'],
  uploading: ['上传中,令牌桶限速保护你的网速(564 次上传?不存在的)。', '静默上传中……前端看不见,只有设置页知道。'],
  finalizing: ['打包快照清单……', '写清单 + 应用保留策略,马上好。'],
  done: ['完成。数据已落在你自己的服务器上,私钥(如果开了加密)在你手里。', '快照完成。用后即焚?不,用后即存。'],
  error: ['出错了——详情在日志里,绝不静默吞掉错误。'],
  cancelled: ['已取消。cancel 是用户的权利,也是本插件的第一原则。'],
}

export interface EngineStatus {
  configured: boolean
  enabled: boolean
  backend: string
  phase: RunProgress['phase']
  paused: boolean
  run: RunProgress
  lastRun: HistoryEntry | null
  nextAutoRunAt: number | null
  lastError: string | null
  meme: string
}

interface ActiveRun {
  runId: string
  roots: string[]
  trigger: 'manual' | 'auto'
  abort: AbortController
  paused: boolean
  pauseWaiters: (() => void)[]
  progress: RunProgress
  bucket: TokenBucket
  currentRootIndex: number
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message))
}

function pickMeme(phase: string): string {
  const pool = MEMES[phase] ?? MEMES.idle ?? ['']
  return pool[Math.floor(Date.now() / 60_000) % pool.length] ?? ''
}

/** 后端身份(去重索引/密钥元数据按它分文件):kind + 目标 + 前缀。 */
export function backendKeyFor(cfg: LikeZcodeConfig): string {
  const kind = normalizeBackend(cfg.backend)
  const dest =
    kind === 'localdir' ? cfg.localDir : kind === 'webdav' ? cfg.webdavUrl : `${cfg.s3Endpoint}|${cfg.s3Bucket}|${cfg.s3Region}`
  return createHash('sha256').update(`${kind}|${dest.trim().toLowerCase()}|${cfg.remotePrefix}`).digest('hex').slice(0, 16)
}

export class BackupEngine {
  private readonly getConfig: () => LikeZcodeConfig
  private readonly store: StateStore
  private run: ActiveRun | null = null
  private lastError: string | null = null
  private knownLoadedFor: string | null = null
  private known: Map<string, number> = new Map()
  private knownDirty = false
  private latencyFactor = 1

  constructor(getConfig: () => LikeZcodeConfig, stateDirPath: string) {
    this.getConfig = getConfig
    this.store = new StateStore(stateDirPath)
    void this.store.load()
  }

  get stateDirPath(): string {
    return this.store.dir
  }

  history(): HistoryEntry[] {
    return this.store.history
  }

  tailLog(lines: number): Promise<string> {
    return this.store.tailLog(Math.min(500, Math.max(1, lines)))
  }

  status(): EngineStatus {
    const cfg = this.getConfig()
    const phase = this.run?.progress.phase ?? this.store.progress.phase ?? 'idle'
    return {
      configured: parseWorkspaces(cfg.workspaces).length > 0 && this.isDestinationConfigured(cfg),
      enabled: cfg.enabled === true,
      backend: normalizeBackend(cfg.backend),
      phase,
      paused: this.run?.paused ?? false,
      run: this.run?.progress ?? this.store.progress,
      lastRun: this.store.history[0] ?? null,
      nextAutoRunAt: this.nextAutoRunAt(),
      lastError: this.lastError,
      meme: pickMeme(phase === 'uploading' && this.run ? 'uploading' : phase),
    }
  }

  private isDestinationConfigured(cfg: LikeZcodeConfig): boolean {
    switch (normalizeBackend(cfg.backend)) {
      case 'webdav':
        return Boolean(cfg.webdavUrl?.trim())
      case 's3':
        return Boolean(cfg.s3Endpoint?.trim() && cfg.s3Bucket?.trim() && cfg.s3AccessKeyId?.trim())
      default:
        return Boolean(cfg.localDir?.trim())
    }
  }

  /** 下一次自动备份时间(interval/window;manual/未启用为 null)。 */
  private nextAutoRunAt(): number | null {
    const cfg = this.getConfig()
    if (!cfg.enabled || normalizeScheduleMode(cfg.scheduleMode) === 'manual') return null
    const last = this.store.history[0]?.finishedAt ?? null
    const intervalMs = Math.max(1, cfg.intervalHours) * 3600_000
    let next = last ? last + intervalMs : Date.now() + 15_000
    if (normalizeScheduleMode(cfg.scheduleMode) === 'window') {
      const now = new Date()
      if (!inWindow(now.getHours(), cfg.windowStart, cfg.windowEnd)) {
        const at = new Date(now)
        at.setMinutes(0, 0, 0)
        at.setHours(cfg.windowStart)
        if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1)
        next = Math.max(next, at.getTime())
      }
    }
    return next
  }

  // ── 手动/自动触发 ──────────────────────────────────────────────────────────

  async start(roots: string[], trigger: 'manual' | 'auto' = 'manual'): Promise<{ runId: string; roots: string[] }> {
    if (this.run) throw new Error('已有备份在进行中(去设置页看进度)')
    // 空清单兜底:调用方没给目录时回退到配置里的 workspaces
    const cfgNow = this.getConfig()
    const valid = (roots.length ? roots : parseWorkspaces(cfgNow.workspaces)).filter(Boolean)
    if (!valid.length) throw new Error('没有可备份的目录:先在设置里填写 workspaces(每行一个绝对路径)')
    const cfg = this.getConfig()
    if (!this.isDestinationConfigured(cfg)) throw new Error('备份目标未配置:先选择后端并填写地址/凭据,再点"测试连接"')

    const runId = `${snapshotId()}-${randomBytes(2).toString('hex')}`
    const bucket = new TokenBucket(Math.max(64, cfg.maxUploadKBps) * 1024)
    this.speedSample = null
    this.latencyFactor = 1
    this.run = {
      runId,
      roots: valid,
      trigger,
      abort: new AbortController(),
      paused: false,
      pauseWaiters: [],
      bucket,
      currentRootIndex: 0,
      progress: { ...emptyProgress(), phase: 'scanning', runId, startedAt: Date.now(), message: `准备备份 ${valid.length} 个目录` },
    }
    this.lastError = null
    this.store.progress = this.run.progress
    this.store.log(`run ${runId} start(trigger=${trigger}) roots=${JSON.stringify(valid)}`)
    void this.saveProgressNow()

    // 异步执行:调用方(命令/路由)立即返回 runId,进度走轮询
    void this.executeRun().catch((err) => {
      this.store.log(`run ${runId} crashed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
    })
    return { runId, roots: valid }
  }

  pause(): void {
    if (!this.run || this.run.paused) return
    this.run.paused = true
    this.run.progress.message = '已暂停(用户操作;ZCode 可不会问你)'
    void this.saveProgressNow()
  }

  resume(): void {
    if (!this.run || !this.run.paused) return
    this.run.paused = false
    const waiters = this.run.pauseWaiters
    this.run.pauseWaiters = []
    waiters.forEach((fn) => fn())
    this.run.progress.message = '继续上传'
    void this.saveProgressNow()
  }

  cancel(): void {
    if (!this.run) return
    this.run.progress.message = '取消中……'
    this.run.abort.abort()
    this.resume() // 唤醒可能在暂停中等待的 worker
  }

  stop(): void {
    this.cancel()
  }

  private waitWhilePaused(run: ActiveRun): Promise<void> {
    if (!run.paused) return Promise.resolve()
    return new Promise((resolve) => run.pauseWaiters.push(resolve))
  }

  private async saveProgressNow(): Promise<void> {
    if (this.run) this.store.progress = this.run.progress
    await this.store.saveProgress(true)
  }

  // ── 主流程 ────────────────────────────────────────────────────────────────

  private async executeRun(): Promise<void> {
    const run = this.run
    if (!run) return
    const cfg = this.getConfig()
    const startedAll = Date.now()
    let encUsed = false
    try {
      const backend = createBackend(cfg)
      await backend.init()
      const crypto = await this.ensureCrypto(backend, cfg)
      encUsed = crypto !== null
      await this.loadKnown(backendKeyFor(cfg))

      const totals = { files: 0, bytes: 0, uploaded: 0, uploadedBytes: 0, skipped: 0, tooBig: 0, errors: 0 }
      const historyEntries: HistoryEntry[] = []

      for (let i = 0; i < run.roots.length; i++) {
        if (run.abort.signal.aborted) break
        run.currentRootIndex = i
        const entry = await this.backupOneRoot(run, cfg, backend, crypto, run.roots[i], totals)
        if (entry) historyEntries.push(entry)
      }

      if (run.abort.signal.aborted) {
        run.progress.phase = 'cancelled'
        run.progress.finishedAt = Date.now()
        run.progress.message = '已取消(部分进度已保留,下次续传近乎免费——内容寻址的好处)'
        for (const entry of historyEntries) await this.store.addHistory({ ...entry, cancelled: true })
        this.store.log(`run ${run.runId} cancelled`)
      } else {
        run.progress.phase = 'done'
        run.progress.finishedAt = Date.now()
        run.progress.etaSec = 0
        run.progress.speedBps = 0
        run.progress.message = `完成:${totals.files} 个文件 / ${(totals.bytes / 1048576).toFixed(1)} MB,本次实传 ${totals.uploaded} 块`
        for (const entry of historyEntries) await this.store.addHistory(entry)
        this.store.log(`run ${run.runId} done in ${((Date.now() - startedAll) / 1000).toFixed(1)}s · ${JSON.stringify(totals)} · enc=${encUsed}`)
      }
      if (this.knownDirty) await this.saveKnown()
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err)
      run.progress.phase = 'error'
      run.progress.finishedAt = Date.now()
      run.progress.message = `失败:${this.lastError}`
      this.store.log(`run ${run.runId} error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
    } finally {
      this.run = null
      await this.saveProgressNow()
    }
  }

  /** 单个根目录 → 一份快照清单 + 返回历史条目(取消时无清单)。 */
  private async backupOneRoot(
    run: ActiveRun,
    cfg: LikeZcodeConfig,
    backend: BackupBackend,
    crypto: CryptoMaterial | null,
    root: string,
    totals: { files: number; bytes: number; uploaded: number; uploadedBytes: number; skipped: number; tooBig: number; errors: number },
  ): Promise<HistoryEntry | null> {
    const startedAt = Date.now()
    run.progress.phase = 'scanning'
    run.progress.dir = root
    run.progress.message = `扫描 ${root}`
    await this.saveProgressNow()

    const scan = await scanRoot(root, {
      includeGit: cfg.includeGit,
      respectGitignore: cfg.respectGitignore,
      excludePatterns: String(cfg.excludePatterns ?? '').split(/\r?\n/),
      maxFileBytes: Math.max(1, cfg.maxFileMB) * 1024 * 1024,
      onProgress: (found) => {
        run.progress.filesTotal = found
        run.progress.message = `扫描 ${root}:${found} 个文件`
      },
    })
    if (run.abort.signal.aborted) return null

    run.progress.phase = 'uploading'
    run.progress.filesTotal = scan.files.length
    run.progress.bytesTotal = scan.bytesTotal
    run.progress.skippedTooBig = scan.tooBig.length
    run.progress.message = `上传 ${root}:${scan.files.length} 个文件(${(scan.bytesTotal / 1048576).toFixed(1)} MB)`
    await this.saveProgressNow()

    const hashes = new Map<string, string>()
    const counts = { uploaded: 0, uploadedBytes: 0, skipped: 0, tooBig: scan.tooBig.length, errors: 0 }
    const fileErrors: string[] = []
    const stagingDir = await mkdtemp(join(tmpdir(), 'like-zcode-'))
    const maxFileBytes = Math.max(1, cfg.maxFileMB) * 1024 * 1024
    // 自适应退避:周期性探测后端 RTT,延迟升高自动降速(不挤占正常网络)
    const probeTimer = setInterval(() => {
      void backend.probeLatency?.().then((ms) => {
        if (ms === null) return
        this.latencyFactor = ms < 300 ? 1 : ms < 1000 ? 0.5 : 0.25
        run.bucket.setRate(Math.max(64, cfg.maxUploadKBps) * 1024 * this.latencyFactor)
      })
    }, 45_000)

    const files = [...scan.files]
    const concurrency = Math.min(4, Math.max(1, cfg.concurrency))
    const worker = async (): Promise<void> => {
      for (;;) {
        if (run.abort.signal.aborted) return
        await this.waitWhilePaused(run)
        const file = files.shift()
        if (!file) return
        try {
          const outcome = await this.processFile(run, cfg, backend, crypto, file, hashes, stagingDir, maxFileBytes)
          counts.uploaded += outcome.uploaded ? 1 : 0
          counts.uploadedBytes += outcome.storedSize
          if (!outcome.uploaded) counts.skipped++
        } catch (err) {
          if (isAbortError(err)) return
          counts.errors++
          if (fileErrors.length < 20) fileErrors.push(`${file.relPath}: ${err instanceof Error ? err.message : String(err)}`)
        } finally {
          run.progress.filesDone++
          run.progress.uploadedFiles = counts.uploaded
          run.progress.uploadedBytes = counts.uploadedBytes
          run.progress.skippedUnchanged = counts.skipped
          run.progress.errorCount = counts.errors
          run.progress.skippedTooBig = counts.tooBig
          await this.store.saveProgress()
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()))
    clearInterval(probeTimer)
    await rm(stagingDir, { recursive: true, force: true })
    if (run.abort.signal.aborted) return null

    run.progress.phase = 'finalizing'
    run.progress.message = `写快照清单(${hashes.size} 个文件)`
    await this.saveProgressNow()

    const id = await this.uniqueSnapshotId(backend)
    const manifest: SnapshotManifest = {
      v: 1,
      id,
      root,
      startedAt,
      finishedAt: Date.now(),
      host: hostname(),
      enc: crypto !== null,
      counts: {
        files: scan.files.length,
        bytes: scan.bytesTotal,
        uploaded: counts.uploaded,
        uploadedBytes: counts.uploadedBytes,
        skippedUnchanged: counts.skipped,
        skippedTooBig: counts.tooBig,
        errors: counts.errors,
      },
      files: scan.files.map((f) => ({ p: f.relPath, h: hashes.get(f.relPath) ?? '', s: f.size, m: f.mtimeMs })),
      fileErrors: fileErrors.length ? fileErrors : undefined,
    }
    await backend.putManifest(id, await serializeManifest(manifest, crypto))

    // 保留策略:清掉超出份数的旧清单(内容块跨快照共享,不删)
    const manifests = await backend.listManifests()
    for (const stale of retentionTargets(manifests, Math.max(3, cfg.retentionRuns))) {
      await backend.deleteObject(`snapshots/${stale}.json.gz`).catch(() => undefined)
    }

    totals.files += scan.files.length
    totals.bytes += scan.bytesTotal
    totals.uploaded += counts.uploaded
    totals.uploadedBytes += counts.uploadedBytes
    totals.skipped += counts.skipped
    totals.tooBig += counts.tooBig
    totals.errors += counts.errors

    run.progress.bytesTotal = totals.bytes
    run.progress.bytesDone = totals.bytes
    run.progress.currentPath = ''

    return {
      id,
      root,
      startedAt,
      finishedAt: Date.now(),
      files: scan.files.length,
      bytes: scan.bytesTotal,
      uploaded: counts.uploaded,
      uploadedBytes: counts.uploadedBytes,
      skippedUnchanged: counts.skipped,
      errors: counts.errors,
      enc: crypto !== null,
      cancelled: false,
    }
  }

  private async processFile(
    run: ActiveRun,
    cfg: LikeZcodeConfig,
    backend: BackupBackend,
    crypto: CryptoMaterial | null,
    file: ScannedFile,
    hashes: Map<string, string>,
    stagingDir: string,
    maxFileBytes: number,
  ): Promise<{ uploaded: boolean; storedSize: number }> {
    run.progress.currentPath = file.relPath
    const { hash, size } = await hashFile(file.absPath)
    hashes.set(file.relPath, hash)
    // 进度记账:实际哈希到的字节数(可能与扫描时略有出入,结尾会对齐)
    run.progress.bytesDone = Math.min(run.progress.bytesTotal, run.progress.bytesDone + size)
    if (size > maxFileBytes) {
      this.known.set(hash, Date.now())
      return { uploaded: false, storedSize: 0 }
    }
    if (this.known.has(hash)) return { uploaded: false, storedSize: 0 }

    const staging = join(stagingDir, `${hashes.size.toString(36)}-${hash.slice(0, 8)}.stg`)
    try {
      const { storedSize } = await transformFileToFile(file.absPath, staging, crypto, hash)
      await this.waitWhilePaused(run)
      await run.bucket.take(storedSize, run.abort.signal)
      await backend.putBlob(hash, staging, storedSize)
      this.known.set(hash, Date.now())
      this.knownDirty = true
      if (this.known.size % 50 === 0) await this.saveKnown()
      this.sampleSpeed(run)
      run.progress.etaSec = this.sampleEta(run)
      return { uploaded: true, storedSize }
    } finally {
      await rm(staging, { force: true }).catch(() => undefined)
    }
  }

  // ── 速度采样(滑动 500ms 粒度) ──────────────────────────────────────────────
  private speedSample: { t: number; bytes: number } | null = null

  private sampleSpeed(run: ActiveRun): void {
    const now = Date.now()
    const prev = this.speedSample
    if (prev && now > prev.t) {
      run.progress.speedBps = Math.max(0, ((run.progress.uploadedBytes - prev.bytes) / (now - prev.t)) * 1000)
    }
    if (!prev || now - prev.t >= 500) this.speedSample = { t: now, bytes: run.progress.uploadedBytes }
  }

  private sampleEta(run: ActiveRun): number {
    const remain = Math.max(0, run.progress.bytesTotal - run.progress.bytesDone)
    const speed = Math.max(1, run.progress.speedBps)
    return Math.min(86400, Math.round(remain / speed))
  }

  // ── 去重索引(本地缓存,免 HEAD 风暴) ──────────────────────────────────────
  private knownPath(bkey: string): string {
    return join(this.store.dir, `known-${bkey}.json`)
  }

  private async loadKnown(bkey: string): Promise<void> {
    if (this.knownLoadedFor === bkey) return
    try {
      const raw = JSON.parse(await readFile(this.knownPath(bkey), 'utf-8')) as Record<string, number>
      this.known = new Map(Object.entries(raw))
    } catch {
      this.known = new Map()
    }
    this.knownLoadedFor = bkey
    this.knownDirty = false
  }

  private async saveKnown(): Promise<void> {
    if (!this.knownLoadedFor) return
    this.knownDirty = false
    await mkdir(this.store.dir, { recursive: true })
    const tmp = `${this.knownPath(this.knownLoadedFor)}.tmp-${Date.now()}`
    await writeFile(tmp, JSON.stringify(Object.fromEntries(this.known)))
    await rm(this.knownPath(this.knownLoadedFor), { force: true })
    await rename(tmp, this.knownPath(this.knownLoadedFor))
  }

  // ── 加密材料 ──────────────────────────────────────────────────────────────

  private async ensureCrypto(backend: BackupBackend, cfg: LikeZcodeConfig): Promise<CryptoMaterial | null> {
    if (!cfg.encryptionEnabled || !cfg.passphrase) return null
    const bkey = backendKeyFor(cfg)
    const localPath = join(this.store.dir, `keymeta-${bkey}.json`)

    const remoteBuf = await backend.getKeyMeta().catch(() => null)
    if (remoteBuf) {
      const meta = JSON.parse(remoteBuf.toString('utf-8')) as { salt: string; check: string }
      const key = deriveKey(cfg.passphrase, meta.salt)
      if (!verifyPassphrase(key, meta.check)) {
        throw new Error('加密口令与远端 keymeta 不匹配(换口令需更换 remotePrefix 或清空远端前缀目录)')
      }
      await writeFile(localPath, JSON.stringify(meta)).catch(() => undefined)
      return { key, saltHex: meta.salt }
    }

    // 远端没有:先看本地(可能是远端被清理过),再新建
    const localRaw = await readFile(localPath, 'utf-8').catch(() => null)
    if (localRaw) {
      const meta = JSON.parse(localRaw) as { salt: string; check: string }
      const key = deriveKey(cfg.passphrase, meta.salt)
      if (verifyPassphrase(key, meta.check)) {
        await backend.putKeyMeta(Buffer.from(JSON.stringify(meta)))
        return { key, saltHex: meta.salt }
      }
    }
    const salt = makeSalt()
    const key = deriveKey(cfg.passphrase, salt)
    const meta = { salt, check: checkToken(key) }
    await backend.putKeyMeta(Buffer.from(JSON.stringify(meta)))
    await mkdir(this.store.dir, { recursive: true })
    await writeFile(localPath, JSON.stringify(meta))
    this.store.log(`keymeta created for ${bkey}(salt 只存本地与用户自有远端;私钥永不离开本机)`)
    return { key, saltHex: salt }
  }

  private async uniqueSnapshotId(backend: BackupBackend): Promise<string> {
    const base = snapshotId()
    const exists = new Set((await backend.listManifests()).map((m) => m.id))
    if (!exists.has(base)) return base
    for (let i = 1; i < 100; i++) {
      const id = `${base}-${i}`
      if (!exists.has(id)) return id
    }
    return `${base}-${randomBytes(2).toString('hex')}`
  }

  // ── 调度心跳(由宿主侧 60s 定时器调用) ────────────────────────────────────

  async autoTick(): Promise<boolean> {
    const cfg = this.getConfig()
    if (!cfg.enabled || this.run) return false
    const mode = normalizeScheduleMode(cfg.scheduleMode)
    if (mode === 'manual') return false
    const roots = parseWorkspaces(cfg.workspaces)
    if (!roots.length || !this.isDestinationConfigured(cfg)) return false
    const last = this.store.history[0]?.finishedAt ?? null
    const intervalMs = Math.max(1, cfg.intervalHours) * 3600_000
    if (last && Date.now() - last < intervalMs) return false
    if (mode === 'window' && !inWindow(new Date().getHours(), cfg.windowStart, cfg.windowEnd)) return false
    await this.start(roots, 'auto')
    return true
  }
}
