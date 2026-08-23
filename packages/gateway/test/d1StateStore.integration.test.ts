/**
 * D1StateStore 契约测试(真实 workerd + miniflare D1):与 core MemoryStateStore
 * 行为对拍(排序、cursor 翻页、前缀过滤含 SQL 通配符与多字节 key)+ D1 特有断言
 * (putIfAbsent 原子语义、与 search 同库共存不串味)。
 *
 * 与 server 的 sqliteStateStore.test / pgStateStore.test 是同一族:三宿主 StateStore
 * 全部收敛到 SQL 语义后,契约对拍是防语义漂移的闸门。
 */

import { MemoryStateStore, type StateStore } from '@tool-bridge/core'
import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { D1SearchIndex } from '../src/search/d1SearchIndex'
import { D1StateStore } from '../src/d1StateStore'

const db = (env as { TB_STATE: D1Database }).TB_STATE

/** 同一操作序列在两个实现上执行,断言输出一致。key 加轮次前缀隔离(D1 库测试间共享)。 */
let round = 0
async function contract(run: (store: StateStore, ns: string) => Promise<unknown>): Promise<void> {
  const ns = `t${round++}:`
  const d1 = new D1StateStore(db)
  const memory = new MemoryStateStore()
  expect(await run(d1, ns)).toEqual(await run(memory, ns))
}

describe('D1StateStore 契约(对拍 MemoryStateStore)', () => {
  it('get/put/delete 往返;get 未命中 → null', async () => {
    await contract(async (store, ns) => {
      await store.put(`${ns}node:a`, { path: 'a' })
      const hit = await store.get(`${ns}node:a`)
      await store.delete(`${ns}node:a`)
      return { hit, afterDelete: await store.get(`${ns}node:a`), miss: await store.get(`${ns}nope`) }
    })
  })

  it('getMany 批量读取去重并忽略不存在 key(含跨 50 分块)', async () => {
    await contract(async (store, ns) => {
      const keys: string[] = []
      for (let i = 0; i < 120; i++) {
        const key = `${ns}k:${String(i).padStart(3, '0')}`
        keys.push(key)
        if (i % 2 === 0) await store.put(key, i)
      }
      const got = await store.getMany([...keys, keys[0] ?? ''])
      return { size: got.size, first: got.get(keys[0] ?? ''), missing: got.has(keys[1] ?? '') }
    })
  })

  it('list 前缀过滤 + 字典序排序(含 _ % 与中文 key)', async () => {
    await contract(async (store, ns) => {
      await store.put(`${ns}p:a_b`, 1)
      await store.put(`${ns}p:a%c`, 2)
      await store.put(`${ns}p:中文`, 3)
      await store.put(`${ns}q:other`, 4)
      const res = await store.list(`${ns}p:`)
      return res.items.map(i => i.key)
    })
  })

  it('cursor 翻页:limit 逐页取完,cursor 仅在还有更多时返回', async () => {
    await contract(async (store, ns) => {
      for (let i = 0; i < 5; i++) await store.put(`${ns}pg:${i}`, i)
      const first = await store.list(`${ns}pg:`, { limit: 2 })
      const second = await store.list(`${ns}pg:`, { cursor: first.cursor, limit: 2 })
      const third = await store.list(`${ns}pg:`, { cursor: second.cursor, limit: 2 })
      return {
        pages: [first.items.map(i => i.key), second.items.map(i => i.key), third.items.map(i => i.key)],
        cursors: [first.cursor !== undefined, second.cursor !== undefined, third.cursor],
      }
    })
  })

  it('值 JSON 往返保真(嵌套对象/数组/null/数字)', async () => {
    await contract(async (store, ns) => {
      const value = { arr: [1, 'x', null], nested: { deep: { flag: true } }, n: 3.14 }
      await store.put(`${ns}v`, value)
      return await store.get(`${ns}v`)
    })
  })

  it('putIfAbsent:首写 true;已存在 false 且不覆盖旧值', async () => {
    await contract(async (store, ns) => {
      const first = await store.putIfAbsent?.(`${ns}once`, 'winner')
      const second = await store.putIfAbsent?.(`${ns}once`, 'loser')
      return { first, second, value: await store.get(`${ns}once`) }
    })
  })

  it('D1 Session 内保持 read-my-own-writes', async () => {
    const store = new D1StateStore(db.withSession('first-primary'))
    const key = `session:${round++}`
    await store.put(key, { revision: 1 })
    expect(await store.get(key)).toEqual({ revision: 1 })
    await store.put(key, { revision: 2 })
    expect(await store.get(key)).toEqual({ revision: 2 })
  })
})

describe('与 search 同库共存', () => {
  it('state 表与 search 表互不串味(同一 D1 库)', async () => {
    const state = new D1StateStore(db)
    await state.put('coexist:probe', { ok: true })
    // 同库初始化 search schema 并触发一次查询,state 数据不受影响。
    const search = new D1SearchIndex((env as { TB_SEARCH: D1Database }).TB_SEARCH)
    await search.rebuild([])
    expect(await state.get('coexist:probe')).toEqual({ ok: true })
  })
})
