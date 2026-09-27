import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  sha256Hex,
  hashFile,
  encryptBuffer,
  decryptBuffer,
  ivFor,
  deriveKey,
  makeSalt,
  checkToken,
  verifyPassphrase,
  compressBuffer,
  decompressBuffer,
  transformFileToFile,
  restoreStoredToBuffer,
} from '../lib/core.js'

test('sha256 与 hashFile 一致', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lz-crypto-'))
  try {
    const path = join(dir, 'f.bin')
    const data = Buffer.from('like-zcode 🐦‍🔥 ' + 'x'.repeat(100000))
    await writeFile(path, data)
    const { hash, size } = await hashFile(path)
    assert.equal(hash, sha256Hex(data))
    assert.equal(size, data.length)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('gzip 往返且确定性(同输入同输出,内容寻址的前提)', async () => {
  const data = Buffer.from('deterministic gzip is the foundation of dedup')
  const a = await compressBuffer(data)
  const b = await compressBuffer(data)
  assert.deepEqual(a, b)
  assert.deepEqual(await decompressBuffer(a), data)
})

test('AES-256-GCM 往返;密文不落明文;错误口令失败', () => {
  const salt = makeSalt()
  const key = deriveKey('p@ss', salt)
  const plain = Buffer.from('secret code')
  const stored = encryptBuffer(key, sha256Hex(plain), plain)
  assert.ok(!stored.includes(plain), '密文中不应出现明文片段')
  assert.deepEqual(decryptBuffer(key, stored), plain)
  const wrong = deriveKey('wrong', salt)
  assert.throws(() => decryptBuffer(wrong, stored))
})

test('收敛 IV:同内容同 IV,同密文 → 去重成立', () => {
  const salt = makeSalt()
  const key = deriveKey('p@ss', salt)
  const h1 = sha256Hex(Buffer.from('same content'))
  const h2 = sha256Hex(Buffer.from('same content'))
  assert.deepEqual(ivFor(key, h1), ivFor(key, h2))
  const plain = Buffer.from('same content')
  assert.deepEqual(encryptBuffer(key, h1, plain), encryptBuffer(key, h2, plain))
  const h3 = sha256Hex(Buffer.from('different'))
  assert.notDeepEqual(ivFor(key, h1), ivFor(key, h3))
})

test('checkToken 口令校验', () => {
  const salt = makeSalt()
  const key = deriveKey('phrase', salt)
  const token = checkToken(key)
  assert.equal(verifyPassphrase(key, token), true)
  assert.equal(verifyPassphrase(deriveKey('other', salt), token), false)
})

test('transformFileToFile 流式变换往返(含加密尾 tag)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lz-transform-'))
  try {
    const src = join(dir, 'src.bin')
    const dest = join(dir, 'out.stg')
    // >1MB,跨多个 chunk,验证流式聚合正确性
    const data = Buffer.from(Array.from({ length: 1_500_000 }, (_, i) => i % 256))
    await writeFile(src, data)
    const salt = makeSalt()
    const crypto = { key: deriveKey('k', salt), saltHex: salt }
    const plainHash = sha256Hex(data)

    const { storedSize, storedHash } = await transformFileToFile(src, dest, crypto, plainHash)
    const stored = await readFile(dest)
    assert.equal(stored.length, storedSize)
    assert.ok(storedHash.length === 64)
    // 存储体哈希 = 密文体(不含 [v1|IV] 头与尾 tag)的哈希
    const { createHash } = await import('node:crypto')
    assert.equal(storedHash, createHash('sha256').update(stored.subarray(13, stored.length - 16)).digest('hex'))
    // 布局与 encryptBuffer 一致:[1][12B IV][ct][16B tag] → decryptBuffer 统一可解
    assert.equal(stored[0], 1)
    assert.deepEqual(await restoreStoredToBuffer(stored, crypto), data)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('transformFileToFile 明文路径(无加密)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lz-transform2-'))
  try {
    const src = join(dir, 'src.txt')
    const dest = join(dir, 'out.stg')
    const data = Buffer.from('plain path works')
    await writeFile(src, data)
    const { storedSize } = await transformFileToFile(src, dest, null, sha256Hex(data))
    const stored = await readFile(dest)
    assert.equal(stored.length, storedSize)
    assert.deepEqual(await restoreStoredToBuffer(stored, null), data)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
