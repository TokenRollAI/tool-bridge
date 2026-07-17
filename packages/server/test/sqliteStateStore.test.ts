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

  it('list 前缀过滤 + 字典序排序(含 _ % [ 与中文 key)', async () => {
    await contract(async (store) => {
      await seed(store)
      return {
        nodes: (await store.list('node:')).items.map(i => i.key),
        exactUnderscore: (await store.list('node:a_')).items.map(i => i.key),
        percent: (await store.list('node:a%')).items.map(i => i.key),
        bracket: (await store.list('node:a[')).items.map(i => i.key),
        cjk: (await store.list('node:中文/')).items.map(i => i.key),
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
