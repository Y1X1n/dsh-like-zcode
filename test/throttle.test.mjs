import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TokenBucket, inWindow } from '../lib/core.js'

test('令牌桶:突发额度内立即可取', async () => {
  const bucket = new TokenBucket(1024, 4096) // 1KB/s,burst 4KB
  const t0 = Date.now()
  await bucket.take(2048)
  assert.ok(Date.now() - t0 < 100, 'burst 内应当立即放行')
})

test('令牌桶:超出突发后按速率等待', async () => {
  const bucket = new TokenBucket(1000, 1000) // 1KB/s,burst 1KB
  await bucket.take(900)
  const t0 = Date.now()
  await bucket.take(500) // 需要 500ms 左右
  const elapsed = Date.now() - t0
  assert.ok(elapsed >= 200, `应等待约 500ms,实际 ${elapsed}ms`)
  assert.ok(elapsed <= 1500, '不应过度等待')
})

test('令牌桶:setRate 动态生效', async () => {
  const bucket = new TokenBucket(200, 200)
  bucket.setRate(1_000_000)
  const t0 = Date.now()
  await bucket.take(1000)
  assert.ok(Date.now() - t0 < 100, '升速后应立即放行')
})

test('窗口判定含跨零点', () => {
  assert.equal(inWindow(3, 2, 7), true)
  assert.equal(inWindow(7, 2, 7), false, '左闭右开')
  assert.equal(inWindow(23, 22, 6), true, '跨零点:22→6 的 23 点在窗口内')
  assert.equal(inWindow(5, 22, 6), true)
  assert.equal(inWindow(12, 22, 6), false)
  assert.equal(inWindow(5, 5, 5), true, 'start==end 视为全天')
})
