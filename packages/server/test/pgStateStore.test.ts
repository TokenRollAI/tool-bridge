/**
 * PgStateStore 契约测试:与 core MemoryStateStore 行为对拍(排序、cursor 翻页、
 * 前缀过滤含 SQL 通配符字符与多字节 key)+ PG 连接复用后的持久断言。
 *
 * 需要一个真实 PG:设 TB_TEST_DATABASE_URL 才运行,否则整组 skip(CI/无 PG 环境
 * 不因此变红)。每个 describe 用独立 schema 隔离,结束后 drop。
 */

import { MemoryStateStore, type StateStore } from '@tool-bridge/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres, { type Sql } from 'postgres'
import { PgStateStore } from '../src/pgStateStore'

const DATABASE_URL = process.env.TB_TEST_DATABASE_URL
const suite = DATABASE_URL === undefined ? describe.skip : describe

let sql: Sql
const cleanups: Array<() => Promise<void>> = []

beforeAll(async () => {
  if (DATABASE_URL === undefined) return
  sql = postgres(DATABASE_URL, { max: 4, onnotice: () => {} })
})

afterAll(async () => {
  for (const fn of cleanups.splice(0)) await fn()
  if (sql !== undefined) await sql.end({ timeout: 5 })
})

/** 每次给一张干净空表的 PgStateStore(独立 schema,避免测试间串味)。 */
async function freshPg(tag: string): Promise<PgStateStore> {
  const schema = `tb_test_${tag}`
  await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
  await sql.unsafe(`CREATE SCHEMA ${schema}`)
  const scoped = postgres(DATABASE_URL as string, {
    max: 2,
    onnotice: () => {},
    connection: { search_path: schema },
  })
  cleanups.push(async () => {
    await scoped.end({ timeout: 5 })
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
  })
  const store = new PgStateStore(scoped)
  await store.ensureSchema()
  return store
}

/** 同一操作序列在 PG 与 Memory 上执行,断言输出一致。 */
async function contract(
  tag: string,
  run: (store: StateStore) => Promise<unknown>,
): Promise<void> {
  const pg = await freshPg(tag)
  const memory = new MemoryStateStore()
  expect(await run(pg)).toEqual(await run(memory))
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

suite('PgStateStore 契约(vs MemoryStateStore)', () => {
  it('get/put/delete 往返;get 未命中 → null', async () => {
    await contract('roundtrip', async (store) => {
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
    await contract('getmany', async (store) => {
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
    await contract('list', async (store) => {
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
    await contract('cursor', async (store) => {
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
    await contract('exact', async (store) => {
      await store.put('p:1', 1)
      await store.put('p:2', 2)
      const res = await store.list('p:', { limit: 2 })
      return { keys: res.items.map(i => i.key), cursor: res.cursor }
    })
  })

  it('值 JSON 往返保真(嵌套对象/数组/null/数字)', async () => {
    await contract('json', async (store) => {
      const value = { arr: [1, 'x', null], nested: { deep: { flag: true } }, n: 3.14 }
      await store.put('v', value)
      return await store.get('v')
    })
  })

  it('putIfAbsent:首写 true;已存在 false 且不覆盖旧值', async () => {
    await contract('pia', async (store) => {
      const first = await store.putIfAbsent?.('once', 'winner')
      const second = await store.putIfAbsent?.('once', 'loser')
      return { first, second, value: await store.get('once') }
    })
  })
})

suite('PG 持久化(重连同一 schema)', () => {
  it('连接释放后重连,数据仍在', async () => {
    const schema = 'tb_test_persist'
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await sql.unsafe(`CREATE SCHEMA ${schema}`)
    cleanups.push(async () => {
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    })
    const first = postgres(DATABASE_URL as string, {
      max: 1,
      onnotice: () => {},
      connection: { search_path: schema },
    })
    const firstStore = new PgStateStore(first)
    await firstStore.ensureSchema()
    await firstStore.put('node:persisted', { path: 'persisted' })
    await first.end({ timeout: 5 })

    const second = postgres(DATABASE_URL as string, {
      max: 1,
      onnotice: () => {},
      connection: { search_path: schema },
    })
    cleanups.push(async () => {
      await second.end({ timeout: 5 })
    })
    const secondStore = new PgStateStore(second)
    expect(await secondStore.get('node:persisted')).toEqual({ path: 'persisted' })
    expect((await secondStore.list('node:')).items).toHaveLength(1)
  })
})
