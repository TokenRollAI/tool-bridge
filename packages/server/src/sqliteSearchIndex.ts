import {
  type SerializedToolSearchRecord,
  type SqlSearchDriver,
  SqlSearchIndex,
  type SqlSearchStatement,
  TOOL_SEARCH_INSERT_SNAPSHOT_SQL,
  TOOL_SEARCH_INSERT_SQL,
  TOOL_SEARCH_SCHEMA_STATEMENTS,
  type TreePath,
} from '@tool-bridge/core'
import Database from 'better-sqlite3'

const SCHEMA_SQL = TOOL_SEARCH_SCHEMA_STATEMENTS.map(sql => `${sql};`).join('\n')

/**
 * better-sqlite3 驱动:同步 API 包成 core 要求的 Promise 形态。
 *
 * 与 D1 的两处结构性差异:建表在构造函数里一次做完(故 `ensureSchema` 是 no-op),
 * 且没有查询预算,记录逐条插入即可——`assertInsertBudget` 因此不实现。
 */
class SqliteSearchDriver implements SqlSearchDriver {
  constructor(private readonly db: Database.Database) {}

  async all<T>(statement: SqlSearchStatement): Promise<T[]> {
    return this.db.prepare(statement.sql).all(...statement.params) as T[]
  }

  async ensureSchema(): Promise<void> {}

  async first<T>(statement: SqlSearchStatement): Promise<T | null> {
    return (this.db.prepare(statement.sql).get(...statement.params) as T | undefined) ?? null
  }

  insertRecords(records: readonly SerializedToolSearchRecord[]): SqlSearchStatement[] {
    return records.map(record => ({
      params: [record.path, record.name, record.description, record.feedback],
      sql: TOOL_SEARCH_INSERT_SQL,
    }))
  }

  insertSnapshots(digests: ReadonlyMap<TreePath, string>): SqlSearchStatement[] {
    return [...digests].map(([path, digest]) => ({
      params: [path, digest],
      sql: TOOL_SEARCH_INSERT_SNAPSHOT_SQL,
    }))
  }

  async write(statements: readonly SqlSearchStatement[]): Promise<void> {
    // prepare 提到事务外:同一条 SQL 在一次 mutation 里可能重复上百次(逐条插入),
    // 事务体内只跑 run,减少重复编译。
    const prepared = statements.map(statement => ({
      params: statement.params,
      run: this.db.prepare(statement.sql),
    }))
    this.db.transaction(() => {
      for (const statement of prepared) statement.run.run(...statement.params)
    })()
  }
}

/** Node 宿主的 better-sqlite3 FTS5/trigram SearchIndex。 */
export class SqliteSearchIndex extends SqlSearchIndex {
  private readonly db: Database.Database

  constructor(dbPath: string) {
    const db = new Database(dbPath)
    try {
      db.pragma('journal_mode = WAL')
      db.pragma('synchronous = NORMAL')
      db.pragma('busy_timeout = 5000')
      db.exec(SCHEMA_SQL)
    } catch (error) {
      db.close()
      throw error
    }
    super(new SqliteSearchDriver(db))
    this.db = db
  }

  close(): void {
    this.db.close()
  }
}
