import { beforeEach, describe, expect, it } from 'vitest'
import { normalizeAllowHost, RemoteAllowlistStore } from '../../src/tool/allowlist'
import { MemoryStateStore } from '../../src/store'
import { isTBError } from '../../src/errors'

const NOW = '2026-07-08T00:00:00.000Z'

describe('normalizeAllowHost', () => {
  it('小写化 + 去首尾空白', () => {
    expect(normalizeAllowHost('  Example.COM ')).toBe('example.com')
  })

  it('允许普通域名后缀与 IPv6 字面量', () => {
    expect(normalizeAllowHost('api.example.com')).toBe('api.example.com')
    expect(normalizeAllowHost('[::1]')).toBe('[::1]')
  })

  it.each([
    '',
    'http://example.com',
    'example.com/path',
    'example.com:8080',
    'a b',
    'foo@bar',
  ])('拒绝非 host 形态:%s', (bad) => {
    let caught: unknown
    try {
      normalizeAllowHost(bad)
    } catch (e) {
      caught = e
    }
    expect(isTBError(caught) && caught.code === 'invalid_argument').toBe(true)
  })
})

describe('RemoteAllowlistStore', () => {
  let store: MemoryStateStore
  let al: RemoteAllowlistStore

  beforeEach(() => {
    store = new MemoryStateStore()
    al = new RemoteAllowlistStore(store)
  })

  it('空存储 → list/hosts 为空', async () => {
    expect(await al.list()).toEqual([])
    expect(await al.hosts()).toEqual([])
  })

  it('add 规范化 + 去重(同名刷新时间戳),list 按 host 升序', async () => {
    await al.add('B.com', NOW)
    await al.add('a.com', NOW)
    await al.add('a.com', '2026-07-09T00:00:00.000Z') // 幂等刷新
    const entries = await al.list()
    expect(entries.map(e => e.host)).toEqual(['a.com', 'b.com'])
    expect(entries.find(e => e.host === 'a.com')?.updatedAt).toBe('2026-07-09T00:00:00.000Z')
    expect(await al.hosts()).toEqual(['a.com', 'b.com'])
  })

  it('remove 删存在条目;删不存在 → not_found', async () => {
    await al.add('a.com', NOW)
    await al.remove('A.COM') // 规范化后匹配
    expect(await al.hosts()).toEqual([])
    await expect(al.remove('a.com')).rejects.toSatisfy(
      e => isTBError(e) && e.code === 'not_found',
    )
  })

  it('list 容忍脏值(非数组/缺 host 项被丢弃)', async () => {
    await store.put('sys:remoteallowlist', [{ host: 'ok.com', updatedAt: NOW }, { nope: 1 }, 42])
    expect(await al.hosts()).toEqual(['ok.com'])
  })
})
