import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { WebDavBackend } from '../lib/core.js'

/** 找可用的 python(Windows:python/py 启动器,Linux:python3);没有则跳过本文件全部用例。 */
function findPython() {
  for (const cmd of ['python', 'py', 'python3']) {
    try {
      const probe = spawnSync(cmd, ['--version'], { encoding: 'utf-8', timeout: 8000 })
      if (probe.status === 0) return cmd
    } catch {
      /* 下一个 */
    }
  }
  return null
}

const python = findPython()
const PORT = 18766
const TOKEN = 'lz-test-token'
const BASE = `http://127.0.0.1:${PORT}`

async function waitForServer(deadlineMs = 10_000) {
  const deadline = Date.now() + deadlineMs
  for (;;) {
    try {
      const res = await fetch(`${BASE}/meta.json`, { headers: { authorization: `Basic ${Buffer.from(`lz:${TOKEN}`).toString('base64')}` } })
      if (res.status === 404 || res.ok) return
    } catch {
      /* 还没起 */
    }
    if (Date.now() > deadline) throw new Error('like-zdav 启动超时')
    await new Promise((r) => setTimeout(r, 200))
  }
}

test('like-zdav 服务端:WebDavBackend 全流程(连接/块读写/清单/鉴权)', { skip: !python && '本机无 python,跳过 like-zdav 测试' }, async (t) => {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url))
  const root = await mkdtemp(join(tmpdir(), 'lzdav-'))
  const child = spawn(python, [join(projectRoot, 'server', 'like-zdav.py'), '--dir', root, '--port', String(PORT), '--token', TOKEN], {
    cwd: projectRoot,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr?.on('data', (chunk) => {
    stderr += chunk
  })
  t.after(async () => {
    child.kill()
    await rm(root, { recursive: true, force: true })
  })
  try {
    await waitForServer()
  } catch (error) {
    child.kill()
    throw new Error(`${error.message} · 服务端 stderr: ${stderr.slice(0, 600)}`)
  }

  const backend = new WebDavBackend(BASE, 'lz', TOKEN, 'lz-test')

  // init:建目录 + 写 meta.json;test:连通性
  await backend.init()
  assert.match(await backend.test(), /WebDAV 可达/)

  // 块:put → has → get;不存在的块 has=false
  const src = await mkdtemp(join(tmpdir(), 'lzdav-src-'))
  const blobPath = join(src, 'blob.stg')
  const payload = Buffer.from('hello like-zdav ' + '·'.repeat(5000))
  await writeFile(blobPath, payload)
  const hash = (await import('node:crypto')).createHash('sha256').update(payload).digest('hex')
  assert.equal(await backend.hasBlob(hash), false)
  await backend.putBlob(hash, blobPath, payload.length)
  assert.equal(await backend.hasBlob(hash), true)
  assert.deepEqual(await backend.getBlob(hash), payload)

  // 清单:put → list → get → delete
  const manifest = Buffer.from('manifest-bytes')
  await backend.putManifest('20260928-000000', manifest)
  const entries = await backend.listManifests()
  assert.equal(entries.filter((e) => e.id === '20260928-000000').length, 1)
  assert.deepEqual(await backend.getManifest('20260928-000000'), manifest)
  await backend.deleteObject('snapshots/20260928-000000.json.gz')
  assert.equal((await backend.listManifests()).filter((e) => e.id === '20260928-000000').length, 0)

  // keymeta:无 → 有
  assert.equal(await backend.getKeyMeta(), null)
  await backend.putKeyMeta(Buffer.from(JSON.stringify({ salt: 'ab', check: 'cd' })))
  assert.match((await backend.getKeyMeta()).toString(), /salt/)

  // 错误口令必须被拒(否则它就不是"你自己"的服务器了)
  const bad = new WebDavBackend(BASE, 'lz', 'wrong-token', 'lz-test')
  await assert.rejects(() => bad.test())

  await rm(src, { recursive: true, force: true })
})
