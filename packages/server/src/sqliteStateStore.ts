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

/** prefix 的字典序后继(范围扫描上界);全 0xFFFF 时无上界返回 undefined。 */
function prefixUpperBound(prefix: string): string | undefined {
  for (let i = prefix.length - 1; i >= 0; i--) {
    const code = prefix.charCodeAt(i)
    if (code < 0xffff) {
      return prefix.slice(0, i) + String.fromCharCode(code + 1)
    }
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

  async put(key: string, value: unknown): Promise<void> {
    this.stmtPut.run(key, JSON.stringify(value))
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
