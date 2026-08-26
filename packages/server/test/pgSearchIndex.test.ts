/**
 * PgSearchIndex 契约测试:跑与 D1/better-sqlite3 同一份黑盒契约
 * (verifySearchIndexContract),证明 PG 后端行为对等。
 *
 * 需要真实 PG(设 TB_TEST_DATABASE_URL);缺省整组 skip。每个用例独立 schema 隔离。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TOOL_SEARCH_AUDIT_NODE_LIMIT } from '@tool-bridge/core'
import postgres, { type Sql } from 'postgres'
import { verifySearchIndexContract } from '../../core/test/search/searchIndex.fixture'
import { PgSearchIndex } from '../src/pgSearchIndex'

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

async function freshIndex(tag: string): Promise<PgSearchIndex> {
  const schema = `tb_search_test_${tag}`
  await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
  await sql.unsafe(`CREATE SCHEMA ${schema}`)
  // 隔离 schema 排在 search_path 首位,业务表落在其中;保留 public 兜底内置函数解析。
  const scoped = postgres(DATABASE_URL as string, {
    max: 2,
    onnotice: () => {},
    connection: { search_path: `${schema},public` },
  })
  cleanups.push(async () => {
    await scoped.end({ timeout: 5 })
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
  })
  return new PgSearchIndex(scoped)
}

suite('PgSearchIndex', () => {
  it('satisfies the shared LIKE search mutation contract', async () => {
    const index = await freshIndex('contract')
    await verifySearchIndexContract(index, 'contract/pg')
  })

  // 回归:postgres.js 把 bigint/COUNT 返回为字符串、EXISTS 返回 boolean。
  // 若 dialect 丢掉 ::int 归一,下面两条会分别暴露"公开类型被违反"与"no-op 判定失效"。
  it('revision 归一为 number(公开 ToolSearchCandidate 契约)', async () => {
    const index = await freshIndex('revtype')
    await index.rebuild([{
      path: 'contract/pg/revtype',
      tool: { name: 'rev_probe', description: 'revisiontypeprobe entry' },
    }])
    const page = await index.search('revisiontypeprobe')
    expect(page.items).toHaveLength(1)
    expect(typeof page.items[0]?.revision).toBe('number')
  })

  it('重复 replace 空快照不 bump revision(cursor 不被白失效)', async () => {
    const index = await freshIndex('noop')
    await index.rebuild([{
      path: 'contract/pg/noop/keep',
      tool: { name: 'keep_probe', description: 'noopkeepprobe entry' },
    }])
    const revisionOf = async (): Promise<unknown> =>
      (await index.search('noopkeepprobe')).items[0]?.revision
    // 本来就空的 path 反复 replace([]) 必须是 no-op。
    await index.replace('contract/pg/noop/empty', [])
    const before = await revisionOf()
    await index.replace('contract/pg/noop/empty', [])
    await index.replace('contract/pg/noop/empty', [])
    expect(await revisionOf()).toBe(before)
  })

  it('caps indexed paths without limiting canonical state', async () => {
    const index = await freshIndex('cap')
    await index.rebuild(Array.from({ length: TOOL_SEARCH_AUDIT_NODE_LIMIT }, (_, i) => ({
      path: `contract/pg/cap/${i}`,
      tool: { name: `cap_${i}` },
    })))
    await expect(index.replace('contract/pg/cap/overflow', [{ name: 'overflow' }]))
      .rejects.toMatchObject({ code: 'rate_limited' })
  })

  /**
   * 回归:容量判定走 COUNT(*),无锁时并发 mutation 各在自己的快照里读到 limit-1、
   * 双双放行,提交后越过上限。必须用**两个独立连接**(各自独立事务)才造得出交错——
   * 同一个 PgSearchIndex 的调用会被连接池串行掉,测不出这个 race。
   * 断言最终 path 数而非成功个数:前者是真正要守的不变量。
   */
  it('并发 replace 不突破 path 容量上限', async () => {
    const schema = 'tb_search_test_race'
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await sql.unsafe(`CREATE SCHEMA ${schema}`)
    const connect = (): Sql => postgres(DATABASE_URL as string, {
      max: 1,
      onnotice: () => {},
      connection: { search_path: `${schema},public` },
    })
    const a = connect()
    const b = connect()
    cleanups.push(async () => {
      await a.end({ timeout: 5 })
      await b.end({ timeout: 5 })
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    })
    const indexA = new PgSearchIndex(a)
    const indexB = new PgSearchIndex(b)
    // 填到 limit-1,只剩一个名额给下面两个并发写。
    await indexA.rebuild(Array.from({ length: TOOL_SEARCH_AUDIT_NODE_LIMIT - 1 }, (_, i) => ({
      path: `contract/pg/race/${i}`,
      tool: { name: `race_${i}` },
    })))
    await indexB.initialized()
    await Promise.allSettled([
      indexA.replace('contract/pg/race/winner-a', [{ name: 'winner_a' }]),
      indexB.replace('contract/pg/race/winner-b', [{ name: 'winner_b' }]),
    ])
    const [row] = await a.unsafe<Array<{ count: number }>>(
      'SELECT COUNT(*)::int AS count FROM tb_search_snapshots_v5',
    )
    expect(row?.count).toBeLessThanOrEqual(TOOL_SEARCH_AUDIT_NODE_LIMIT)
  })
})
