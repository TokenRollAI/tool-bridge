import {
  type SerializedToolSearchRecord,
  type SqlSearchDriver,
  SqlSearchIndex,
  type SqlSearchStatement,
  TBError,
  TOOL_SEARCH_INSERT_JSON_SQL,
  TOOL_SEARCH_INSERT_SNAPSHOT_JSON_SQL,
  TOOL_SEARCH_RECORD_JSON_BYTES_MAX,
  TOOL_SEARCH_SCHEMA_STATEMENTS,
  toolSearchInsertPayload,
  type TreePath,
} from '@tool-bridge/core'

/** source + snapshot JSON1 导入块总上限。 */
export const D1_SEARCH_MUTATION_LIMIT = 20
export const D1_SEARCH_COLD_QUERY_MAX
  = TOOL_SEARCH_SCHEMA_STATEMENTS.length
    + 2 // rebuild snapshot + meta
    + 2 // rebuild source/snapshot deletes
    + D1_SEARCH_MUTATION_LIMIT // source + snapshot JSON1 chunks
    + 1 // complete rebuild revision
    + 8 // four candidate batches: meta + candidate SQL
    + 1 // mid-batch public cursor meta

const D1_SEARCH_JSON_CHUNK_BYTES = TOOL_SEARCH_RECORD_JSON_BYTES_MAX

/**
 * D1 驱动:语句/事务/批量插入三处宿主差异,其余全部逻辑在 core 的 SqlSearchIndex。
 *
 * D1 的单请求 50 查询预算是这里唯一的结构性约束——记录必须攒成 JSON1 块再导入
 * (`json_each`),否则 500 节点的 rebuild 会直接撞预算。块大小按单参数字节上限切。
 */
class D1SearchDriver implements SqlSearchDriver {
  private schemaReady: Promise<void> | undefined

  constructor(private readonly db: D1Database) {}

  private prepare(statement: SqlSearchStatement): D1PreparedStatement {
    const prepared = this.db.prepare(statement.sql)
    return statement.params.length === 0 ? prepared : prepared.bind(...statement.params)
  }

  private async initializeSchema(): Promise<void> {
    try {
      await this.db.batch(TOOL_SEARCH_SCHEMA_STATEMENTS.map(sql => this.db.prepare(sql)))
    } catch (error) {
      this.schemaReady = undefined
      throw error
    }
  }

  /** 按 JSON 字节上限切块;单条就超限说明 core 的节点上限被绕过,fail closed。 */
  private jsonChunks<T>(items: readonly T[]): string[] {
    const chunks: string[] = []
    let current: T[] = []
    for (const item of items) {
      const next = JSON.stringify([...current, item])
      if (new TextEncoder().encode(next).length <= D1_SEARCH_JSON_CHUNK_BYTES) {
        current.push(item)
        continue
      }
      if (current.length === 0) {
        throw new TBError('invalid_argument', 'D1 工具索引单条 JSON1 载荷过大')
      }
      chunks.push(JSON.stringify(current))
      current = [item]
      if (new TextEncoder().encode(JSON.stringify(current)).length > D1_SEARCH_JSON_CHUNK_BYTES) {
        throw new TBError('invalid_argument', 'D1 工具索引单条 JSON1 载荷过大')
      }
    }
    if (current.length > 0) chunks.push(JSON.stringify(current))
    return chunks
  }

  async all<T>(statement: SqlSearchStatement): Promise<T[]> {
    return (await this.prepare(statement).all<T>()).results
  }

  assertInsertBudget(count: number): void {
    if (count > D1_SEARCH_MUTATION_LIMIT) {
      throw new TBError(
        'invalid_argument',
        `D1 工具索引单次 mutation 最多 ${D1_SEARCH_MUTATION_LIMIT} 个 JSON1 块`,
      )
    }
  }

  ensureSchema(): Promise<void> {
    this.schemaReady ??= this.initializeSchema()
    return this.schemaReady
  }

  async first<T>(statement: SqlSearchStatement): Promise<T | null> {
    return await this.prepare(statement).first<T>()
  }

  insertRecords(records: readonly SerializedToolSearchRecord[]): SqlSearchStatement[] {
    return this.jsonChunks(toolSearchInsertPayload(records))
      .map(chunk => ({ params: [chunk], sql: TOOL_SEARCH_INSERT_JSON_SQL }))
  }

  insertSnapshots(digests: ReadonlyMap<TreePath, string>): SqlSearchStatement[] {
    return this.jsonChunks([...digests])
      .map(chunk => ({ params: [chunk], sql: TOOL_SEARCH_INSERT_SNAPSHOT_JSON_SQL }))
  }

  async write(statements: readonly SqlSearchStatement[]): Promise<void> {
    await this.db.batch(statements.map(statement => this.prepare(statement)))
  }
}

/** Cloudflare D1 的持久 FTS5/trigram SearchIndex。 */
export class D1SearchIndex extends SqlSearchIndex {
  constructor(db: D1Database) {
    super(new D1SearchDriver(db))
  }
}
