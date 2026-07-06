import { describe, expect, it } from 'vitest'
import { MemoryObjectStore, type ObjectMeta, readStreamText } from '../../src/context/objectStore'
import { isTBError } from '../../src/errors'

const NOW = '2026-07-07T00:00:00.000Z'

async function readBody(store: MemoryObjectStore, key: string): Promise<string> {
  const got = await store.get(key)
  if (!got) throw new Error(`对象不存在:${key}`)
  return readStreamText(got.body)
}

describe('MemoryObjectStore', () => {
  it('put → head/get 往返;meta 字段齐全', async () => {
    const s = new MemoryObjectStore(() => NOW)
    const meta = await s.put('a/b.md', 'hello', {
      contentType: 'text/markdown',
      metadata: { k: 'v' },
    })
    expect(meta).toMatchObject({
      key: 'a/b.md',
      size: 5,
      contentType: 'text/markdown',
      updatedAt: NOW,
      metadata: { k: 'v' },
    })
    expect(meta.etag).not.toBe('')
    expect(await s.head('a/b.md')).toEqual(meta)
    const got = await s.get('a/b.md')
    expect(got?.meta).toEqual(meta)
    expect(await readBody(s, 'a/b.md')).toBe('hello')
  })

  it('不存在的 key:head/get → null', async () => {
    const s = new MemoryObjectStore()
    expect(await s.head('nope')).toBeNull()
    expect(await s.get('nope')).toBeNull()
  })

  it('body 支持 string / Uint8Array / ArrayBuffer / 流', async () => {
    const s = new MemoryObjectStore()
    await s.put('u8', new Uint8Array([104, 105]))
    expect(await readBody(s, 'u8')).toBe('hi')
    await s.put('ab', new Uint8Array([111, 107]).buffer as ArrayBuffer)
    expect(await readBody(s, 'ab')).toBe('ok')
    const got = await s.get('u8')
    if (!got) throw new Error('expected u8')
    await s.put('copy', got.body)
    expect(await readBody(s, 'copy')).toBe('hi')
  })

  it('复写同 key:etag 变化、内容替换(upsert)', async () => {
    const s = new MemoryObjectStore()
    const m1 = await s.put('k', 'one')
    const m2 = await s.put('k', 'two')
    expect(m2.etag).not.toBe(m1.etag)
    expect(await readBody(s, 'k')).toBe('two')
  })

  it('ifMatchEtag:匹配放行;不匹配 / 对象不存在 → conflict', async () => {
    const s = new MemoryObjectStore()
    const m1 = await s.put('k', 'one')
    await s.put('k', 'two', { ifMatchEtag: m1.etag })
    await expect(s.put('k', 'three', { ifMatchEtag: m1.etag })).rejects.toSatisfy(
      (e) => isTBError(e) && e.code === 'conflict',
    )
    await expect(s.put('ghost', 'x', { ifMatchEtag: 'v0' })).rejects.toSatisfy(
      (e) => isTBError(e) && e.code === 'conflict',
    )
  })

  it('delete 幂等', async () => {
    const s = new MemoryObjectStore()
    await s.put('k', 'v')
    await s.delete('k')
    await s.delete('k')
    expect(await s.head('k')).toBeNull()
  })

  it('list 带 delimiter:浅层折叠子前缀(去重)、与文件按字典序混排', async () => {
    const s = new MemoryObjectStore()
    await s.put('a.md', '1')
    await s.put('dir/x.md', '2')
    await s.put('dir/y.md', '3')
    await s.put('dir/sub/z.md', '4')
    await s.put('other/o.md', '5')

    const top = await s.list('', { delimiter: '/' })
    expect(top.cursor).toBeUndefined()
    expect(top.items.map((i) => ('prefix' in i ? i.prefix : (i as ObjectMeta).key))).toEqual([
      'a.md',
      'dir/',
      'other/',
    ])

    const dir = await s.list('dir/', { delimiter: '/' })
    expect(dir.items.map((i) => ('prefix' in i ? i.prefix : (i as ObjectMeta).key))).toEqual([
      'dir/sub/',
      'dir/x.md',
      'dir/y.md',
    ])
  })

  it('list 不带 delimiter:深层全量', async () => {
    const s = new MemoryObjectStore()
    await s.put('a.md', '1')
    await s.put('dir/x.md', '2')
    await s.put('dir/sub/z.md', '3')
    const all = await s.list('')
    expect(all.items.map((i) => ('prefix' in i ? i.prefix : (i as ObjectMeta).key))).toEqual([
      'a.md',
      'dir/sub/z.md',
      'dir/x.md',
    ])
  })

  it('list 分页:limit + cursor 逐页取完', async () => {
    const s = new MemoryObjectStore()
    await s.put('a', '1')
    await s.put('b', '2')
    await s.put('c', '3')
    const p1 = await s.list('', { limit: 2 })
    expect(p1.items).toHaveLength(2)
    expect(p1.cursor).toBeDefined()
    const p2 = await s.list('', { limit: 2, cursor: p1.cursor })
    expect(p2.items.map((i) => ('prefix' in i ? i.prefix : (i as ObjectMeta).key))).toEqual(['c'])
    expect(p2.cursor).toBeUndefined()
  })

  it('list cursor 越过末尾 → 空页;limit 0 → 空页且无 cursor', async () => {
    const s = new MemoryObjectStore()
    await s.put('a', '1')
    expect((await s.list('', { cursor: 'zzz' })).items).toEqual([])
    const zero = await s.list('', { limit: 0 })
    expect(zero.items).toEqual([])
    expect(zero.cursor).toBeUndefined()
  })

  it('流 chunk 缺 value(done:false)时安全跳过', async () => {
    const s = new MemoryObjectStore()
    let step = 0
    const stream = {
      getReader() {
        return {
          async read() {
            step++
            if (step === 1) return { done: false }
            if (step === 2) return { done: false, value: new Uint8Array([104, 105]) }
            return { done: true }
          },
          releaseLock() {},
        }
      },
    }
    const meta = await s.put('k', stream)
    expect(meta.size).toBe(2)
    expect(await readBody(s, 'k')).toBe('hi')
  })
})
