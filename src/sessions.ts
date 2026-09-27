import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './paths.js'

export interface SessionInfo {
  sessionId: string
  /** 尽力解码出的工作区路径;仅在磁盘上真实存在时才非空(可直接作为备份根)。 */
  workspace: string | null
  /** 会话存储的原始目录名(解码失败的兜底展示)。 */
  rawDir: string
  updatedAt: number
}

/**
 * 解码会话存储的工作区目录名:dsh 把工作区路径编码成
 * `--E-dsh-plugins-dsh-prompt-optimizer--`(盘符 + 路径段,'\' 换成 '-',
 * 非 ASCII 字符用 ~XXXX 转义)。'\' 与 '-' 编码后不可区分,所以解码是
 * 歧义的——用逐段磁盘存在性校验消歧(优先把剩余部分当作一段)。
 */
export function decodeWorkspaceDir(name: string): string {
  const m = /^--(.+)--$/.exec(name)
  if (!m?.[1]) return name
  const body = m[1].replace(/~([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
  const parts = body.split('-').filter(Boolean)
  if (parts.length < 2) return name
  const [drive, ...segments] = parts
  if (drive.length !== 1 || !/^[a-zA-Z]$/.test(drive)) return name
  return resolveSegments(`${drive}:\\`, segments) ?? name
}

/** 逐段尝试:每一步优先把剩余部分整体当作一个目录段(最长优先),磁盘存在才算数。 */
function resolveSegments(root: string, parts: string[]): string | null {
  if (parts.length === 0) return existsSync(root) ? root : null
  for (let take = parts.length; take >= 1; take--) {
    const candidate = join(root, parts.slice(0, take).join('-'))
    if (!existsSync(candidate)) continue
    const rest = resolveSegments(candidate, parts.slice(take))
    if (rest) return rest
  }
  return null
}

/** 枚举本机全部 dsh 会话(按最近活动排序)。会话内容一律不读,只取目录元数据。 */
export function listSessions(sessionsDir = join(dshHome(), 'sessions')): SessionInfo[] {
  const out: SessionInfo[] = []
  let workspaceDirs: string[]
  try {
    workspaceDirs = readdirSync(sessionsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
  for (const workspaceDir of workspaceDirs) {
    const workspaceDecoded = decodeWorkspaceDir(workspaceDir)
    const workspaceExists = workspaceDecoded !== workspaceDir && existsSync(workspaceDecoded)
    const workspaceRoot = join(sessionsDir, workspaceDir)
    let sessionDirs: string[]
    try {
      sessionDirs = readdirSync(workspaceRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      continue
    }
    for (const sessionDir of sessionDirs) {
      const m = /^session-(.+)$/.exec(sessionDir)
      if (!m?.[1]) continue
      try {
        const st = statSync(join(workspaceRoot, sessionDir))
        out.push({
          sessionId: m[1],
          workspace: workspaceExists ? workspaceDecoded : null,
          rawDir: workspaceDir,
          updatedAt: st.mtimeMs,
        })
      } catch {
        /* 目录刚被清理,跳过 */
      }
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 按 sessionid 精确查找(返回第一条匹配;工作区必须存在才能作为备份根)。 */
export function findSession(sessionId: string, sessionsDir?: string): SessionInfo | null {
  const key = sessionId.toLowerCase()
  return (
    listSessions(sessionsDir).find((s) => s.sessionId.toLowerCase() === key && s.workspace) ?? null
  )
}

/**
 * 把工作区绝对路径变成远端存储里的"目录名"(key 前缀段):
 * 'E:\dsh-plugins\dsh-prompt-optimizer' → 'E-dsh-plugins-dsh-prompt-optimizer'。
 * 段内不产生 '/',保证一个工作区 = 远端一个一级文件夹。
 */
export function workspaceSlug(root: string): string {
  const slug = root
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'workspace'
}
