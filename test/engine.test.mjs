import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import test from 'node:test'
import { BackupEngine, resolveConfig, workspaceSlug } from '../lib/core.js'

const POLL_MS = 100
const TIMEOUT_MS = 30_000

async function waitForPhase(engine, phases, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const phase = engine.status().phase
    if (phases.includes(phase)) return phase
    if (Date.now() > deadline) throw new Error(`等待阶段 ${phases.join('/')} 超时,当前:${phase} · ${JSON.stringify(engine.status().run)}`)
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}

async function makeFixture() {
  const src = await mkdtemp(join(tmpdir(), 'lz-src-'))
  const dest = await mkdtemp(join(tmpdir(), 'lz-dest-'))
  const stateDir = await mkdtemp(join(tmpdir(), 'lz-state-'))
  await writeFile(join(src, 'a.txt'), 'hello like-zcode\n')
  await mkdir(join(src, 'sub'), { recursive: true })
  await writeFile(join(src, 'sub', 'b.txt'), 'nested file '.repeat(200))
  await mkdir(join(src, 'node_modules', 'pkg'), { recursive: true })
  await writeFile(join(src, 'node_modules', 'pkg', 'index.js'), 'should be excluded')
  await writeFile(join(src, 'debug.log'), 'excluded by default rules')
  await mkdir(join(src, '.git'), { recursive: true })
  await writeFile(join(src, '.git', 'HEAD'), 'ref: refs/heads/main')
  return { src, dest, stateDir }
}

test('引擎端到端:扫描 → 去重上传 → 清单 → 二次近零上传', async () => {
  const { src, dest, stateDir } = await makeFixture()
  const cfg = resolveConfig({ enabled: true, workspaces: src, backend: 'localdir', localDir: dest, maxUploadKBps: 65536 })
  const engine = new BackupEngine(() => cfg, stateDir)
  try {
    await engine.start([src], 'manual')
    assert.equal(await waitForPhase(engine, ['done']), 'done')

    const prefix = join(dest, 'dsh-like-zcode', workspaceSlug(src))
    const snapshotDir = join(prefix, 'snapshots')
    const names = (await readdir(snapshotDir)).sort()
    assert.equal(names.length, 1, '应有一份快照清单')
    const manifest = JSON.parse(gunzipSync(await readFile(join(snapshotDir, names[0]))).toString('utf-8'))
    const paths = manifest.files.map((f) => f.p).sort()
    assert.deepEqual(paths, ['.git/HEAD', 'a.txt', 'sub/b.txt'], '默认排除生效,includeGit 生效')
    assert.equal(manifest.counts.uploaded, 3)
    assert.equal(manifest.counts.errors, 0)

    const history = engine.history()
    assert.equal(history.length, 1)
    assert.equal(history[0].files, 3)
    assert.equal(history[0].enc, false)

    // 第二次:内容寻址去重 → 零上传(清单文件名带 '-1' 后缀时字典序会排到基础 id
    // 前面,所以断言以引擎 history 为准,不按文件名猜)
    await engine.start([src], 'manual')
    assert.equal(await waitForPhase(engine, ['done']), 'done')
    const run2 = engine.history()[0]
    assert.ok(run2 && run2.id !== history[0].id, '应产生新快照')
    assert.equal(run2.files, 3)
    assert.equal(run2.skippedUnchanged, 3, '全部命中去重索引')
    assert.equal(run2.uploaded, 0, '二次备份零上传(564 次上传的讽刺)')
    const names2 = await readdir(snapshotDir)
    assert.equal(names2.length, 2, '两份快照清单')

    // meta.json 声明知情权
    const meta = JSON.parse(await readFile(join(prefix, 'meta.json'), 'utf-8'))
    assert.equal(meta.plugin, 'dsh-like-zcode')
    assert.equal(engine.status().phase, 'done')
  } finally {
    engine.stop()
    await rm(src, { recursive: true, force: true })
    await rm(dest, { recursive: true, force: true })
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('引擎端到端:加密路径(内容块与清单均加密,远端无密钥字段)', async () => {
  const { src, dest, stateDir } = await makeFixture()
  const cfg = resolveConfig({
    enabled: true,
    workspaces: src,
    backend: 'localdir',
    localDir: dest,
    encryptionEnabled: true,
    passphrase: '鸟·凤凰·phoenix',
    maxUploadKBps: 65536,
  })
  const engine = new BackupEngine(() => cfg, stateDir)
  try {
    await engine.start([src], 'manual')
    assert.equal(await waitForPhase(engine, ['done']), 'done')

    const prefix = join(dest, 'dsh-like-zcode', workspaceSlug(src))
    const keymeta = JSON.parse(await readFile(join(prefix, 'keymeta.json'), 'utf-8'))
    assert.ok(keymeta.salt && keymeta.check, 'keymeta 含 salt+check')
    assert.equal(Object.keys(keymeta).sort().join(','), 'check,salt', '远端 keymeta 不得出现密钥字段')

    const snapshotDir = join(prefix, 'snapshots')
    const names = await readdir(snapshotDir)
    const manifestRaw = await readFile(join(snapshotDir, names[0]))
    assert.ok(!manifestRaw.includes('hello like-zcode'), '加密清单不应泄露明文')

    // 任取一个 blob:布局 [1][IV][ct][tag],且不含明文
    const firstBucket = (await readdir(join(prefix, 'blobs')))[0]
    const blobName = (await readdir(join(prefix, 'blobs', firstBucket)))[0]
    const blob = await readFile(join(prefix, 'blobs', firstBucket, blobName))
    assert.equal(blob[0], 1, 'blob 应带 version 头')
    assert.ok(!blob.includes('hello like-zcode'), 'blob 不应泄露明文')
  } finally {
    engine.stop()
    await rm(src, { recursive: true, force: true })
    await rm(dest, { recursive: true, force: true })
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('引擎:目标未配置时给出可读错误', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'lz-state2-'))
  const cfg = resolveConfig({ enabled: true, workspaces: 'C:\\nonexistent-lz', backend: 'localdir', localDir: '' })
  const engine = new BackupEngine(() => cfg, stateDir)
  try {
    await assert.rejects(() => engine.start(['C:\\nonexistent-lz']), /备份目标未配置/)
  } finally {
    engine.stop()
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('引擎:保留策略清理超份数旧清单', async () => {
  const { src, dest, stateDir } = await makeFixture()
  const cfg = resolveConfig({ enabled: true, workspaces: src, backend: 'localdir', localDir: dest, retentionRuns: 3, maxUploadKBps: 65536 })
  const engine = new BackupEngine(() => cfg, stateDir)
  try {
    for (let i = 0; i < 5; i++) {
      await writeFile(join(src, `run-${i}.txt`), `run ${i}`)
      await engine.start([src], 'manual')
      await waitForPhase(engine, ['done'])
    }
    const snapshotDir = join(dest, 'dsh-like-zcode', workspaceSlug(src), 'snapshots')
    const names = await readdir(snapshotDir)
    assert.ok(names.length <= 3, `保留 3 份,实际 ${names.length}`)
  } finally {
    engine.stop()
    await rm(src, { recursive: true, force: true })
    await rm(dest, { recursive: true, force: true })
    await rm(stateDir, { recursive: true, force: true })
  }
})
