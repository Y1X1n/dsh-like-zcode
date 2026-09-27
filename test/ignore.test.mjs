import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compileIgnoreRules, defaultIgnoreRules, isIgnored, parseGitignore } from '../lib/core.js'

test('默认排除命中 node_modules 等目录', () => {
  const rules = defaultIgnoreRules()
  assert.equal(isIgnored(rules, 'node_modules/react/index.js', false), true)
  assert.equal(isIgnored(rules, 'node_modules', true), true)
  assert.equal(isIgnored(rules, 'src/index.ts', false), false)
  assert.equal(isIgnored(rules, 'debug.log', false), true)
  assert.equal(isIgnored(rules, 'deep/nested/debug.log', false), true)
})

test('扩展名 pattern 只匹配文件名', () => {
  const rules = compileIgnoreRules(['*.log'])
  assert.equal(isIgnored(rules, 'a.log', false), true)
  assert.equal(isIgnored(rules, 'x/y/z.LOG', false), false, '大小写敏感,与 git 一致')
  assert.equal(isIgnored(rules, 'logger.ts', false), false, '*.log 不是 *log')
})

test('目录专属规则(尾 /)', () => {
  const rules = compileIgnoreRules(['build/'])
  assert.equal(isIgnored(rules, 'build', true), true)
  assert.equal(isIgnored(rules, 'build/out.js', true), true, '目录下的内容被传进来时,dirOnly 规则也命中')
  assert.equal(isIgnored(rules, 'builder.ts', false), false)
})

test('锚定:前导 / 或含 / 时相对根匹配', () => {
  const rules = compileIgnoreRules(['/dist', 'docs/**/*.md'])
  assert.equal(isIgnored(rules, 'dist', true), true)
  assert.equal(isIgnored(rules, 'a/b/dist', true), false, '前导 / 已锚定')
  assert.equal(isIgnored(rules, 'docs/a.md', false), true)
  assert.equal(isIgnored(rules, 'docs/x/y.md', false), true)
  assert.equal(isIgnored(rules, 'other/docs/a.md', false), false)
})

test('反选 ! 覆盖前面的规则(gitignore 语义:后写优先)', () => {
  const rules = compileIgnoreRules(['*.log', '!keep.log', 'node_modules/', '!node_modules/keep.js'])
  assert.equal(isIgnored(rules, 'a.log', false), true)
  assert.equal(isIgnored(rules, 'keep.log', false), false)
  assert.equal(isIgnored(rules, 'node_modules/keep.js', false), false)
  assert.equal(isIgnored(rules, 'node_modules/other.js', false), true)
})

test('注释与空行被忽略', () => {
  const rules = parseGitignore('# 注释\n\n   \n*.tmp\n')
  assert.equal(rules.length, 1)
  assert.equal(isIgnored(rules, 'a.tmp', false), true)
})

test('? 单字符通配', () => {
  const rules = compileIgnoreRules(['file?.txt'])
  assert.equal(isIgnored(rules, 'file1.txt', false), true)
  assert.equal(isIgnored(rules, 'file12.txt', false), false)
})
