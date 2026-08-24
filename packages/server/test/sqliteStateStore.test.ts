/**
 * SqliteStateStore 契约测试:与 core MemoryStateStore 行为对拍(排序、cursor 翻页、
 * 前缀过滤含 SQL 通配符字符与多字节 key)+ SQLite 特有的重开持久断言。
 */

import { MemoryStateStore, type StateStore } from '@tool-bridge/core'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteStateStore } from '../src/sqliteStateStore'

const cleanups: Array<() => void> = []

function tmpDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tb-sqlite-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return join(dir, 'state.sqlite3')
}

afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
})

/** 同一操作序列在两个实现上执行,断言输出一致。 */
async function contract(run: (store: StateStore) => Promise<unknown>): Promise<void> {
  const sqlite = new SqliteStateStore(tmpDbPath())
  cleanups.push(() => sqlite.close())
  const memory = new MemoryStateStore()
  expect(await run(sqlite)).toEqual(await run(memory))
}

// 覆盖 SQL 通配符(_ % [)、路径段、多字节(BMP 中文)。
const KEYS = [
  'node:a/b',
  'node:a/b/c',
  'node:a_b',
  'node:a%b',
  'node:a[1]',
  'node:中文/路径',
  // 补充平面(代理对):prefixUpperBound 按 code unit 加一会拆开代理对,
  // 让 upper bound 的 UTF-8 字节序小于 prefix,子树查询恒空。
  'node:🏿',
  'node:🏿/child',
  'node:🏿/child/deep',
  'sk:h:aaa',
  'sk:h:bbb',
  'sk:i:001',
]

async function seed(store: StateStore): Promise<void> {
  // 乱序写入,验证 list 排序。
  for (const key of [...KEYS].reverse()) {
    await store.put(key, { key })
  }
}

describe('SqliteStateStore 契约(vs MemoryStateStore)', () => {
  it('get/put/delete 往返;get 未命中 → null', async () => {
    await contract(async (store) => {
      await store.put('k1', { a: 1, nested: { b: 'x' } })
      const hit = await store.get('k1')
      await store.delete('k1')
      const miss = await store.get('k1')
      const neverExisted = await store.get('k2')
      await store.delete('k2') // 幂等删除不抛
      return { hit, miss, neverExisted }
    })
  })

  it('getMany 批量读取去重并忽略不存在 key', async () => {
    await contract(async (store) => {
      await seed(store)
      return [...(await store.getMany([
        'node:a/b',
        'missing',
        'node:a/b',
        'sk:h:bbb',
      ])).entries()]
    })
  })

  it('list 前缀过滤 + 字典序排序(含 _ % [ 与中文 key)', async () => {
    await contract(async (store) => {
      await seed(store)
      return {
        nodes: (await store.list('node:')).items.map(i => i.key),
        exactUnderscore: (await store.list('node:a_')).items.map(i => i.key),
        percent: (await store.list('node:a%')).items.map(i => i.key),
        bracket: (await store.list('node:a[')).items.map(i => i.key),
        cjk: (await store.list('node:中文/')).items.map(i => i.key),
        // 代理对 prefix:必须取到自身与整棵子树。
        astral: (await store.list('node:🏿')).items.map(i => i.key),
        astralSubtree: (await store.list('node:🏿/')).items.map(i => i.key),
        all: (await store.list('')).items.map(i => i.key),
        missPrefix: (await store.list('zzz:')).items,
      }
    })
  })

  it('cursor 翻页:limit 逐页取完,cursor 仅在还有更多时返回', async () => {
    await contract(async (store) => {
      await seed(store)
      const pages: string[][] = []
      let cursor: string | undefined
      for (;;) {
        const res = await store.list('node:', { limit: 2, ...(cursor ? { cursor } : {}) })
        pages.push(res.items.map(i => i.key))
        if (res.cursor === undefined) break
        cursor = res.cursor
      }
      return pages
    })
  })

  it('limit 恰好取尽时不返回 cursor', async () => {
    await contract(async (store) => {
      await store.put('p:1', 1)
      await store.put('p:2', 2)
      const res = await store.list('p:', { limit: 2 })
      return { keys: res.items.map(i => i.key), cursor: res.cursor }
    })
  })

  it('值 JSON 往返保真(嵌套对象/数组/null/数字)', async () => {
    await contract(async (store) => {
      const value = { arr: [1, 'x', null], nested: { deep: { flag: true } }, n: 3.14 }
      await store.put('v', value)
      return await store.get('v')
    })
  })

  it('putIfAbsent:首写 true;已存在 false 且不覆盖旧值', async () => {
    await contract(async (store) => {
      const first = await store.putIfAbsent?.('once', 'winner')
      const second = await store.putIfAbsent?.('once', 'loser')
      return { first, second, value: await store.get('once') }
    })
  })

  it('compareAndSwap:创建、revision 替换/删除与失配语义对拍', async () => {
    await contract(async (store) => {
      expect(store.compareAndSwap).toBeTypeOf('function')
      const cas = store.compareAndSwap!.bind(store)
      const missingDelete = await cas('cas', null, null)
      const created = await cas('cas', null, { revision: 0, state: 'pending' })
      const duplicate = await cas('cas', null, { revision: 0, state: 'other' })
      const stale = await cas('cas', 1, { revision: 2 })
      const replaced = await cas('cas', 0, { revision: 1, state: 'ready' })
      const staleDelete = await cas('cas', 0, null)
      const deleted = await cas('cas', 1, null)
      await store.put('cas:bad', { revision: true })
      const booleanRevision = await cas('cas:bad', 1, { revision: 2 })
      await store.put('cas:fractional', { revision: 1.5 })
      const fractionalRevision = await cas('cas:fractional', 1, { revision: 2 })
      return {
        missingDelete,
        created,
        duplicate,
        stale,
        replaced,
        staleDelete,
        deleted,
        booleanRevision,
        fractionalRevision,
        value: await store.get('cas'),
      }
    })
  })
})

describe('SQLite compareAndSwap 并发', () => {
  it('两个连接竞争同一 revision，只有一个原子推进', async () => {
    const dbPath = tmpDbPath()
    const first = new SqliteStateStore(dbPath)
    const second = new SqliteStateStore(dbPath)
    cleanups.push(() => first.close(), () => second.close())
    await first.put('race', { revision: 0, state: 'pending' })

    const results = await Promise.all([
      first.compareAndSwap('race', 0, { revision: 1, winner: 'first' }),
      second.compareAndSwap('race', 0, { revision: 1, winner: 'second' }),
    ])

    expect(results.sort()).toEqual([false, true])
    expect(await first.get('race')).toMatchObject({ revision: 1 })
  })
})

describe('SQLite 持久化(重开同一 db 文件)', () => {
  it('close 后重开,数据仍在', async () => {
    const dbPath = tmpDbPath()
    const first = new SqliteStateStore(dbPath)
    await first.put('node:persisted', { path: 'persisted' })
    first.close()

    const second = new SqliteStateStore(dbPath)
    cleanups.push(() => second.close())
    expect(await second.get('node:persisted')).toEqual({ path: 'persisted' })
    expect((await second.list('node:')).items).toHaveLength(1)
  })
})
