import {
  assertKeywordToolSearchMode,
  literalToolSearchQuery,
  type MutableSearchIndex,
  normalizeToolSearchPath,
  type SerializedToolSearchRecord,
  serializeToolSearchHits,
  serializeToolSearchSnapshot,
  TBError,
  TOOL_SEARCH_CANDIDATE_LIMIT,
  type ToolSearchHit,
  type ToolSearchOptions,
  type ToolSpec,
  type TreePath,
} from '@tool-bridge/core'

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS tb_search_tools (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tool_json TEXT NOT NULL,
    UNIQUE(path, name)
  )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS tb_search_tools_fts USING fts5(
    name,
    description,
    content='tb_search_tools',
    content_rowid='id',
    tokenize='trigram'
  )`,
  `CREATE TRIGGER IF NOT EXISTS tb_search_tools_ai AFTER INSERT ON tb_search_tools BEGIN
    INSERT INTO tb_search_tools_fts(rowid, name, description)
    VALUES (new.id, new.name, new.description);
  END`,
  `CREATE TRIGGER IF NOT EXISTS tb_search_tools_ad AFTER DELETE ON tb_search_tools BEGIN
    INSERT INTO tb_search_tools_fts(tb_search_tools_fts, rowid, name, description)
    VALUES ('delete', old.id, old.name, old.description);
  END`,
  `CREATE TRIGGER IF NOT EXISTS tb_search_tools_au
  AFTER UPDATE OF name, description ON tb_search_tools BEGIN
    INSERT INTO tb_search_tools_fts(tb_search_tools_fts, rowid, name, description)
    VALUES ('delete', old.id, old.name, old.description);
    INSERT INTO tb_search_tools_fts(rowid, name, description)
    VALUES (new.id, new.name, new.description);
  END`,
] as const

const INSERT_SQL = `
INSERT INTO tb_search_tools (path, name, description, tool_json)
`

/** D1 每语句最多绑定 100 参数；4 列一行，故每 INSERT 最多 25 个工具。 */
const INSERT_CHUNK_SIZE = 25
/** 免费套餐每 invocation 的 D1 query budget 内可原子完成的最大快照。 */
export const D1_SEARCH_MUTATION_LIMIT = 1000

interface SearchRow {
  name: string
  path: string
  tool_json: string
}

function hitFromRow(row: SearchRow): ToolSearchHit {
  try {
    const tool = JSON.parse(row.tool_json) as ToolSpec
    if (
      typeof row.path !== 'string'
      || typeof row.name !== 'string'
      || tool === null
      || typeof tool !== 'object'
      || typeof tool.name !== 'string'
      || tool.name !== row.name
    ) {
      throw new Error('invalid indexed row')
    }
    return { path: row.path, tool }
  } catch {
    throw new TBError('internal', `工具搜索索引记录损坏:'${String(row.path)}/${String(row.name)}'`)
  }
}

/** Cloudflare D1 的持久 FTS5/trigram SearchIndex。 */
export class D1SearchIndex implements MutableSearchIndex {
  readonly capabilities = ['search'] as const
  private schemaReady: Promise<void> | undefined

  constructor(private readonly db: D1Database) {}

  private async initializeSchema(): Promise<void> {
    try {
      await this.db.batch(SCHEMA_STATEMENTS.map(sql => this.db.prepare(sql)))
    } catch (error) {
      this.schemaReady = undefined
      throw error
    }
  }

  private ensureSchema(): Promise<void> {
    this.schemaReady ??= this.initializeSchema()
    return this.schemaReady
  }

  private insertStatements(records: readonly SerializedToolSearchRecord[]): D1PreparedStatement[] {
    if (records.length > D1_SEARCH_MUTATION_LIMIT) {
      throw new TBError(
        'invalid_argument',
        `D1 工具索引单次 mutation 最多 ${D1_SEARCH_MUTATION_LIMIT} 条`,
      )
    }
    const statements: D1PreparedStatement[] = []
    for (let offset = 0; offset < records.length; offset += INSERT_CHUNK_SIZE) {
      const chunk = records.slice(offset, offset + INSERT_CHUNK_SIZE)
      const placeholders = chunk.map(() => '(?, ?, ?, ?)').join(', ')
      const values = chunk.flatMap(record => [
        record.path,
        record.name,
        record.description,
        record.toolJson,
      ])
      statements.push(this.db.prepare(`${INSERT_SQL} VALUES ${placeholders}`).bind(...values))
    }
    return statements
  }

  async replace(path: TreePath, tools: readonly ToolSpec[]): Promise<void> {
    const canonical = normalizeToolSearchPath(path)
    const records = serializeToolSearchSnapshot(canonical, tools)
    await this.ensureSchema()
    await this.db.batch([
      this.db.prepare('DELETE FROM tb_search_tools WHERE path = ?').bind(canonical),
      ...this.insertStatements(records),
    ])
  }

  async remove(path: TreePath): Promise<void> {
    const canonical = normalizeToolSearchPath(path)
    await this.ensureSchema()
    await this.db.prepare('DELETE FROM tb_search_tools WHERE path = ?').bind(canonical).run()
  }

  async rebuild(hits: readonly ToolSearchHit[]): Promise<void> {
    const records = serializeToolSearchHits(hits)
    await this.ensureSchema()
    await this.db.batch([
      this.db.prepare('DELETE FROM tb_search_tools'),
      ...this.insertStatements(records),
      this.db.prepare(
        'INSERT INTO tb_search_tools_fts(tb_search_tools_fts) VALUES (\'rebuild\')',
      ),
    ])
  }

  async search(query: string, opts?: ToolSearchOptions): Promise<{ items: ToolSearchHit[] }> {
    assertKeywordToolSearchMode(opts)
    const expression = literalToolSearchQuery(query)
    await this.ensureSchema()
    const result = await this.db.prepare(`
      SELECT tools.path, tools.name, tools.tool_json
      FROM tb_search_tools_fts
      JOIN tb_search_tools AS tools ON tools.id = tb_search_tools_fts.rowid
      WHERE tb_search_tools_fts MATCH ?
      ORDER BY bm25(tb_search_tools_fts), tools.path, tools.name
      LIMIT ?
    `).bind(expression, TOOL_SEARCH_CANDIDATE_LIMIT).all<SearchRow>()
    return { items: result.results.map(hitFromRow) }
  }
}
