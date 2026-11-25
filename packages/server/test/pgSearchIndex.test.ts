/** Real PostgreSQL search contract, capacity races and numeric result normalization. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TOOL_SEARCH_AUDIT_NODE_LIMIT } from '@tool-bridge/core'
import postgres, { type Sql } from 'postgres'
import { verifySearchIndexContract } from '../../core/test/search/searchIndex.fixture'
import { PgSearchIndex } from '../src/pgSearchIndex'
import { PgStateStore } from '../src/pgStateStore'

const DATABASE_URL = process.env.TB_TEST_DATABASE_URL
if (!DATABASE_URL) throw new Error('PG integration fixture was not initialized')
const suite = describe

let sql: Sql
const cleanups: Array<() => Promise<void>> = []

beforeAll(async () => {
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
  it('reuses canonical snapshots, serializes rebuilds with writes, and recovers after overflow', async () => {
    const schema = 'tb_search_input_test'
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await sql.unsafe(`CREATE SCHEMA ${schema}`)
    const a = postgres(DATABASE_URL!, { max: 3, connection: { search_path: schema } })
    const b = postgres(DATABASE_URL!, { max: 2, connection: { search_path: schema } })
    cleanups.push(async () => {
      await Promise.all([a.end(), b.end()])
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    })
    const state = new PgStateStore(a)
    await state.ensureSchema()
    const index = new PgSearchIndex(a)
    await index.enableCanonicalAudit()
    const node = { path: 'probe', kind: 'tool', description: 'before' }
    await state.put('node:probe', node)
    const build = vi.fn(async (nodes: readonly { description: string, path: string }[]) =>
      nodes.map(n => ({ path: n.path, tool: { name: 'probe', description: n.description } })))
    await Promise.all(Array.from({ length: 8 }, () => index.auditCanonical!(build)))
    expect(build).toHaveBeenCalledTimes(1)
    await a`UPDATE tb_kv SET value=jsonb_set(value,'{lastSeenAt}','"heartbeat"') WHERE key='node:probe'`
    await index.auditCanonical!(build)
    expect(build).toHaveBeenCalledTimes(1)
    await new PgStateStore(b).put('node:probe', { ...node, description: 'during' })
    let write: Promise<void> | undefined
    await index.auditCanonical!(async (nodes) => {
      write = new PgStateStore(b).put('node:probe', { ...node, description: 'after' })
      await vi.waitFor(async () => expect((await a`SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%INSERT INTO tb_kv(key,value)%'`).length).toBeGreaterThan(0))
      return build(nodes)
    })
    await write
    await index.auditCanonical!(build)
    expect((await index.search('after')).items).toHaveLength(1)
    const revision = await index.revision()
    await a`INSERT INTO tb_kv(key,value) SELECT 'node:overflow/'||n,jsonb_build_object('path','overflow/'||n,'kind','directory') FROM generate_series(1,500) n`
    expect((await index.auditCanonical!(build)).truncated).toBe(true)
    expect(await index.revision()).toBe(revision)
    await a`DELETE FROM tb_kv WHERE key>='node:overflow/' AND key<'node:overflow0'`
    expect((await index.auditCanonical!(build)).truncated).toBe(false)
    expect((await index.search('after')).items).toHaveLength(1)
  })

  it('satisfies the shared LIKE search mutation contract', async () => {
    const index = await freshIndex('contract')
    await verifySearchIndexContract(index, 'contract/pg')
  })

  // 回归:postgres.js 把 bigint/COUNT 返回为字符串、EXISTS 返回 boolean。
  // 若 SQL 丢掉 ::int 归一,下面两条会分别暴露"公开类型被违反"与"no-op 判定失效"。
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
