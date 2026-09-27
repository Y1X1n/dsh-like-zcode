import { readdir, readFile, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { compileIgnoreRules, defaultIgnoreRules, isIgnored, parseGitignore, type IgnoreRule } from './ignore.js'

export interface ScannedFile {
  /** '/' 分隔的相对路径(远端清单用,跨平台一致)。 */
  relPath: string
  absPath: string
  size: number
  mtimeMs: number
}

export interface TooBigEntry {
  relPath: string
  size: number
}

export interface ScanResult {
  files: ScannedFile[]
  tooBig: TooBigEntry[]
  errorCount: number
  bytesTotal: number
}

export interface ScanOptions {
  includeGit: boolean
  respectGitignore: boolean
  excludePatterns: string[]
  maxFileBytes: number
  /** 进度回调(每 ~200 个条目):已发现文件数。 */
  onProgress?(found: number): void
}

/**
 * 迭代式目录扫描(不递归跟随符号链接/联接点,防环)。
 * 排除语义:默认排除 + 用户 pattern 全程生效;respectGitignore 时叠加
 * 仓库根目录 .gitignore 与 .git/info/exclude(子目录级 .gitignore 不展开——
 * 备份场景从宽,宁多备不漏备)。
 */
export async function scanRoot(root: string, opts: ScanOptions): Promise<ScanResult> {
  const baseRules: IgnoreRule[] = [...defaultIgnoreRules(), ...compileIgnoreRules(opts.excludePatterns)]
  if (opts.respectGitignore) {
    const gitignoreText = await readTextOrNull(join(root, '.gitignore'))
    if (gitignoreText) baseRules.push(...parseGitignore(gitignoreText))
    const infoExclude = await readTextOrNull(join(root, '.git', 'info', 'exclude'))
    if (infoExclude) baseRules.push(...parseGitignore(infoExclude))
  }

  const files: ScannedFile[] = []
  const tooBig: TooBigEntry[] = []
  let errorCount = 0
  let bytesTotal = 0

  const queue: { abs: string; rel: string; rules: IgnoreRule[] }[] = [{ abs: root, rel: '', rules: baseRules }]
  let sinceProgress = 0

  while (queue.length > 0) {
    const dir = queue.pop()
    if (!dir) break
    let entries
    try {
      entries = await readdir(dir.abs, { withFileTypes: true })
    } catch {
      errorCount++
      continue
    }
    for (const entry of entries) {
      const rel = dir.rel ? `${dir.rel}/${entry.name}` : entry.name
      const isDir = entry.isDirectory()
      // .git 由 includeGit 单独裁决,不受 ignore 规则影响(内部的 refs/logs 不在默认排除里)
      const rulesForEntry = opts.includeGit && rel === '.git' ? [] : dir.rules
      if (isIgnored(rulesForEntry, rel, isDir)) continue

      let st
      try {
        st = await lstat(join(dir.abs, entry.name))
      } catch {
        errorCount++
        continue
      }
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) {
        // .git 子树不叠加 gitignore 规则(内部结构自成体系)
        const childRules = rel === '.git' ? [] : dir.rules
        queue.push({ abs: join(dir.abs, entry.name), rel, rules: childRules })
        continue
      }
      if (!st.isFile()) continue
      if (st.size > opts.maxFileBytes) {
        tooBig.push({ relPath: rel, size: st.size })
        continue
      }
      files.push({ relPath: rel, absPath: join(dir.abs, entry.name), size: st.size, mtimeMs: st.mtimeMs })
      bytesTotal += st.size
      sinceProgress++
      if (opts.onProgress && sinceProgress >= 200) {
        sinceProgress = 0
        opts.onProgress(files.length)
      }
    }
  }
  opts.onProgress?.(files.length)
  return { files, tooBig, errorCount, bytesTotal }
}

async function readTextOrNull(path: string): Promise<string | null> {
  try {
    const st = await lstat(path)
    if (!st.isFile()) return null
    return await readFile(path, 'utf-8')
  } catch {
    return null
  }
}
