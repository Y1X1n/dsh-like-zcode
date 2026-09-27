import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('产物存在且形态正确', async () => {
  const host = await readFile(new URL('../lib/index.js', import.meta.url), 'utf-8')
  assert.ok(host.includes('export'), 'host 半应为 ESM')
  assert.ok(host.includes('dsh-like-zcode'), 'host 半应包含插件名')

  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf-8')
  assert.ok(client.includes('window.__ModuleLoader__.load'), 'client 半应为 loader factory 形态')
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf-8'))
  assert.ok(client.includes(JSON.stringify(pkg.name).slice(1, -1)), 'loader id 必须等于插件 npm 包名')

  const core = await readFile(new URL('../lib/core.js', import.meta.url), 'utf-8')
  assert.ok(core.includes('BackupEngine'), 'core 半应包含引擎')
})

test('dsh 包清单字段齐备', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf-8'))
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(Array.isArray(pkg.dsh.client.inject) && pkg.dsh.client.inject.length > 0)
  assert.equal(pkg.main, 'lib/index.js')
  assert.ok(pkg.exports['./client'])
})

test('cordis.patch.yml 引用本包', async () => {
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf-8')
  assert.ok(patch.includes("@y1x1n/dsh-like-zcode"))
  assert.ok(patch.includes('like-zcode'))
})
