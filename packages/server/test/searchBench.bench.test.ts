/**
 * SearchIndex 后端性能基准(手动运行,不进 CI)。
 *
 *   TB_TEST_DATABASE_URL=... npx vitest run test/searchBench.manual.ts
 *
 * 目的是量化 PG(ILIKE 子串)与 SQLite(FTS5 trigram + 短词 LIKE)在同一数据量下的
 * 检索与写入延迟。PG 侧长短词同走 ILIKE 且实测一律 Seq Scan;SQLite 侧长词走 FTS5
 * 索引、短词走无索引 LIKE —— 两边的强弱项因此不同,值得分查询型别看。
 * 不做断言,只打印数字——阈值随机器波动,断言会变成 flaky。
 */

import type { MutableSearchIndex, ToolSearchDocument } from '@tool-bridge/core'
import { afterAll, beforeAll, describe, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import postgres, { type Sql } from 'postgres'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteSearchIndex } from '../src/sqliteSearchIndex'
import { PgSearchIndex } from '../src/pgSearchIndex'

const DATABASE_URL = process.env.TB_TEST_DATABASE_URL
/**
 * 双重门控:除了要有 PG,还要显式 TB_BENCH=1。
 * 基准跑几十秒且只打印数字、不做断言,不该占用常规 `pnpm verify` 的时间,
 * 也不该被 CI 的"PG 测试未被 skip"断言算进覆盖。
 */
const ENABLED = DATABASE_URL !== undefined && process.env.TB_BENCH === '1'
const suite = ENABLED ? describe : describe.skip

/** 贴近容量上限:500 节点 × 8 工具 = 4000 条索引记录。 */
const NODES = 500
const TOOLS_PER_NODE = 8
const ROUNDS = 20

const SCHEMA = 'tb_bench'
let sql: Sql
let scoped: Sql
let dataDir: string
let pg: MutableSearchIndex
let sqlite: SqliteSearchIndex

/** 造语料:让长词与短词都有可控的命中面。 */
function documents(): ToolSearchDocument[] {
  const docs: ToolSearchDocument[] = []
  for (let n = 0; n < NODES; n++) {
    for (let t = 0; t < TOOLS_PER_NODE; t++) {
      docs.push({
        path: `bench/node/${String(n).padStart(3, '0')}`,
        tool: {
          name: `tool_${n}_${t}_calendar`,
          description: `Manage calendar appointments and 日程日历 entries for tenant ${n}`
            + ` slot ${t} plus filler text to make descriptions realistic in length`,
        },
      })
    }
  }
  return docs
}

async function timed(label: string, fn: () => Promise<unknown>): Promise<number> {
  const started = performance.now()
  await fn()
  const ms = performance.now() - started
  console.log(`    ${label.padEnd(34)} ${ms.toFixed(1)} ms`)
  return ms
}

/** 跑 ROUNDS 轮取中位数与 p95,避免单次抖动。 */
async function percentiles(
  label: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  const samples: number[] = []
  for (let i = 0; i < ROUNDS; i++) {
    const started = performance.now()
    await fn()
    samples.push(performance.now() - started)
  }
  samples.sort((a, b) => a - b)
  const median = samples[Math.floor(samples.length / 2)] ?? 0
  const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0
  console.log(
    `    ${label.padEnd(34)} median ${median.toFixed(1)} ms   p95 ${p95.toFixed(1)} ms`,
  )
}

beforeAll(async () => {
  if (!ENABLED) return
  sql = postgres(DATABASE_URL, { max: 4, onnotice: () => {} })
  await sql.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await sql.unsafe(`CREATE SCHEMA ${SCHEMA}`)
  scoped = postgres(DATABASE_URL, {
    max: 4,
    onnotice: () => {},
    connection: { search_path: `${SCHEMA},public` },
  })
  pg = new PgSearchIndex(scoped)
  dataDir = mkdtempSync(join(tmpdir(), 'tb-bench-'))
  sqlite = new SqliteSearchIndex(join(dataDir, 'bench.sqlite3'))
}, 120_000)

afterAll(async () => {
  if (sqlite !== undefined) sqlite.close()
  if (dataDir !== undefined) rmSync(dataDir, { recursive: true, force: true })
  if (scoped !== undefined) await scoped.end({ timeout: 5 })
  if (sql !== undefined) {
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
    await sql.end({ timeout: 5 })
  }
})

suite('SearchIndex 后端基准', () => {
  it(`rebuild + 检索(${NODES} 节点 × ${TOOLS_PER_NODE} 工具)`, async () => {
    const docs = documents()
    console.log(`\n  数据量: ${docs.length} 条索引记录\n`)

    console.log('  [写入] 全量 rebuild')
    await timed('PG', async () => await pg.rebuild(docs))
    await timed('SQLite', async () => await sqlite.rebuild(docs))

    console.log('\n  [写入] 单节点 replace(增量)')
    let seq = 0
    await percentiles('PG', async () => {
      seq++
      await pg.replace('bench/node/000', [
        { name: `hot_${seq}`, description: 'hot path replace probe calendar' },
      ])
    })
    seq = 0
    await percentiles('SQLite', async () => {
      seq++
      await sqlite.replace('bench/node/000', [
        { name: `hot_${seq}`, description: 'hot path replace probe calendar' },
      ])
    })

    console.log('\n  [检索] 长词 "calendar"(命中面极大)')
    await percentiles('PG', async () => await pg.search('calendar', { limit: 50 }))
    await percentiles('SQLite', async () => await sqlite.search('calendar', { limit: 50 }))

    console.log('\n  [检索] 长词 "appointments"(选择性中等)')
    await percentiles('PG', async () => await pg.search('appointments', { limit: 50 }))
    await percentiles('SQLite', async () => await sqlite.search('appointments', { limit: 50 }))

    console.log('\n  [检索] CJK 短词 "日程"(2 字)')
    await percentiles('PG', async () => await pg.search('日程', { limit: 50 }))
    await percentiles('SQLite', async () => await sqlite.search('日程', { limit: 50 }))

    console.log('\n  [检索] 多词 AND "calendar appointments"')
    await percentiles('PG', async () => await pg.search('calendar appointments', { limit: 50 }))
    await percentiles(
      'SQLite',
      async () => await sqlite.search('calendar appointments', { limit: 50 }),
    )

    console.log('\n  [检索] 无命中 "zzzzznomatch"')
    await percentiles('PG', async () => await pg.search('zzzzznomatch', { limit: 50 }))
    await percentiles('SQLite', async () => await sqlite.search('zzzzznomatch', { limit: 50 }))
    console.log('')
  }, 600_000)
})
