import assert from 'node:assert/strict'
import { test } from 'node:test'
import { snapshotId, serializeManifest, parseManifest, retentionTargets, deriveKey, makeSalt } from '../lib/core.js'

function sampleManifest() {
  return {
    v: 1,
    id: '20260927-223000',
    root: 'E:\\demo',
    startedAt: 1790000000000,
    finishedAt: 1790000001000,
    host: 'DESKTOP-XXX',
    enc: false,
    counts: { files: 3, bytes: 999, uploaded: 1, uploadedBytes: 512, skippedUnchanged: 2, skippedTooBig: 0, errors: 0 },
    files: [
      { p: 'src/index.ts', h: 'aa'.repeat(32), s: 123, m: 1 },
      { p: '.git/HEAD', h: 'bb'.repeat(32), s: 41, m: 2 },
      { p: 'README.md', h: 'cc'.repeat(32), s: 835, m: 3 },
    ],
  }
}

test('snapshotId 格式 YYYYMMDD-HHmmss', () => {
  const id = snapshotId(new Date(2026, 8, 27, 22, 30, 0))
  assert.equal(id, '20260927-223000')
})

test('清单序列化往返(明文)', async () => {
  const m = sampleManifest()
  const buf = await serializeManifest(m, null)
  const back = await parseManifest(buf, null)
  assert.deepEqual(back, m)
  assert.ok(buf.length < JSON.stringify(m).length, 'gzip 应有压缩收益')
})

test('清单序列化往返(加密,错误口令报错)', async () => {
  const salt = makeSalt()
  const crypto = { key: deriveKey('correct horse', salt), saltHex: salt }
  const m = sampleManifest()
  m.enc = true
  const buf = await serializeManifest(m, crypto)
  const back = await parseManifest(buf, crypto)
  assert.deepEqual(back, m)
  const wrong = { key: deriveKey('wrong', salt), saltHex: salt }
  await assert.rejects(() => parseManifest(buf, wrong))
})

test('保留策略:按时间序保留最近 keep 份', () => {
  const entries = [
    { id: '20260901-000000' },
    { id: '20260902-000000' },
    { id: '20260903-000000' },
    { id: '20260904-000000' },
    { id: '20260905-000000' },
  ]
  assert.deepEqual(retentionTargets(entries, 3), ['20260901-000000', '20260902-000000'])
  assert.deepEqual(retentionTargets(entries, 5), [], '未超出不删')
  assert.deepEqual(retentionTargets(entries, 10), [])
})
