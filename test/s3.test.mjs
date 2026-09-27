import assert from 'node:assert/strict'
import { test } from 'node:test'
import { encodeKey, canonicalQuery } from '../lib/core.js'

test('encodeKey:我们的 key 空间([a-z0-9/.\-])原样通过', () => {
  const key = 'blobs/ab/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  assert.equal(encodeKey(key), key)
  assert.equal(encodeKey('snapshots/20260927-223000.json.gz'), 'snapshots/20260927-223000.json.gz')
})

test('encodeKey:特殊字符逐段 RFC3986', () => {
  assert.equal(encodeKey('a b/中文.txt'), 'a%20b/%E4%B8%AD%E6%96%87.txt')
  assert.equal(encodeKey('x+y/z'), 'x%2By/z')
})

test('canonicalQuery:按 key 名排序', () => {
  const { encoded, canonical } = canonicalQuery([
    { k: 'prefix', v: 'snapshots/' },
    { k: 'list-type', v: '2' },
    { k: 'max-keys', v: '1000' },
  ])
  assert.equal(encoded, 'list-type=2&max-keys=1000&prefix=snapshots%2F')
  assert.equal(canonical, encoded, '本实现的 URL 查询与规范化查询同源')
})

test('canonicalQuery:无值子资源(uploads)', () => {
  const { encoded } = canonicalQuery([{ k: 'uploads', v: '' }])
  assert.equal(encoded, 'uploads=')
})

test('canonicalQuery:multipart 参数(partNumber + uploadId)', () => {
  const { encoded } = canonicalQuery([
    { k: 'uploadId', v: 'abc/123+def' },
    { k: 'partNumber', v: '2' },
  ])
  assert.equal(encoded, 'partNumber=2&uploadId=abc%2F123%2Bdef', 'partNumber 按字典序在 uploadId 之前')
})
