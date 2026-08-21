/**
 * PgSearchIndex:postgres.js 驱动的 SearchIndex(ILIKE 子串检索)。
 *
 * 方言(SQL 文本、$n 占位符、ILIKE 检索)在 core 的 pgSearchDialect;
 * 本文件只吸收 postgres.js 的驱动差异:全异步、写入走 sql.begin() 事务、多行 VALUES
 * 批量插入(PG 无 D1 的 50 查询预算,故不实现 assertInsertBudget)。
 *
 * 不需要任何 PG 扩展:检索是纯 ILIKE,cursor_secret 用内置 gen_random_uuid()。
 * 因此连接角色无需建扩展权限(受限托管环境常不给),只要能建表。
 */

import type { Sql } from 'postgres'
import {
  PG_SEARCH_INSERT_ROWS_MAX,
  PG_SEARCH_SNAPSHOTS_COLUMNS,
  PG_SEARCH_SNAPSHOTS_TABLE,
  PG_SEARCH_TOOLS_COLUMNS,
  PG_SEARCH_TOOLS_TABLE,
  PG_SEARCH_WRITE_LOCK_KEY,
  pgBulkInsertSql,
  pgSearchDialect,
  type SerializedToolSearchRecord,
  type SqlSearchDriver,
  SqlSearchIndex,
  type SqlSearchStatement,
  type TreePath,
} from '@tool-bridge/core'

class PgSearchDriver implements SqlSearchDriver {
  private schemaReady: Promise<void> | undefined

  constructor(private readonly sql: Sql) {}

  async all<T>(statement: SqlSearchStatement): Promise<T[]> {
    return await this.sql.unsafe<T[]>(statement.sql, statement.params as never[])
  }

  private async initializeSchema(): Promise<void> {
    try {
      await this.sql.begin(async (tx) => {
        for (const ddl of pgSearchDialect.schemaStatements) {
          await tx.unsafe(ddl)
        }
      })
    } catch (error) {
      this.schemaReady = undefined
      throw error
    }
  }

  ensureSchema(): Promise<void> {
    this.schemaReady ??= this.initializeSchema()
    return this.schemaReady
  }

  async first<T>(statement: SqlSearchStatement): Promise<T | null> {
    const rows = await this.sql.unsafe<T[]>(statement.sql, statement.params as never[])
    return rows[0] ?? null
  }

  /**
   * 攒成多行 VALUES 批量插入,而非逐条。
   * 逐条对 4000 行需 ~920ms(每行一次事务内往返),批量后 ~12ms。
   */
  private bulk<T>(
    items: readonly T[],
    table: string,
    columns: readonly string[],
    toParams: (item: T) => unknown[],
  ): SqlSearchStatement[] {
    const statements: SqlSearchStatement[] = []
    for (let i = 0; i < items.length; i += PG_SEARCH_INSERT_ROWS_MAX) {
      const chunk = items.slice(i, i + PG_SEARCH_INSERT_ROWS_MAX)
      statements.push({
        params: chunk.flatMap(toParams),
        sql: pgBulkInsertSql(table, columns, chunk.length),
      })
    }
    return statements
  }

  insertRecords(records: readonly SerializedToolSearchRecord[]): SqlSearchStatement[] {
    return this.bulk(
      records,
      PG_SEARCH_TOOLS_TABLE,
      PG_SEARCH_TOOLS_COLUMNS,
      record => [record.path, record.name, record.description, record.feedback],
    )
  }

  insertSnapshots(digests: ReadonlyMap<TreePath, string>): SqlSearchStatement[] {
    return this.bulk(
      [...digests],
      PG_SEARCH_SNAPSHOTS_TABLE,
      PG_SEARCH_SNAPSHOTS_COLUMNS,
      ([path, digest]) => [path, digest],
    )
  }

  async write(statements: readonly SqlSearchStatement[]): Promise<void> {
    await this.sql.begin(async (tx) => {
      // 全索引 mutation 串行化。容量上限靠 `COUNT(*)` 判定(应用层预检 + 触发器兜底),
      // 而 COUNT 不加锁:499 个 path 时两个并发 replace 都会读到 499、双双通过,
      // 提交后变成 501。事务级 advisory lock 让写路径彼此排队,COUNT 因此可信;
      // 锁随事务结束自动释放(无需显式 unlock,回滚也不泄漏)。
      // 读路径(search/meta)不取锁,不受影响。
      await tx`SELECT pg_advisory_xact_lock(${PG_SEARCH_WRITE_LOCK_KEY})`
      for (const statement of statements) {
        await tx.unsafe(statement.sql, statement.params as never[])
      }
    })
  }
}

/** Node 自托管宿主的 postgres.js SearchIndex。 */
export class PgSearchIndex extends SqlSearchIndex {
  constructor(sql: Sql) {
    super(new PgSearchDriver(sql), pgSearchDialect)
  }
}
