/**
 * PgStateStore:postgres.js 实现的 StateStore(自托管 Node 宿主的 PG 后端)。
 *
 * 通用状态以单表 kv(key text primary key, value jsonb)保存,值以
 * JSON 存取,强一致。list 用 key 范围扫描(>= prefix AND < successor(prefix)),
 * 不用 LIKE——key 里的路径段可含 '_'/'%',通配符转义是坑。
 *
 * 关键差异——排序 collation:PG 默认按 libc locale 排序,`<` 与 `ORDER BY` 的
 * 顺序会和 JS(UTF-16 code unit)不一致,直接让前缀范围扫描和
 * cursor 分页错行漏行。故 key 列显式 `COLLATE "C"`(纯字节序),与 core
 * MemoryStateStore 的 cursor 语义对齐。防御性地对返回行再做
 * startsWith 过滤。
 */

import type { Sql } from 'postgres'
import { prefixUpperBound, type StateStore } from '@tool-bridge/core'

const DEFAULT_LIST_LIMIT = 1000

export class PgStateStore implements StateStore {
  private contextRefsEnabled = false
  constructor(private readonly sql: Sql) {}

  /** 建表(幂等)。key COLLATE "C" 是字节序正确性的前提,不能省。 */
  async ensureSchema(): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS tb_kv (
        key text COLLATE "C" PRIMARY KEY,
        value jsonb NOT NULL
      )
    `
  }

  async ensureContextReferencesSchema(): Promise<void> {
    await this.sql`CREATE TABLE IF NOT EXISTS tb_context_storage_refs (
      node_key text COLLATE "C" PRIMARY KEY REFERENCES tb_kv(key) ON DELETE CASCADE,
      backend_id text NOT NULL REFERENCES tb_storage_backends(id)
    )`
    await this.sql`CREATE INDEX IF NOT EXISTS tb_context_storage_backend ON tb_context_storage_refs(backend_id)`
    this.contextRefsEnabled = true
  }

  async get(key: string): Promise<unknown | null> {
    const rows = await this.sql<{ value: unknown }[]>`
      SELECT value FROM tb_kv WHERE key = ${key}
    `
    const row = rows[0]
    return row === undefined ? null : row.value
  }

  async getMany(keys: readonly string[]): Promise<Map<string, unknown>> {
    const unique = [...new Set(keys)]
    if (unique.length === 0) return new Map()
    const rows = await this.sql<{ key: string, value: unknown }[]>`
      SELECT key, value FROM tb_kv WHERE key = ANY(${this.sql.array(unique)})
    `
    // `= ANY` 行序不保证;按输入 key 首次出现顺序构建 Map,与 MemoryStateStore 对齐。
    const byKey = new Map(rows.map(row => [row.key, row.value]))
    const out = new Map<string, unknown>()
    for (const key of unique) {
      if (byKey.has(key)) out.set(key, byKey.get(key))
    }
    return out
  }

  async put(key: string, value: unknown): Promise<void> {
    const config = (value as { config?: { kind?: string, provider?: string, providerConfig?: { backendId?: string } } })?.config
    if (this.contextRefsEnabled && key.startsWith('node:')) {
      await this.sql.begin(async (sql) => {
        await sql`INSERT INTO tb_kv(key,value) VALUES(${key},${sql.json(value as never)})
          ON CONFLICT(key) DO UPDATE SET value=excluded.value`
        if (config?.provider === 'storage' && (config.kind === 'context' || config.kind === 'skillhub')) {
          if (!config.providerConfig?.backendId) throw new Error('storage Context requires an immutable backendId')
          await sql`INSERT INTO tb_context_storage_refs(node_key,backend_id) VALUES(${key},${config.providerConfig.backendId})
            ON CONFLICT(node_key) DO UPDATE SET backend_id=excluded.backend_id`
        } else await sql`DELETE FROM tb_context_storage_refs WHERE node_key=${key}`
      })
      return
    }
    await this.sql`INSERT INTO tb_kv(key,value) VALUES(${key},${this.sql.json(value as never)})
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  }

  async compareAndSwap(
    key: string,
    expectedRevision: number | null,
    value: unknown | null,
  ): Promise<boolean> {
    if (expectedRevision === null) {
      if (value === null) return false
      const result = await this.sql`
        INSERT INTO tb_kv (key, value) VALUES (${key}, ${this.sql.json(value as never)})
        ON CONFLICT (key) DO NOTHING
      `
      return result.count > 0
    }
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) return false

    // jsonb_typeof guards 住非对象与 boolean revision；比较和 mutation 在单条 SQL 内完成。
    const predicate = this.sql`
      key = ${key}
      AND jsonb_typeof(value) = 'object'
      AND jsonb_typeof(value -> 'revision') = 'number'
      AND (value ->> 'revision') ~ '^(0|[1-9][0-9]*)$'
      AND (value ->> 'revision')::numeric = ${expectedRevision}
    `
    const result = value === null
      ? await this.sql`DELETE FROM tb_kv WHERE ${predicate}`
      : await this.sql`
          UPDATE tb_kv SET value = ${this.sql.json(value as never)}
          WHERE ${predicate}
        `
    return result.count > 0
  }

  async putIfAbsent(key: string, value: unknown): Promise<boolean> {
    // ON CONFLICT DO NOTHING 原子:count=0 即已存在(输者),不覆盖。
    const result = await this.sql`
      INSERT INTO tb_kv (key, value) VALUES (${key}, ${this.sql.json(value as never)})
      ON CONFLICT (key) DO NOTHING
    `
    return result.count > 0
  }

  async delete(key: string): Promise<void> {
    await this.sql`DELETE FROM tb_kv WHERE key = ${key}`
  }

  async list(
    prefix: string,
    opts?: { cursor?: string, limit?: number },
  ): Promise<{ cursor?: string, items: Array<{ key: string, value: unknown }> }> {
    const limit = opts?.limit ?? DEFAULT_LIST_LIMIT
    // 下界:prefix 与 cursor(严格大于)取更紧者;上界:prefix 后继(空 prefix 无上界)。
    const lowerByCursor = opts?.cursor !== undefined && opts.cursor >= prefix
    const upper = prefix === '' ? undefined : prefixUpperBound(prefix)
    const rows = await this.sql<{ key: string, value: unknown }[]>`
      SELECT key, value FROM tb_kv
      WHERE ${
        lowerByCursor
          ? this.sql`key > ${opts?.cursor ?? ''}`
          : this.sql`key >= ${prefix}`
      }
      ${upper !== undefined ? this.sql`AND key < ${upper}` : this.sql``}
      ORDER BY key
      LIMIT ${limit + 1}
    `
    const matched = rows.filter(r => r.key.startsWith(prefix))
    const hasMore = matched.length > limit
    const page = hasMore ? matched.slice(0, limit) : matched
    const items = page.map(r => ({ key: r.key, value: r.value }))
    const last = page[page.length - 1]
    return hasMore && last !== undefined ? { items, cursor: last.key } : { items }
  }
}
