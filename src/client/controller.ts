/**
 * 设置卡的状态轮询器(纯逻辑,可单测):每 1.5s 拉 /dsh-like-zcode/status,
 * 动作按钮 POST 对应路由。same-origin 相对路径,与 dsh web 前端同源。
 */

export interface RunProgressLike {
  phase: 'idle' | 'scanning' | 'uploading' | 'finalizing' | 'done' | 'error' | 'cancelled'
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

export interface StatusLike {
  configured: boolean
  enabled: boolean
  backend: string
  phase: RunProgressLike['phase']
  paused: boolean
  run: RunProgressLike
  lastRun: { id: string; root: string; finishedAt: number; files: number; bytes: number; uploaded: number; uploadedBytes: number; enc: boolean; cancelled: boolean } | null
  nextAutoRunAt: number | null
  lastError: string | null
  meme: string
}

export interface HistoryEntryLike {
  id: string
  root: string
  finishedAt: number
  files: number
  bytes: number
  uploaded: number
  uploadedBytes: number
  enc: boolean
  cancelled: boolean
}

export interface StatusControllerState {
  status: StatusLike | null
  history: HistoryEntryLike[]
  error: string | null
  busy: boolean
  testResult: { ok: boolean; text: string } | null
}

export type Listener = () => void

export const POLL_INTERVAL_MS = 1500

export interface StatusController {
  state: StatusControllerState
  subscribe(fn: Listener): () => void
  getSnapshot(): StatusControllerState
  actions: {
    startPolling(): void
    stopPolling(): void
    /** 立即刷新一次(不等下一跳)。 */
    refresh(): Promise<void>
    run(dirs?: string[]): Promise<void>
    pause(): Promise<void>
    resume(): Promise<void>
    cancel(): Promise<void>
    test(config: Record<string, unknown>): Promise<void>
    clearTest(): void
  }
}

async function post(path: string, body?: unknown): Promise<{ ok: boolean; error?: string; message?: string; runId?: string }> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string; runId?: string }
  return { ok: res.ok && data.ok !== false, error: data.error, message: data.message, runId: data.runId }
}

export function createStatusController(): StatusController {
  let state: StatusControllerState = { status: null, history: [], error: null, busy: false, testResult: null }
  const listeners = new Set<Listener>()
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let inFlight = false

  const set = (patch: Partial<StatusControllerState>) => {
    state = { ...state, ...patch }
    listeners.forEach((fn) => fn())
  }

  const subscribe = (fn: Listener) => {
    listeners.add(fn)
    if (listeners.size === 1) startPolling()
    return () => {
      listeners.delete(fn)
      if (listeners.size === 0) stopPolling()
    }
  }

  async function refresh(): Promise<void> {
    if (inFlight) return
    inFlight = true
    try {
      const [statusRes, historyRes] = await Promise.all([
        fetch('/dsh-like-zcode/status', { headers: { accept: 'application/json' } }),
        fetch('/dsh-like-zcode/snapshots', { headers: { accept: 'application/json' } }).catch(() => null),
      ])
      if (!statusRes.ok) throw new Error(`HTTP ${statusRes.status}`)
      const statusBody = (await statusRes.json()) as { ok: boolean; status?: StatusLike }
      if (!statusBody.ok || !statusBody.status) throw new Error('bad status payload')
      let history: HistoryEntryLike[] = state.history
      if (historyRes?.ok) {
        const body = (await historyRes.json().catch(() => null)) as { ok?: boolean; history?: HistoryEntryLike[] } | null
        if (body?.ok && Array.isArray(body.history)) history = body.history
      }
      set({ status: statusBody.status, history, error: null })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      inFlight = false
    }
  }

  function startPolling(): void {
    if (pollTimer) return
    void refresh()
    pollTimer = setInterval(() => void refresh(), POLL_INTERVAL_MS)
  }

  function stopPolling(): void {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = null
  }

  const action = async (fn: () => Promise<void>): Promise<void> => {
    set({ busy: true })
    try {
      await fn()
    } finally {
      set({ busy: false })
      await refresh()
    }
  }

  return {
    state,
    subscribe,
    getSnapshot: () => state,
    actions: {
      startPolling,
      stopPolling,
      refresh,
      run: (dirs) =>
        action(async () => {
          const res = await post('/dsh-like-zcode/run', dirs?.length ? { dirs } : {})
          if (!res.ok) set({ testResult: { ok: false, text: res.error ?? '启动失败' } })
        }),
      pause: () =>
        action(async () => {
          await post('/dsh-like-zcode/pause')
        }),
      resume: () =>
        action(async () => {
          await post('/dsh-like-zcode/resume')
        }),
      cancel: () =>
        action(async () => {
          await post('/dsh-like-zcode/cancel')
        }),
      test: (config) =>
        action(async () => {
          const res = await post('/dsh-like-zcode/test', config)
          set({ testResult: { ok: res.ok, text: res.ok ? res.message ?? '连接成功' : res.error ?? '连接失败' } })
        }),
      clearTest: () => set({ testResult: null }),
    },
  }
}
