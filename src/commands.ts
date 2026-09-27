import type { BackupEngine, EngineStatus } from './core/engine.js'
import { parseWorkspaces, type LikeZcodeConfig } from './config.js'
import type { CommandDefinitionFace } from './types.js'

function bar(pct: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(pct * 10)))
  return '█'.repeat(filled) + '░'.repeat(10 - filled)
}

function humanBytes(n: number): string {
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(2)} GB`
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}

function fmtEta(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  if (m >= 60) return `${Math.floor(m / 60)}h${m % 60}m`
  return `${m}m${s}s`
}

export function renderStatusText(status: EngineStatus): string {
  const phaseText: Record<string, string> = {
    idle: '空闲',
    scanning: '扫描中',
    uploading: '静默上传中',
    finalizing: '打包清单',
    done: '已完成',
    error: '出错',
    cancelled: '已取消',
  }
  const lines: string[] = [`状态:${phaseText[status.phase] ?? status.phase}${status.paused ? '(已暂停)' : ''} · 后端 ${status.backend}`]
  const run = status.run
  if (run.phase === 'scanning' || run.phase === 'uploading' || run.phase === 'finalizing') {
    const pct = run.bytesTotal > 0 ? Math.min(1, run.bytesDone / run.bytesTotal) : 0
    lines.push(`${bar(pct)} ${(pct * 100).toFixed(0)}% · ${run.filesDone}/${run.filesTotal} 文件 · ${humanBytes(run.bytesDone)}/${humanBytes(run.bytesTotal)}`)
    if (run.phase === 'uploading') {
      lines.push(`速度 ${humanBytes(run.speedBps)}/s · ETA ${fmtEta(run.etaSec)} · 实传 ${run.uploadedFiles} 块 · 去重跳过 ${run.skippedUnchanged}`)
      if (run.currentPath) lines.push(`当前:${run.currentPath}`)
    }
    lines.push(`目录:${run.dir}`)
  }
  const last = status.lastRun
  if (last) {
    lines.push(`最近快照:${last.id} · ${last.files} 文件 · ${humanBytes(last.bytes)} · 实传 ${humanBytes(last.uploadedBytes)}${last.enc ? ' · 已加密' : ''}${last.cancelled ? '(取消)' : ''}`)
  }
  if (status.nextAutoRunAt) {
    lines.push(`下次自动备份:${new Date(status.nextAutoRunAt).toLocaleString()}`)
  }
  if (status.lastError) lines.push(`最近错误:${status.lastError}`)
  lines.push('')
  lines.push(status.meme)
  return lines.join('\n')
}

export interface CommandDeps {
  engine: BackupEngine
  getConfig(): LikeZcodeConfig
}

export function createBackupCommand(deps: CommandDeps): CommandDefinitionFace {
  const { engine, getConfig } = deps
  return {
    name: 'backup',
    description: '静默备份代码库到你自己的服务器(致敬 ZCode;每个环节你说了算)',
    input: { hint: '[now|status|pause|resume|cancel]' },
    async handler({ rawInput }) {
      const sub = rawInput.trim().toLowerCase()
      try {
        if (!sub || sub === 'now') {
          const roots = parseWorkspaces(getConfig().workspaces)
          const started = await engine.start(roots, 'manual')
          return {
            kind: 'success',
            text: [
              '🤫 备份已在后台静默启动——像某次著名事件一样安静,但这次:',
              `  · 目标是你自己配置的服务器(共 ${started.roots.length} 个目录)`,
              '  · 私钥(如开加密)只在你本机',
              '  · 会话内不会再有任何提示(梗本体),进度看 设置 → 插件 → Like ZCode',
              `runId:${started.runId}`,
            ].join('\n'),
          }
        }
        if (sub === 'status') return { kind: 'success', text: renderStatusText(engine.status()) }
        if (sub === 'pause') {
          engine.pause()
          return { kind: 'success', text: '已暂停。进度仍在 设置 → 插件 → Like ZCode。' }
        }
        if (sub === 'resume') {
          engine.resume()
          return { kind: 'success', text: '已继续。' }
        }
        if (sub === 'cancel') {
          engine.cancel()
          return { kind: 'success', text: '取消中(已上传的去重进度保留,下次续传近乎免费)。' }
        }
        return { kind: 'error', text: '用法:/backup [now|status|pause|resume|cancel]' }
      } catch (err) {
        return { kind: 'error', text: `备份未启动:${err instanceof Error ? err.message : String(err)}` }
      }
    },
  }
}
