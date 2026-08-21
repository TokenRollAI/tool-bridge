/**
 * PgStateStore:postgres.js 实现的 StateStore(自托管 Node 宿主的 PG 后端)。
 *
 * 与 SqliteStateStore 同形:单表 kv(key text primary key, value jsonb),值以
 * JSON 存取,强一致。list 用 key 范围扫描(>= prefix AND < successor(prefix)),
 * 不用 LIKE——key 里的路径段可含 '_'/'%',通配符转义是坑。
 *
 * 关键差异——排序 collation:PG 默认按 libc locale 排序,`<` 与 `ORDER BY` 的
 * 顺序会和 JS(UTF-16 code unit)/SQLite(UTF-8 字节)不一致,直接让前缀范围扫描和
 * cursor 分页错行漏行。故 key 列显式 `COLLATE "C"`(纯字节序),与 core
 * MemoryStateStore / SqliteStateStore 的 cursor 语义对齐。防御性地对返回行再做
 * startsWith 过滤。
 */

import type { StateStore } from '@tool-bridge/core'
import type { Sql } from 'postgres'

const DEFAULT_LIST_LIMIT = 1000

/** Unicode 最大 scalar;等于它的码点无法再加一,需继续向左借位。 */
const MAX_CODE_POINT = 0x10ffff
/** 代理区间 [D800, DFFF] 不是合法 scalar,加一时必须跳过。 */
const SURROGATE_START = 0xd800
const SURROGATE_END = 0xdfff

/**
 * prefix 在 UTF-8 字节序下的字典序后继(范围扫描上界);无上界时返回 undefined。
 *
 * 必须按 **code point** 而非 UTF-16 code unit 递增。按 code unit 加一会拆开代理对:
 * 以 `🏿`(U+1F3FF = D83C DFFF)结尾时,给低代理 DFFF 加一得到孤立高代理 `D83C E000`,
 * 编码成 UTF-8 时 D83C 被替换为 U+FFFD(ef bf bd),于是 upper bound 的字节序反而
 * **小于** prefix(ef… < f0…),范围查询恒空——子树数据静默消失,不报错。
 * 跳过代理区间同理:U+D7FF 的后继是 U+E000,不是 U+D800。
 */
function prefixUpperBound(prefix: string): string | undefined {
  const points = [...prefix]
  for (let i = points.length - 1; i >= 0; i--) {
    const code = points[i]?.codePointAt(0)
    if (code === undefined || code >= MAX_CODE_POINT) continue
    let next = code + 1
    if (next >= SURROGATE_START && next <= SURROGATE_END) next = SURROGATE_END + 1
    return points.slice(0, i).join('') + String.fromCodePoint(next)
  }
  return undefined
}

export class PgStateStore implements StateStore {
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
    // value 走 sql.json:postgres.js 按 jsonb 绑定,不经字符串拼接。
    await this.sql`
      INSERT INTO tb_kv (key, value) VALUES (${key}, ${this.sql.json(value as never)})
      ON CONFLICT (key) DO UPDATE SET value = excluded.value
    `
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
