import { beforeEach, describe, expect, it } from 'vitest'
import { ANNOTATION_TEXT_MAX, AnnotationStore } from '../../src/annotation/store'
import { isTBError } from '../../src/errors'
import { MemoryStateStore } from '../../src/store'

const NOW = '2026-07-08T00:00:00.000Z'

async function codeOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn()
    return null
  } catch (e) {
    return isTBError(e) ? e.code : 'not-tberror'
  }
}

describe('AnnotationStore', () => {
  let store: MemoryStateStore
  let anno: AnnotationStore

  beforeEach(() => {
    store = new MemoryStateStore()
    anno = new AnnotationStore(store)
  })

  it('set → get 回读;path 归一(去首尾斜杠)', async () => {
    await anno.set('/feishu/create-doc/', '记得传 folder_token', 'sk-admin', NOW)
    const got = await anno.get('feishu/create-doc')
    expect(got).toEqual({
      path: 'feishu/create-doc',
      text: '记得传 folder_token',
      updatedAt: NOW,
      updatedBy: 'sk-admin',
    })
  })

  it('set 覆盖(每 path 一条,无历史)', async () => {
    await anno.set('a', 'v1', 'k1', NOW)
    await anno.set('a', 'v2', 'k2', '2026-07-09T00:00:00.000Z')
    const got = await anno.get('a')
    expect(got?.text).toBe('v2')
    expect(got?.updatedBy).toBe('k2')
  })

  it('允许根路径(全树公告)', async () => {
    await anno.set('', '全树维护公告', 'sk-admin', NOW)
    expect((await anno.get(''))?.text).toBe('全树维护公告')
  })

  it('text trim;空/超长 → invalid_argument', async () => {
    await anno.set('a', '  padded  ', 'k', NOW)
    expect((await anno.get('a'))?.text).toBe('padded')
    expect(await codeOf(() => anno.set('b', '   ', 'k', NOW))).toBe('invalid_argument')
    expect(await codeOf(() => anno.set('b', 'x'.repeat(ANNOTATION_TEXT_MAX + 1), 'k', NOW))).toBe(
      'invalid_argument',
    )
  })

  it('保留段路径 → invalid_argument', async () => {
    expect(await codeOf(() => anno.set('a/~help', 'x', 'k', NOW))).toBe('invalid_argument')
  })

  it('get 不存在 → null;remove 不存在 → not_found', async () => {
    expect(await anno.get('nope')).toBeNull()
    expect(await codeOf(() => anno.remove('nope'))).toBe('not_found')
  })

  it('remove 删除后 get 为 null', async () => {
    await anno.set('a', 'x', 'k', NOW)
    await anno.remove('a')
    expect(await anno.get('a')).toBeNull()
  })

  it('list 按段前缀过滤(非字符串前缀)并按 path 升序', async () => {
    await anno.set('a/b', '1', 'k', NOW)
    await anno.set('a/bx', '2', 'k', NOW)
    await anno.set('a', '3', 'k', NOW)
    await anno.set('c', '4', 'k', NOW)
    const under = await anno.list('a/b')
    expect(under.map((e) => e.path)).toEqual(['a/b'])
    const all = await anno.list()
    expect(all.map((e) => e.path)).toEqual(['a', 'a/b', 'a/bx', 'c'])
  })

  it('list 跳过脏值', async () => {
    await store.put('annotation:bad', { nope: true })
    await anno.set('good', 'x', 'k', NOW)
    expect((await anno.list()).map((e) => e.path)).toEqual(['good'])
  })
})
