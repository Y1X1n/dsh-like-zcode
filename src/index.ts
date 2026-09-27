import type { Context } from '@deepseek-ai/cordis'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { ConfigSchema, NS, resolveConfig, type LikeZcodeConfig } from './config.js'
import { stateDir } from './paths.js'
import { BackupEngine } from './core/engine.js'
import { createRouteHandlers } from './routes.js'
import { createBackupCommand } from './commands.js'
import type { LooseCtx, WebRouteServiceFace, CommandsServiceFace } from './types.js'

export const name = 'dsh-like-zcode'
// 内核服务(settings/webServer/commands)按能力探测延迟接入,缺席只降级不拖垮组合。
export const inject: string[] = []
export { ConfigSchema, NS }

const ROUTE_PREFIX = '/dsh-like-zcode'

export function apply(ctx: Context, config: unknown): void {
  const lctx = ctx as unknown as LooseCtx
  // cordis.patch.yml 的 insert 不携带 config,loader 传来的可能是空对象——
  // 显式用 schema 解析补齐默认值(总开关默认关,等用户亲手打开)。
  const baseConfig = resolveConfig(config)
  const cfgRef: { current: LikeZcodeConfig } = { current: baseConfig }
  let configSource: (() => LikeZcodeConfig) | null = null
  const getConfig = (): LikeZcodeConfig => {
    try {
      return configSource?.() ?? cfgRef.current
    } catch {
      return cfgRef.current
    }
  }
  const engine = new BackupEngine(getConfig, stateDir())

  lctx.effect?.(() => () => engine.stop())

  // ── 设置:组合层配置为 base,设置页修改实时生效。
  // installSection(0.1.2+)hooks 必须同时提供 setSource 与 onChange——
  // 漏 onChange 会在注册时抛 TypeError,整个名空间就不见了(踩过的坑)。
  lctx.inject?.(['settings'], (sctx) => {
    const settings = (sctx as { settings?: SettingsProvider }).settings
    if (!settings) return
    if (typeof (settings as { installSection?: unknown }).installSection === 'function') {
      settings.installSection(ctx, NS, ConfigSchema, baseConfig, {
        setSource: (source: () => LikeZcodeConfig) => {
          configSource = source
        },
        onChange: () => {
          /* 引擎每次运行都实时读 getConfig,无需额外刷新动作 */
        },
      } as never)
      return
    }
    const scope = settings.register(NS, ConfigSchema, { base: baseConfig })
    cfgRef.current = resolveConfig(scope.get())
    const disposeWatch = scope.watch(() => {
      cfgRef.current = resolveConfig(scope.get())
    })
    lctx.effect?.(() => () => disposeWatch())
  })

  // ── HTTP 路由:状态/快照/日志(读)+ run/pause/resume/cancel/test(写,Origin 围栏)。
  const handlers = createRouteHandlers({ engine, getConfig })
  const routes: [string, (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void | Promise<void>][] = [
    [`${ROUTE_PREFIX}/status`, handlers.statusHandler],
    [`${ROUTE_PREFIX}/snapshots`, handlers.snapshotsHandler],
    [`${ROUTE_PREFIX}/log`, handlers.logHandler],
    [`${ROUTE_PREFIX}/run`, handlers.runHandler],
    [`${ROUTE_PREFIX}/pause`, handlers.pauseHandler],
    [`${ROUTE_PREFIX}/resume`, handlers.resumeHandler],
    [`${ROUTE_PREFIX}/cancel`, handlers.cancelHandler],
    [`${ROUTE_PREFIX}/test`, handlers.testHandler],
  ]
  let routesMounted = false
  const mountRoutes = (server: WebRouteServiceFace | undefined): void => {
    if (!server || routesMounted) return
    routesMounted = true
    lctx.effect?.(() => {
      const disposers = routes.map(([path, handler]) => server.register({ kind: 'exact', path, handler }))
      return () => disposers.forEach((dispose) => dispose())
    })
    console.log(`[${name}] routes ready: GET ${ROUTE_PREFIX}/status · POST ${ROUTE_PREFIX}/{run,pause,resume,cancel,test}`)
  }
  lctx.inject?.(['webServer'], (sctx) => mountRoutes((sctx as { webServer?: WebRouteServiceFace }).webServer))
  lctx.inject?.(['httpServer'], (sctx) => mountRoutes((sctx as { httpServer?: WebRouteServiceFace }).httpServer))
  lctx.effect?.(() => {
    const timer = setTimeout(() => {
      if (!routesMounted) console.error(`[${name}] 未找到 webServer/httpServer 服务,设置页进度不可用——当前 dsh 版本可能不兼容`)
    }, 10_000)
    return () => clearTimeout(timer)
  })

  // ── 命令:/backup(用户手动触发;自动备份永不产生任何会话消息)。
  lctx.inject?.(['commands'], (sctx) => {
    const commands = (sctx as { commands?: CommandsServiceFace }).commands
    if (!commands || typeof commands.register !== 'function') return
    const dispose = commands.register(createBackupCommand({ engine, getConfig }) as never)
    lctx.effect?.(() => () => dispose())
    console.log(`[${name}] command registered: /backup`)
  })

  // ── 调度心跳:60s 一跳,只在 enabled + interval/window 模式下真正启动备份。
  //    这是"静默"的全部来处:自动运行不写会话、不发通知、不打印日志到控制台。
  lctx.effect?.(() => {
    const timer = setInterval(() => {
      void engine.autoTick().catch(() => undefined)
    }, 60_000)
    timer.unref?.()
    return () => clearInterval(timer)
  })

  console.log(`[${name}] loaded · 代号 Repo Phoenix 🐦‍🔥 · 默认关闭;启用前先在设置里填你自己的服务器`)
}
