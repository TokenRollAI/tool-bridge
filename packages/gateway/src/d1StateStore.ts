import { prefixUpperBound, type StateStore } from '@tool-bridge/core'

const DEFAULT_LIST_LIMIT = 1000
/**
 * getMany 的 IN 分块大小。D1 每语句最多 100 个绑定参数;取 50 留余量,
 * 避免恰好卡线的 off-by-one 在平台收紧限制时炸掉。
 */
const GET_MANY_CHUNK = 50

/**
 * D1StateStore:Cloudflare D1 实现的 StateStore(绑定 TB_STATE;store.ts key 布局)。
 *
 * ADR-001 的落点:权威状态从 KV 迁到 D1,换来强一致读写(撤销即时生效)、原子
 * putIfAbsent(并发引导去重不再走回退路径)、list 直接带值返回(KV 时代 list 后
 * 逐 key get 的幽灵与子请求放大都消失)。
 *
 * 与 server 的 SqliteStateStore 同表布局(tb_state_kv:key TEXT PRIMARY KEY, value TEXT;与 search 同库,表名带前缀自解释)、
 * 同 list 语义(prefixUpperBound 范围扫描 + cursor 严格大于翻页)——D1 就是 SQLite,
 * 三宿主 StateStore 全部收敛到同一 SQL 语义,由共享契约测试对拍。
 *
 * schema 懒初始化(promise memo,失败重置以便重试),模式与 D1SearchDriver 一致:
 * Workers 无启动钩子,首次操作前建表。
 */
export class D1StateStore implements StateStore {
  private schemaReady: Promise<void> | undefined

  constructor(private readonly db: D1Database) {}

  private ensureSchema(): Promise<void> {
    this.schemaReady ??= this.db
      .prepare(
        'CREATE TABLE IF NOT EXISTS tb_state_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID',
      )
      .run()
      .then(() => undefined)
      .catch((error: unknown) => {
        this.schemaReady = undefined
        throw error
      })
    return this.schemaReady
  }

  async get(key: string): Promise<unknown | null> {
    await this.ensureSchema()
    const row = await this.db
      .prepare('SELECT value FROM tb_state_kv WHERE key = ?')
      .bind(key)
      .first<{ value: string }>()
    return row === null ? null : JSON.parse(row.value)
  }

  async getMany(keys: readonly string[]): Promise<Map<string, unknown>> {
    await this.ensureSchema()
    const out = new Map<string, unknown>()
    const unique = [...new Set(keys)]
    for (let offset = 0; offset < unique.length; offset += GET_MANY_CHUNK) {
      const chunk = unique.slice(offset, offset + GET_MANY_CHUNK)
      if (chunk.length === 0) continue
      const placeholders = chunk.map(() => '?').join(', ')
      const rows = await this.db
        .prepare(`SELECT key, value FROM tb_state_kv WHERE key IN (${placeholders})`)
        .bind(...chunk)
        .all<{ key: string, value: string }>()
      for (const row of rows.results) out.set(row.key, JSON.parse(row.value) as unknown)
    }
    return out
  }

  async put(key: string, value: unknown): Promise<void> {
    await this.ensureSchema()
    await this.db
      .prepare(
        'INSERT INTO tb_state_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .bind(key, JSON.stringify(value))
      .run()
  }

  async putIfAbsent(key: string, value: unknown): Promise<boolean> {
    await this.ensureSchema()
    // INSERT OR IGNORE 原子:changes=0 即已存在(输者),不覆盖。
    const result = await this.db
      .prepare('INSERT OR IGNORE INTO tb_state_kv (key, value) VALUES (?, ?)')
      .bind(key, JSON.stringify(value))
      .run()
    return result.meta.changes > 0
  }

  async delete(key: string): Promise<void> {
    await this.ensureSchema()
    await this.db.prepare('DELETE FROM tb_state_kv WHERE key = ?').bind(key).run()
  }

  async list(
    prefix: string,
    opts?: { cursor?: string, limit?: number },
  ): Promise<{ cursor?: string, items: Array<{ key: string, value: unknown }> }> {
    await this.ensureSchema()
    const limit = opts?.limit ?? DEFAULT_LIST_LIMIT
    // 下界:prefix 与 cursor(严格大于)取更紧者;上界:prefix 后继(空 prefix 无上界)。
    const lowerByCursor = opts?.cursor !== undefined && opts.cursor >= prefix
    const upper = prefix === '' ? undefined : prefixUpperBound(prefix)
    const conditions: string[] = []
    const params: Array<string | number> = []
    if (lowerByCursor) {
      conditions.push('key > ?')
      params.push(opts?.cursor ?? '')
    } else {
      conditions.push('key >= ?')
      params.push(prefix)
    }
    if (upper !== undefined) {
      conditions.push('key < ?')
      params.push(upper)
    }
    params.push(limit + 1)
    const rows = await this.db
      .prepare(
        `SELECT key, value FROM tb_state_kv WHERE ${conditions.join(' AND ')} ORDER BY key LIMIT ?`,
      )
      .bind(...params)
      .all<{ key: string, value: string }>()
    // 防御性 startsWith 过滤,与 Memory/SQLite/PG 实现对齐。
    const matched = rows.results.filter(r => r.key.startsWith(prefix))
    const hasMore = matched.length > limit
    const page = hasMore ? matched.slice(0, limit) : matched
    const items = page.map(r => ({ key: r.key, value: JSON.parse(r.value) as unknown }))
    const last = page[page.length - 1]
    return hasMore && last !== undefined ? { items, cursor: last.key } : { items }
  }
}
