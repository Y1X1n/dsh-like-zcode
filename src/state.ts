import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type RunPhase = 'idle' | 'scanning' | 'uploading' | 'finalizing' | 'done' | 'error' | 'cancelled'

export interface RunProgress {
  phase: RunPhase
  runId: string | null
  dir: string
  filesTotal: number
  filesDone: number
  bytesTotal: number
  bytesDone: number
  uploadedFiles: number
  uploadedBytes: number
  skippedUnchanged: number
  skippedTooBig: number
  errorCount: number
  currentPath: string
  speedBps: number
  etaSec: number
  startedAt: number | null
  finishedAt: number | null
  message: string
}

export interface HistoryEntry {
  id: string
  root: string
  startedAt: number
  finishedAt: number
  files: number
  bytes: number
  uploaded: number
  uploadedBytes: number
  skippedUnchanged: number
  errors: number
  enc: boolean
  cancelled: boolean
}

export function emptyProgress(): RunProgress {
  return {
    phase: 'idle',
    runId: null,
    dir: '',
    filesTotal: 0,
    filesDone: 0,
    bytesTotal: 0,
    bytesDone: 0,
    uploadedFiles: 0,
    uploadedBytes: 0,
    skippedUnchanged: 0,
    skippedTooBig: 0,
    errorCount: 0,
    currentPath: '',
    speedBps: 0,
    etaSec: 0,
    startedAt: null,
    finishedAt: null,
    message: '待命。ZCode 都替你着急了,但我们还是等你先点"启用"。',
  }
}

const LOG_MAX_BYTES = 512 * 1024

/** 运行态持久化:state.json(进度)+ history.json(快照史)+ logs/like-zcode.log。 */
export class StateStore {
  readonly dir: string
  progress: RunProgress = emptyProgress()
  history: HistoryEntry[] = []
  private lastWrite = 0
  private pendingWrite: Promise<void> = Promise.resolve()
  private writing = false

  constructor(dir: string) {
    this.dir = dir
  }

  async load(): Promise<void> {
    const state = await readJsonOrNull<RunProgress>(join(this.dir, 'state.json'))
    if (state?.phase) this.progress = { ...emptyProgress(), ...state, phase: state.phase === 'done' || state.phase === 'error' || state.phase === 'cancelled' ? state.phase : 'idle' }
    const hist = await readJsonOrNull<HistoryEntry[]>(join(this.dir, 'history.json'))
    if (Array.isArray(hist)) this.history = hist
  }

  /** 进度写盘节流(≥2s 一次);phase 变更用 immediate。 */
  saveProgress(immediate = false): Promise<void> {
    const now = Date.now()
    if (!immediate && now - this.lastWrite < 2000) return this.pendingWrite
    this.lastWrite = now
    this.pendingWrite = this.pendingWrite.then(() => this.writeProgress())
    return this.pendingWrite
  }

  private async writeProgress(): Promise<void> {
    if (this.writing) return
    this.writing = true
    try {
      await atomicWriteJson(join(this.dir, 'state.json'), this.progress)
    } finally {
      this.writing = false
    }
  }

  async addHistory(entry: HistoryEntry): Promise<void> {
    this.history = [entry, ...this.history].slice(0, 200)
    await atomicWriteJson(join(this.dir, 'history.json'), this.history)
  }

  log(line: string): void {
    const stamp = new Date().toISOString()
    const text = `[${stamp}] ${line}\n`
    void this.appendLog(text)
  }

  private async appendLog(text: string): Promise<void> {
    try {
      await mkdir(join(this.dir, 'logs'), { recursive: true })
      const path = join(this.dir, 'logs', 'like-zcode.log')
      const st = await stat(path).catch(() => null)
      if (st && st.size > LOG_MAX_BYTES) await writeFile(path, `[${stamp0()}] 日志轮转(512KB 上限)\n`)
      await appendFile(path, text)
    } catch {
      /* 日志失败不影响备份 */
    }
  }

  async tailLog(lines: number): Promise<string> {
    try {
      const raw = await readFile(join(this.dir, 'logs', 'like-zcode.log'), 'utf-8')
      const all = raw.split('\n').filter(Boolean)
      return all.slice(-lines).join('\n')
    } catch {
      return ''
    }
  }
}

function stamp0(): string {
  return new Date().toISOString()
}

async function readJsonOrNull<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as T
  } catch {
    return null
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(path.replace(/[\\/][^\\/]+$/, ''), { recursive: true })
  const tmp = `${path}.tmp-${Date.now()}`
  await writeFile(tmp, JSON.stringify(value, null, 1), 'utf-8')
  await rename(tmp, path)
}
