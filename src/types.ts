/**
 * 本插件对 dsh 内核服务的最小依赖面(与 dsh-cli-bridge 同款纪律):
 * 不 import 内核包的运行时,手写最小类型 + 运行时按能力探测。
 */

export interface LooseCtx {
  inject?(services: string[], cb: (sctx: unknown) => void): unknown
  effect?(fn: () => void | (() => void)): unknown
  on?(event: string, listener: (...args: never[]) => unknown): unknown
  [key: string]: unknown
}

/** HTTP 路由注册面(webServer/httpServer 双名共用)。 */
export interface WebRouteServiceFace {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void | Promise<void>
  }): () => void
}

/** 斜杠命令的调用入参(CommandInvocation 的保守子集)。 */
export interface CommandInvocationFace {
  readonly agent?: unknown
  readonly rawInput: string
  readonly signal: AbortSignal
}

export type CommandResultFace = { kind: 'success'; text?: string } | { kind: 'error'; text: string }

/** 手写的命令定义(ctx.commands.register 的入参)。 */
export interface CommandDefinitionFace {
  name: string
  description: string
  input?: { hint: string }
  handler(invocation: CommandInvocationFace): CommandResultFace | Promise<CommandResultFace>
}

/** ctx.commands 的最小注册面(CommandRuntime)。 */
export interface CommandsServiceFace {
  register(definition: CommandDefinitionFace): () => void
}

/** 设置面(settings.register 的保守子集)。 */
export interface SettingsScopeFace {
  get(): Record<string, unknown>
  watch(fn: () => void): () => void
}

export interface SettingsServiceFace {
  register(namespace: string, schema: unknown, opts?: { base?: Record<string, unknown> }): SettingsScopeFace
}

/** 从 agent 对象防御性解析会话工作目录(dsh 版本间字段形状可能漂移)。 */
export function resolveAgentCwd(agent: unknown): string | undefined {
  if (!agent || typeof agent !== 'object') return undefined
  const session = (agent as { session?: unknown }).session
  if (session && typeof session === 'object') {
    const cwd = (session as { cwd?: unknown }).cwd
    if (typeof cwd === 'string' && cwd.trim()) return cwd
  }
  return undefined
}
