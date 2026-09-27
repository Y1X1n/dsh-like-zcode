import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { decodeWorkspaceDir, findSession, listSessions } from '../lib/core.js'

test('工作区目录名解码:常规路径', () => {
  assert.equal(decodeWorkspaceDir('--E-dsh-plugins-dsh-prompt-optimizer--'), 'E:\\dsh-plugins\\dsh-prompt-optimizer')
  assert.equal(decodeWorkspaceDir('--E-yixin-Documents--'), 'E:\\yixin\\Documents')
})

test('工作区目录名解码:~XXXX 转义(空格)', () => {
  assert.equal(decodeWorkspaceDir('--E-cc~0020projects-zzrlw--'), 'E:\\cc projects\\zzrlw')
})

test('工作区目录名解码:非会话名原样返回', () => {
  assert.equal(decodeWorkspaceDir('random-dir'), 'random-dir')
  assert.equal(decodeWorkspaceDir('--C--'), '--C--')
})

test('listSessions:枚举会话、按存在性过滤、按时间排序', async () => {
  const fake = await mkdtemp(join(tmpdir(), 'lz-sessions-'))
  // 真实存在的解码目标(临时目录本身)
  const realWs = decodeWorkspaceDir('--C--').slice(0, 2) // 'C:\'
  void realWs
  // 直接造一个解码后真实存在的目录名:用 fake temp 目录构造
  const targetDir = join(tmpdir(), 'lz-sessions-ws-target')
  await mkdir(targetDir, { recursive: true })
  const encoded = '--' + 'C' + '-' + targetDir.split('\\').slice(1).join('-') + '--'
  const sessA = join(fake, encoded, 'session-aaaaaaaa-1111-2222-3333-444444444444')
  const sessB = join(fake, encoded, 'session-bbbbbbbb-1111-2222-3333-444444444444')
  const sessGone = join(fake, '--E-nonexistent-path--', 'session-cccccccc-1111-2222-3333-444444444444')
  await mkdir(sessA, { recursive: true })
  await mkdir(sessB, { recursive: true })
  await mkdir(sessGone, { recursive: true })
  // B 比 A 更新
  const t = new Date(Date.now() + 60_000)
  await utimes(sessB, t, t)

  const list = listSessions(fake)
  // 按最近活动排序;工作区不存在的会话也在列表里(workspace=null,仅不可按会话备份)
  const ids = list.map((s) => s.sessionId.slice(0, 8))
  assert.deepEqual(ids, ['bbbbbbbb', 'aaaaaaaa', 'cccccccc'], '按最近活动排序')
  assert.equal(list[0].workspace, targetDir, '解码出的工作区存在 → 非空')
  const gone = list.find((s) => s.sessionId.startsWith('cccccccc'))
  assert.equal(gone?.workspace ?? 'missing', null)

  // findSession 精确查找(大小写不敏感)
  const found = findSession('AAAAAAAA-1111-2222-3333-444444444444', fake)
  assert.equal(found?.workspace, targetDir)
  assert.equal(findSession('ffffffff-1111-2222-3333-444444444444', fake), null)

  await rm(fake, { recursive: true, force: true })
  await rm(targetDir, { recursive: true, force: true })
})
