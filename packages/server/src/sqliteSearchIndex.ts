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
import Database from 'better-sqlite3'

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tb_search_tools (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tool_json TEXT NOT NULL,
  UNIQUE(path, name)
);
CREATE VIRTUAL TABLE IF NOT EXISTS tb_search_tools_fts USING fts5(
  name,
  description,
  content='tb_search_tools',
  content_rowid='id',
  tokenize='trigram'
);
CREATE TRIGGER IF NOT EXISTS tb_search_tools_ai AFTER INSERT ON tb_search_tools BEGIN
  INSERT INTO tb_search_tools_fts(rowid, name, description)
  VALUES (new.id, new.name, new.description);
END;
CREATE TRIGGER IF NOT EXISTS tb_search_tools_ad AFTER DELETE ON tb_search_tools BEGIN
  INSERT INTO tb_search_tools_fts(tb_search_tools_fts, rowid, name, description)
  VALUES ('delete', old.id, old.name, old.description);
END;
CREATE TRIGGER IF NOT EXISTS tb_search_tools_au
AFTER UPDATE OF name, description ON tb_search_tools BEGIN
  INSERT INTO tb_search_tools_fts(tb_search_tools_fts, rowid, name, description)
  VALUES ('delete', old.id, old.name, old.description);
  INSERT INTO tb_search_tools_fts(rowid, name, description)
  VALUES (new.id, new.name, new.description);
END;
`

const INSERT_SQL = `
INSERT INTO tb_search_tools (path, name, description, tool_json)
VALUES (@path, @name, @description, @toolJson)
`

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

/** Node 宿主的 better-sqlite3 FTS5/trigram SearchIndex。 */
export class SqliteSearchIndex implements MutableSearchIndex {
  readonly capabilities = ['search'] as const
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
    this.db = db
  }

  private insertRecords(records: readonly SerializedToolSearchRecord[]): void {
    const insert = this.db.prepare(INSERT_SQL)
    for (const record of records) insert.run(record)
  }

  async replace(path: TreePath, tools: readonly ToolSpec[]): Promise<void> {
    const canonical = normalizeToolSearchPath(path)
    const records = serializeToolSearchSnapshot(canonical, tools)
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM tb_search_tools WHERE path = ?').run(canonical)
      this.insertRecords(records)
    })()
  }

  async remove(path: TreePath): Promise<void> {
    const canonical = normalizeToolSearchPath(path)
    this.db.prepare('DELETE FROM tb_search_tools WHERE path = ?').run(canonical)
  }

  async rebuild(hits: readonly ToolSearchHit[]): Promise<void> {
    const records = serializeToolSearchHits(hits)
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM tb_search_tools').run()
      this.insertRecords(records)
      this.db.prepare(
        'INSERT INTO tb_search_tools_fts(tb_search_tools_fts) VALUES (\'rebuild\')',
      ).run()
    })()
  }

  async search(query: string, opts?: ToolSearchOptions): Promise<{ items: ToolSearchHit[] }> {
    assertKeywordToolSearchMode(opts)
    const expression = literalToolSearchQuery(query)
    const rows = this.db.prepare(`
      SELECT tools.path, tools.name, tools.tool_json
      FROM tb_search_tools_fts
      JOIN tb_search_tools AS tools ON tools.id = tb_search_tools_fts.rowid
      WHERE tb_search_tools_fts MATCH ?
      ORDER BY bm25(tb_search_tools_fts), tools.path, tools.name
      LIMIT ?
    `).all(expression, TOOL_SEARCH_CANDIDATE_LIMIT) as SearchRow[]
    return { items: rows.map(hitFromRow) }
  }

  close(): void {
    this.db.close()
  }
}
