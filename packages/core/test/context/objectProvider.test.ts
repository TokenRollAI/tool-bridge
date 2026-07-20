import { describe, expect, it, vi } from 'vitest'
import type { ContextEntryMeta, SearchOptions } from '../../src/context/types'
import {
  createObjectContextProvider,
  type ObjectContextProvider,
  SEARCH_METADATA_HEAD_MAX,
} from '../../src/context/objectProvider'
import { MemoryObjectStore, type ObjectStore } from '../../src/context/objectStore'
import { isTBError, type TBErrorCode } from '../../src/errors'
import { omit } from '../../src/omit'

const NOW = '2026-07-07T00:00:00.000Z'
const NS = 'ctx/main'

function makeProvider(opts: Partial<Parameters<typeof createObjectContextProvider>[1]> = {}): {
  provider: ObjectContextProvider
  store: MemoryObjectStore
} {
  const store = new MemoryObjectStore(() => NOW)
  const provider = createObjectContextProvider(store, { nsPath: NS, ...opts })
  return { store, provider }
}

async function codeOf(p: Promise<unknown>): Promise<TBErrorCode | string | null> {
  try {
    await p
    return null
  } catch (e) {
    return isTBError(e) ? e.code : `非TBError:${String(e)}`
  }
}

describe('Write', () => {
  it('创建条目并返回 Meta(uri 形状 node://<nsPath>/<entryPath>)', async () => {
    const { provider } = makeProvider()
    const meta = await provider.Write('notes/a.md', {
      contentType: 'text/markdown',
      content: '# hi',
      metadata: { topic: 'demo' },
    })
    expect(meta).toMatchObject({
      uri: `node://${NS}/notes/a.md`,
      contentType: 'text/markdown',
      size: 4,
      updatedAt: NOW,
      metadata: { topic: 'demo' },
    })
    expect(meta.version).not.toBe('')
  })

  it('幂等 upsert:复写同 path 不报 conflict,version 前进、内容替换', async () => {
    const { provider } = makeProvider()
    const m1 = await provider.Write('a.txt', { contentType: 'text/plain', content: 'one' })
    const m2 = await provider.Write('a.txt', { contentType: 'text/plain', content: 'two' })
    expect(m2.version).not.toBe(m1.version)
    expect((await provider.Get('a.txt')).content).toBe('two')
  })

  it('非 string content:JSON.stringify 存储,contentType 缺省 application/json', async () => {
    const { provider } = makeProvider()
    const meta = await provider.Write('cfg.json', {
      contentType: '',
      content: { a: 1 },
    })
    expect(meta.contentType).toBe('application/json')
    expect((await provider.Get('cfg.json')).content).toEqual({ a: 1 })
    // contentType 字段整个缺省同样落 application/json(可选)
    const meta2 = await provider.Write('cfg2.json', { content: { b: 2 } })
    expect(meta2.contentType).toBe('application/json')
  })

  it('非 string content 且显式 contentType:不被覆盖', async () => {
    const { provider } = makeProvider()
    const meta = await provider.Write('v.json', {
      contentType: 'application/vnd.x+json',
      content: [1],
    })
    expect(meta.contentType).toBe('application/vnd.x+json')
  })

  it('content 缺失 / string content 无 contentType → invalid_argument', async () => {
    const { provider } = makeProvider()
    expect(await codeOf(provider.Write('x', { contentType: 'text/plain' } as never))).toBe(
      'invalid_argument',
    )
    expect(await codeOf(provider.Write('x', { contentType: '', content: 's' }))).toBe(
      'invalid_argument',
    )
    expect(await codeOf(provider.Write('x', { content: 's' }))).toBe('invalid_argument')
  })

  it('ifVersion:匹配放行;不匹配 / 条目不存在 → conflict', async () => {
    const { provider } = makeProvider()
    const m1 = await provider.Write('v.txt', { contentType: 'text/plain', content: '1' })
    await provider.Write('v.txt', {
      contentType: 'text/plain',
      content: '2',
      ifVersion: m1.version,
    })
    expect(
      await codeOf(
        provider.Write('v.txt', { contentType: 'text/plain', content: '3', ifVersion: m1.version }),
      ),
    ).toBe('conflict')
    expect(
      await codeOf(
        provider.Write('ghost', { contentType: 'text/plain', content: 'x', ifVersion: 'v0' }),
      ),
    ).toBe('conflict')
  })
})

describe('Get', () => {
  it('不存在 → not_found', async () => {
    const { provider } = makeProvider()
    expect(await codeOf(provider.Get('nope.md'))).toBe('not_found')
  })

  it('text/* 内联;application/json 内联并 JSON.parse', async () => {
    const { provider } = makeProvider()
    await provider.Write('t.md', { contentType: 'text/markdown; charset=utf-8', content: 'md' })
    await provider.Write('j.json', { contentType: 'application/json', content: '{"a":1}' })
    expect((await provider.Get('t.md')).content).toBe('md')
    expect((await provider.Get('j.json')).content).toEqual({ a: 1 })
  })

  it('application/json 但 JSON.parse 失败 → 按原文本返回', async () => {
    const { provider } = makeProvider()
    await provider.Write('bad.json', { contentType: 'application/json', content: 'oops{' })
    expect((await provider.Get('bad.json')).content).toBe('oops{')
  })

  it('head 后对象消失(竞态)→ not_found', async () => {
    const { store, provider } = makeProvider()
    await provider.Write('r.txt', { contentType: 'text/plain', content: 'x' })
    vi.spyOn(store, 'get').mockResolvedValue(null)
    expect(await codeOf(provider.Get('r.txt'))).toBe('not_found')
  })

  it('存量对象无 contentType:Meta 回落 application/octet-stream 并走 $ref', async () => {
    const { store, provider } = makeProvider({ relayRefUrl: key => `https://relay/${key}` })
    await store.put('raw.bin', 'data')
    const entry = await provider.Get('raw.bin')
    expect(entry.contentType).toBe('application/octet-stream')
    expect(entry.content).toEqual({ $ref: 'https://relay/raw.bin' })
  })

  it('$ref 阈值:== 阈值内联,+1 走 relayRefUrl 且不读 body', async () => {
    const { store, provider } = makeProvider({
      refThresholdBytes: 8,
      relayRefUrl: key => `https://relay/${key}`,
    })
    await provider.Write('small.txt', { contentType: 'text/plain', content: '12345678' })
    await provider.Write('big.txt', { contentType: 'text/plain', content: '123456789' })
    expect((await provider.Get('small.txt')).content).toBe('12345678')
    const getSpy = vi.spyOn(store, 'get')
    const big = await provider.Get('big.txt')
    expect(big.content).toEqual({ $ref: 'https://relay/big.txt' })
    expect(getSpy).not.toHaveBeenCalled()
  })

  it('非文本 contentType(小对象)也走 $ref', async () => {
    const { provider } = makeProvider({ relayRefUrl: key => `https://relay/${key}` })
    await provider.Write('bin', { contentType: 'application/octet-stream', content: 'xx' })
    expect((await provider.Get('bin')).content).toEqual({ $ref: 'https://relay/bin' })
  })

  it('presign 优先于 relayRefUrl,携带 presignTtlSec(缺省 900)', async () => {
    const store = new MemoryObjectStore(() => NOW)
    const withPresign: ObjectStore = Object.assign(store, {
      presign: async (key: string, ttlSec: number) => `https://signed/${key}?ttl=${ttlSec}`,
    })
    const provider = createObjectContextProvider(withPresign, {
      nsPath: NS,
      relayRefUrl: key => `https://relay/${key}`,
    })
    await provider.Write('bin', { contentType: 'application/octet-stream', content: 'xx' })
    expect((await provider.Get('bin')).content).toEqual({ $ref: 'https://signed/bin?ttl=900' })
    const provider60 = createObjectContextProvider(withPresign, { nsPath: NS, presignTtlSec: 60 })
    expect((await provider60.Get('bin')).content).toEqual({ $ref: 'https://signed/bin?ttl=60' })
  })

  it('relayRefUrl 可为异步工厂(网关 HMAC 签 token 场景)', async () => {
    const { provider } = makeProvider({
      relayRefUrl: async key => `https://relay/${key}?signed=1`,
    })
    await provider.Write('bin', { contentType: 'application/octet-stream', content: 'xx' })
    expect((await provider.Get('bin')).content).toEqual({ $ref: 'https://relay/bin?signed=1' })
  })

  it('presign 与 relayRefUrl 都缺 → unavailable', async () => {
    const { provider } = makeProvider()
    await provider.Write('bin', { contentType: 'application/octet-stream', content: 'xx' })
    expect(await codeOf(provider.Get('bin'))).toBe('unavailable')
  })
})

describe('Update', () => {
  it('不存在 → not_found', async () => {
    const { provider } = makeProvider()
    expect(await codeOf(provider.Update('nope', { content: 'x' }))).toBe('not_found')
  })

  it('空 patch(无 content 也无 metadata)→ invalid_argument', async () => {
    const { provider } = makeProvider()
    await provider.Write('a.txt', { contentType: 'text/plain', content: 'keep' })
    expect(await codeOf(provider.Update('a.txt', {}))).toBe('invalid_argument')
    expect(await codeOf(provider.Update('a.txt', { ifVersion: 'v1' }))).toBe('invalid_argument')
  })

  it('仅 metadata:浅合并(同键覆盖、异键保留),content 原样保留', async () => {
    const { provider } = makeProvider()
    await provider.Write('a.txt', {
      contentType: 'text/plain',
      content: 'keep me',
      metadata: { a: '1', b: '2' },
    })
    const meta = await provider.Update('a.txt', { metadata: { b: '3' } })
    expect(meta.metadata).toEqual({ a: '1', b: '3' })
    const entry = await provider.Get('a.txt')
    expect(entry.content).toBe('keep me')
    expect(entry.metadata).toEqual({ a: '1', b: '3' })
  })

  it('content 替换:version 前进、contentType 不变', async () => {
    const { provider } = makeProvider()
    const m1 = await provider.Write('a.md', { contentType: 'text/markdown', content: 'v1' })
    const m2 = await provider.Update('a.md', { content: 'v2' })
    expect(m2.version).not.toBe(m1.version)
    expect(m2.contentType).toBe('text/markdown')
    expect((await provider.Get('a.md')).content).toBe('v2')
  })

  it('ifVersion:匹配放行;不匹配 → conflict', async () => {
    const { provider } = makeProvider()
    const m1 = await provider.Write('a.txt', { contentType: 'text/plain', content: '1' })
    const m2 = await provider.Update('a.txt', { content: '2', ifVersion: m1.version })
    expect(await codeOf(provider.Update('a.txt', { content: '3', ifVersion: m1.version }))).toBe(
      'conflict',
    )
    await provider.Update('a.txt', { content: '3', ifVersion: m2.version })
    expect((await provider.Get('a.txt')).content).toBe('3')
  })

  it('content 为对象:JSON 序列化存储', async () => {
    const { provider } = makeProvider()
    await provider.Write('a.json', { contentType: 'application/json', content: '{"a":1}' })
    await provider.Update('a.json', { content: { b: 2 } })
    expect((await provider.Get('a.json')).content).toEqual({ b: 2 })
  })

  it('head 后对象消失(竞态)→ not_found', async () => {
    const { store, provider } = makeProvider()
    await provider.Write('a.txt', { contentType: 'text/plain', content: 'x' })
    vi.spyOn(store, 'get').mockResolvedValue(null)
    expect(await codeOf(provider.Update('a.txt', { metadata: { k: '2' } }))).toBe('not_found')
  })
})

describe('Delete', () => {
  it('删除后 Get → not_found;不存在时静默(幂等)', async () => {
    const { provider } = makeProvider()
    await provider.Write('a.txt', { contentType: 'text/plain', content: 'x' })
    await provider.Delete('a.txt')
    expect(await codeOf(provider.Get('a.txt'))).toBe('not_found')
    await provider.Delete('a.txt')
  })
})

describe('List', () => {
  async function seed(provider: ObjectContextProvider): Promise<void> {
    await provider.Write('a.md', { contentType: 'text/markdown', content: 'a' })
    await provider.Write('docs/one.md', { contentType: 'text/markdown', content: '1' })
    await provider.Write('docs/two.md', { contentType: 'text/markdown', content: '2' })
    await provider.Write('docs/deep/three.md', { contentType: 'text/markdown', content: '3' })
  }

  it('浅层列举:子前缀折叠为目录条目(uri 尾 /、x-directory、version 空、无 size)', async () => {
    const { provider } = makeProvider()
    await seed(provider)
    const top = await provider.List('')
    expect(top.items.map(i => i.uri)).toEqual([`node://${NS}/a.md`, `node://${NS}/docs/`])
    const dir = top.items[1] as ContextEntryMeta
    expect(dir.contentType).toBe('application/x-directory')
    expect(dir.version).toBe('')
    expect(dir.size).toBeUndefined()
  })

  it('非空 prefix 补尾 /;跳过与 prefix 同名的占位对象', async () => {
    const { store, provider } = makeProvider()
    await seed(provider)
    await store.put('docs/', '')
    const page = await provider.List('docs')
    expect(page.items.map(i => i.uri)).toEqual([
      `node://${NS}/docs/deep/`,
      `node://${NS}/docs/one.md`,
      `node://${NS}/docs/two.md`,
    ])
  })

  it('分页:limit + cursor 透传;limit 超上限静默钳制、非法 limit 拒绝', async () => {
    const { provider } = makeProvider()
    await seed(provider)
    const p1 = await provider.List('docs', { limit: 2 })
    expect(p1.items).toHaveLength(2)
    expect(p1.cursor).toBeDefined()
    const p2 = await provider.List('docs', { limit: 2, cursor: p1.cursor })
    expect(p2.items.map(i => i.uri)).toEqual([`node://${NS}/docs/two.md`])
    expect(p2.cursor).toBeUndefined()
    await provider.List('', { limit: 500 })
    expect(await codeOf(provider.List('', { limit: 0 }))).toBe('invalid_argument')
  })

  it('未声明的 filter 键 → invalid_argument;空 filter 对象放行;limit 非整数拒绝', async () => {
    const { provider } = makeProvider()
    expect(await codeOf(provider.List('', { filter: { k: 'v' } }))).toBe('invalid_argument')
    await provider.List('', { filter: {} })
    expect(await codeOf(provider.List('', { limit: 1.5 }))).toBe('invalid_argument')
  })

  it('keyPrefix:落盘 key 带前缀、uri 不带', async () => {
    const { store, provider } = makeProvider({ keyPrefix: 'tenant' })
    const meta = await provider.Write('x.md', { contentType: 'text/markdown', content: 'x' })
    expect(meta.uri).toBe(`node://${NS}/x.md`)
    expect(await store.head('tenant/x.md')).not.toBeNull()
    const page = await provider.List('')
    expect(page.items.map(i => i.uri)).toEqual([`node://${NS}/x.md`])
  })
})

describe('Search', () => {
  it('keyword(缺省):路径名与 metadata 值大小写不敏感子串匹配、深层召回、不拉 body', async () => {
    const { store, provider } = makeProvider()
    await provider.Write('docs/Alpha-notes.md', { contentType: 'text/markdown', content: 'x' })
    await provider.Write('docs/deep/beta.md', {
      contentType: 'text/markdown',
      content: 'x',
      metadata: { topic: 'ALPHA' },
    })
    await provider.Write('other.md', { contentType: 'text/markdown', content: 'x' })
    const getSpy = vi.spyOn(store, 'get')
    const page = await provider.Search('alpha')
    expect(page.items.map(i => i.uri).sort()).toEqual([
      `node://${NS}/docs/Alpha-notes.md`,
      `node://${NS}/docs/deep/beta.md`,
    ])
    expect(getSpy).not.toHaveBeenCalled()
  })

  it('分页:limit + cursor 续接', async () => {
    const { provider } = makeProvider()
    await provider.Write('note1.md', { contentType: 'text/markdown', content: 'x' })
    await provider.Write('note2.md', { contentType: 'text/markdown', content: 'x' })
    await provider.Write('note3.md', { contentType: 'text/markdown', content: 'x' })
    const p1 = await provider.Search('note', { limit: 2 })
    expect(p1.items).toHaveLength(2)
    expect(p1.cursor).toBeDefined()
    const p2 = await provider.Search('note', { limit: 2, cursor: p1.cursor })
    expect(p2.items.map(i => i.uri)).toEqual([`node://${NS}/note3.md`])
    expect(p2.cursor).toBeUndefined()
  })

  it('mode=semantic(未声明 capability)/ 未知 mode / 空 query → invalid_argument', async () => {
    const { provider } = makeProvider()
    expect(await codeOf(provider.Search('q', { mode: 'semantic' }))).toBe('invalid_argument')
    expect(await codeOf(provider.Search('q', { mode: 'fuzzy' } as unknown as SearchOptions))).toBe(
      'invalid_argument',
    )
    expect(await codeOf(provider.Search(''))).toBe('invalid_argument')
    expect(await codeOf(provider.Search(123 as unknown as string))).toBe('invalid_argument')
  })

  it('内部深层遍历跨多页(>200 对象仍能召回末尾条目)', async () => {
    const { store, provider } = makeProvider()
    for (let i = 0; i < 201; i++) {
      await store.put(`bulk/item-${String(i).padStart(3, '0')}.txt`, 'x')
    }
    await store.put('zz-target.md', 'x')
    const page = await provider.Search('zz-target')
    expect(page.items.map(i => i.uri)).toEqual([`node://${NS}/zz-target.md`])
    expect(page.cursor).toBeUndefined()
  })

  it('list 结果混入 { prefix } 条目(防御)时跳过', async () => {
    const base = new MemoryObjectStore(() => NOW)
    const store: ObjectStore = {
      head: k => base.head(k),
      get: k => base.get(k),
      put: (k, b, o) => base.put(k, b, o),
      delete: k => base.delete(k),
      list: async (p, o) => {
        const res = await base.list(p, o)
        return { ...res, items: [{ prefix: 'fake/' }, ...res.items] }
      },
    }
    const provider = createObjectContextProvider(store, { nsPath: NS })
    await base.put('hit.md', 'x')
    const page = await provider.Search('hit')
    expect(page.items.map(i => i.uri)).toEqual([`node://${NS}/hit.md`])
  })

  /** 模拟 s3:list 条目不带 metadata(undefined),head 才有。 */
  function makeMetadataLessListStore(base: MemoryObjectStore): ObjectStore {
    return {
      head: k => base.head(k),
      get: k => base.get(k),
      put: (k, b, o) => base.put(k, b, o),
      delete: k => base.delete(k),
      list: async (p, o) => {
        const res = await base.list(p, o)
        return {
          ...res,
          items: res.items.map((i) => {
            if ('prefix' in i) return i
            return omit(i, 'metadata')
          }),
        }
      },
    }
  }

  it('list 不带 metadata(如 s3):head 补取后按 metadata 值召回;路径已命中的不 head', async () => {
    const base = new MemoryObjectStore(() => NOW)
    const provider = createObjectContextProvider(makeMetadataLessListStore(base), { nsPath: NS })
    await provider.Write('docs/alpha.md', { contentType: 'text/markdown', content: 'x' })
    await provider.Write('docs/beta.md', {
      contentType: 'text/markdown',
      content: 'y',
      metadata: { topic: 'ALPHA' },
    })
    await provider.Write('other.md', { contentType: 'text/markdown', content: 'z' })
    const headSpy = vi.spyOn(base, 'head')
    const page = await provider.Search('alpha')
    expect(page.items.map(i => i.uri).sort()).toEqual([
      `node://${NS}/docs/alpha.md`,
      `node://${NS}/docs/beta.md`,
    ])
    // metadata 命中的条目采用 head 的完整 meta
    const beta = page.items.find(i => i.uri.endsWith('beta.md')) as ContextEntryMeta
    expect(beta.metadata).toEqual({ topic: 'ALPHA' })
    expect(beta.contentType).toBe('text/markdown')
    // 只对路径未命中的候选 head(beta.md 与 other.md),路径命中的 alpha.md 不 head
    expect(headSpy).toHaveBeenCalledTimes(2)
  })

  it('head 补取有界:预算耗尽后剩余候选只按路径名匹配', async () => {
    const base = new MemoryObjectStore(() => NOW)
    const provider = createObjectContextProvider(makeMetadataLessListStore(base), { nsPath: NS })
    // 前 200 个(字典序)无命中 metadata 的填充对象耗尽预算
    for (let i = 0; i < SEARCH_METADATA_HEAD_MAX; i++) {
      await base.put(`filler-${String(i).padStart(3, '0')}.txt`, 'x')
    }
    // 预算耗尽后:metadata 命中的召回不到,路径命中的仍召回
    await base.put('x-by-meta.md', 'x', { metadata: { tag: 'needle' } })
    await base.put('zz-needle.md', 'x')
    const headSpy = vi.spyOn(base, 'head')
    const page = await provider.Search('needle')
    expect(page.items.map(i => i.uri)).toEqual([`node://${NS}/zz-needle.md`])
    expect(headSpy).toHaveBeenCalledTimes(SEARCH_METADATA_HEAD_MAX)
  })
})

describe('readOnly 挂载', () => {
  it('Write/Update/Delete → permission_denied;List/Get/Search 照常', async () => {
    const store = new MemoryObjectStore(() => NOW)
    const rw = createObjectContextProvider(store, { nsPath: NS })
    await rw.Write('a.txt', { contentType: 'text/plain', content: 'x' })
    const ro = createObjectContextProvider(store, { nsPath: NS, readOnly: true })
    expect(await codeOf(ro.Write('b.txt', { contentType: 'text/plain', content: 'y' }))).toBe(
      'permission_denied',
    )
    expect(await codeOf(ro.Update('a.txt', { content: 'z' }))).toBe('permission_denied')
    expect(await codeOf(ro.Delete('a.txt'))).toBe('permission_denied')
    expect((await ro.List('')).items).toHaveLength(1)
    expect((await ro.Get('a.txt')).content).toBe('x')
    expect((await ro.Search('a')).items).toHaveLength(1)
  })
})

describe('路径穿越拒绝(所有动词先过 normalizeEntryPath)', () => {
  it('Get/Write/Update/Delete/List 对穿越路径 → invalid_argument', async () => {
    const { provider } = makeProvider()
    expect(await codeOf(provider.Get('../x'))).toBe('invalid_argument')
    expect(await codeOf(provider.Write('/abs', { contentType: 'text/plain', content: 'x' }))).toBe(
      'invalid_argument',
    )
    expect(await codeOf(provider.Update('%2e%2e/x', { content: 'x' }))).toBe('invalid_argument')
    expect(await codeOf(provider.Delete('a/../..'))).toBe('invalid_argument')
    expect(await codeOf(provider.List('..'))).toBe('invalid_argument')
  })
})
