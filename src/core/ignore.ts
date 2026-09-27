/**
 * gitignore 风格匹配器(gitignore-lite)。
 * 支持:注释 #、反选 !、目录专属(尾 /)、锚定(前导 / 或含 /)、glob(**、*、?)。
 * 不支持:字符类转义细节、** 在中段的部分边界情形——备份排除够用,不追求 git 位级一致。
 */

export interface IgnoreRule {
  regex: RegExp
  negated: boolean
  dirOnly: boolean
}

function globToRegex(glob: string, anchored: boolean): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // '**/' 吃掉任意层级(含零层);孤 '**' 吃任意字符
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?'
          i += 2
        } else {
          re += '.*'
          i += 1
        }
      } else {
        re += '[^/]*'
      }
      continue
    }
    if (ch === '?') {
      re += '[^/]'
      continue
    }
    re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  const prefix = anchored ? '^' : '^(?:.*/)?'
  return new RegExp(prefix + re + '$')
}

export function compileIgnoreRules(lines: string[]): IgnoreRule[] {
  const rules: IgnoreRule[] = []
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '').trim()
    if (!line || line.startsWith('#')) continue
    let body = line
    let negated = false
    if (body.startsWith('!')) {
      negated = true
      body = body.slice(1)
    }
    let dirOnly = false
    if (body.endsWith('/')) {
      dirOnly = true
      body = body.slice(0, -1)
    }
    if (!body) continue
    const anchored = body.startsWith('/') || body.slice(1).includes('/')
    if (body.startsWith('/')) body = body.slice(1)
    if (!body) continue
    let regex: RegExp
    try {
      regex = globToRegex(body, anchored)
    } catch {
      continue
    }
    rules.push({ regex, negated, dirOnly })
  }
  return rules
}

/**
 * 判定 relPath('/' 分隔)是否被排除。gitignore 语义:后面的规则覆盖前面的;
 * 目录专属(dirOnly)规则匹配该目录本身或其任一祖先目录(子树内容靠祖先命中)。
 */
export function isIgnored(rules: IgnoreRule[], relPath: string, isDir: boolean): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!normalized) return false
  const segments = normalized.split('/')
  const ancestors: string[] = []
  for (let i = 0; i < segments.length - 1; i++) ancestors.push(segments.slice(0, i + 1).join('/'))

  let ignored = false
  for (const rule of rules) {
    let matched: boolean
    if (rule.dirOnly) {
      // 目录规则:目录本身(且仅当确实是目录)直接匹配;其余一律看祖先目录
      // —— 这样 "build/" 命中 build 目录、build/ 下所有内容,但不会误伤名为 build 的文件
      matched = (isDir && rule.regex.test(normalized)) || ancestors.some((a) => rule.regex.test(a))
    } else {
      matched = rule.regex.test(normalized)
    }
    if (matched) ignored = !rule.negated
  }
  return ignored
}

/** 默认排除:构建产物 / 依赖 / 缓存 / 系统噪音(全部可用 ! 反选救回)。 */
export const DEFAULT_EXCLUDES: string[] = [
  'node_modules/',
  '__pycache__/',
  '.venv/',
  'venv/',
  'env/',
  'dist/',
  'build/',
  'out/',
  'target/',
  '.next/',
  '.nuxt/',
  '.turbo/',
  '.cache/',
  '.parcel-cache/',
  'coverage/',
  '.gradle/',
  'bin/',
  'obj/',
  '.idea/',
  '.zcode/',
  '.dsh/',
  '.claude/',
  '*.log',
  '*.tmp',
  '*.temp',
  '*.pyc',
  '*.swp',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
]

export function defaultIgnoreRules(): IgnoreRule[] {
  return compileIgnoreRules(DEFAULT_EXCLUDES)
}

/** 解析 .gitignore 文本(含未改动的注释/空行过滤)。 */
export function parseGitignore(text: string): IgnoreRule[] {
  return compileIgnoreRules(text.split(/\r?\n/))
}
