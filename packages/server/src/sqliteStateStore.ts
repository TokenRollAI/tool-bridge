/**
 * SqliteStateStore:better-sqlite3 实现的 StateStore(Docker/Node 宿主)。
 *
 * 单表 kv(key TEXT PRIMARY KEY, value TEXT)——StateStore 本身就是 kv 语义,
 * 拆表只会复制 key 布局知识。值 JSON 序列化存取(与 KvStateStore 同形)。
 * 强一致:吊销/写入即时可见,无 KV 的最终一致窗口(kvStateStore.ts 的跳 null
 * 与逐 key get 负担在此宿主不存在)。
 *
 * list 用 key 范围扫描(>= prefix AND < successor(prefix)),不用 LIKE/GLOB——
 * key 里的路径段可含 '_'/'%'/'[',通配符转义是坑。cursor/排序语义与
 * core MemoryStateStore 对拍(cursor = 上页末 key,仅在还有更多时返回)。
 * 注意:SQLite TEXT 按 UTF-8 字节序比较,JS 按 UTF-16 code unit 比较,
 * 二者在 ASCII 与 BMP 码点上一致;key 由本项目生成(ASCII 前缀 + 树路径),
 * 防御性地对返回行再做 startsWith 过滤。
 */

import type { StateStore } from '@tool-bridge/core'
import Database from 'better-sqlite3'

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
 * 编码成 UTF-8 时 D83C 变 U+FFFD(ef bf bd),upper bound 的字节序反而**小于** prefix
 * (ef… < f0…),范围查询恒空——补充平面 key 的子树静默消失,不报错。
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

export class SqliteStateStore implements StateStore {
  private readonly db: Database.Database
  private readonly stmtGet: Database.Statement
  private readonly stmtPut: Database.Statement
  private readonly stmtDelete: Database.Statement

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('busy_timeout = 5000')
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID',
    )
    this.stmtGet = this.db.prepare('SELECT value FROM kv WHERE key = ?')
    this.stmtPut = this.db.prepare(
      'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    this.stmtDelete = this.db.prepare('DELETE FROM kv WHERE key = ?')
  }

  async get(key: string): Promise<unknown | null> {
    const row = this.stmtGet.get(key) as { value: string } | undefined
    return row === undefined ? null : JSON.parse(row.value)
  }

  async getMany(keys: readonly string[]): Promise<Map<string, unknown>> {
    const out = new Map<string, unknown>()
    for (let offset = 0; offset < keys.length; offset += 100) {
      const chunk = [...new Set(keys.slice(offset, offset + 100))]
      if (chunk.length === 0) continue
      const placeholders = chunk.map(() => '?').join(', ')
      const rows = this.db.prepare(
        `SELECT key, value FROM kv WHERE key IN (${placeholders})`,
      ).all(...chunk) as Array<{ key: string, value: string }>
      for (const row of rows) out.set(row.key, JSON.parse(row.value) as unknown)
    }
    return out
  }

  async put(key: string, value: unknown): Promise<void> {
    this.stmtPut.run(key, JSON.stringify(value))
  }

  async putIfAbsent(key: string, value: unknown): Promise<boolean> {
    // INSERT OR IGNORE 原子:changes=0 即已存在(输者),不覆盖。
    const info = this.db
      .prepare('INSERT OR IGNORE INTO kv (key, value) VALUES (?, ?)')
      .run(key, JSON.stringify(value))
    return info.changes > 0
  }

  async delete(key: string): Promise<void> {
    this.stmtDelete.run(key)
  }

  async list(
    prefix: string,
    opts?: { cursor?: string, limit?: number },
  ): Promise<{ cursor?: string, items: Array<{ key: string, value: unknown }> }> {
    const limit = opts?.limit ?? DEFAULT_LIST_LIMIT
    // 下界:prefix 与 cursor(严格大于)取更紧者;上界:prefix 后继(空 prefix 无上界)。
    const lowerByCursor = opts?.cursor !== undefined && opts.cursor >= prefix
    const upper = prefix === '' ? undefined : prefixUpperBound(prefix)
    const conditions: string[] = []
    const params: Record<string, string | number> = { n: limit + 1 }
    if (lowerByCursor) {
      conditions.push('key > @cursor')
      params.cursor = opts?.cursor ?? ''
    } else {
      conditions.push('key >= @prefix')
      params.prefix = prefix
    }
    if (upper !== undefined) {
      conditions.push('key < @upper')
      params.upper = upper
    }
    const rows = this.db
      .prepare(`SELECT key, value FROM kv WHERE ${conditions.join(' AND ')} ORDER BY key LIMIT @n`)
      .all(params) as Array<{
      key: string
      value: string
    }>
    const matched = rows.filter(r => r.key.startsWith(prefix))
    const hasMore = matched.length > limit
    const page = hasMore ? matched.slice(0, limit) : matched
    const items = page.map(r => ({ key: r.key, value: JSON.parse(r.value) as unknown }))
    const last = page[page.length - 1]
    return hasMore && last !== undefined ? { items, cursor: last.key } : { items }
  }

  close(): void {
    this.db.close()
  }
}
