import { homedir } from 'node:os'
import { join } from 'node:path'

/** dsh 主目录(与 dsh CLI 同源:DSH_HOME 优先,缺省 ~/.dsh)。 */
export function dshHome(): string {
  const env = process.env.DSH_HOME?.trim()
  if (env) return env
  return join(homedir(), '.dsh')
}

/** 本插件运行态目录:进度状态 / 历史 / 去重索引 / 日志。 */
export function stateDir(): string {
  return join(dshHome(), 'like-zcode')
}
