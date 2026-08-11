import {
  assertKeywordToolSearchMode,
  decodeToolSearchCursor,
  encodeToolSearchCursor,
  type MutableSearchIndex,
  normalizeToolSearchLimit,
  normalizeToolSearchPath,
  normalizeToolSearchQuery,
  prepareToolSearchQuery,
  type SerializedToolSearchRecord,
  serializeToolSearchDocuments,
  serializeToolSearchSnapshot,
  SHORT_MATCH_SQL,
  SHORT_SCORE_SQL,
  shortTermsSql,
  TBError,
  TOOL_SEARCH_AUDIT_NODE_LIMIT,
  TOOL_SEARCH_BATCH_LIMIT,
  type ToolSearchCandidate,
  type ToolSearchDocument,
  type ToolSearchOptions,
  toolSearchSnapshotDigest,
  toolSearchSnapshotDigests,
  toolSearchSnapshotDigestsEqual,
  type ToolSpec,
  type TreePath,
} from '@tool-bridge/core'
import Database from 'better-sqlite3'

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tb_search_tools_v3 (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  feedback TEXT NOT NULL DEFAULT '',
  UNIQUE(path, name)
);
CREATE VIRTUAL TABLE IF NOT EXISTS tb_search_tools_fts_v3 USING fts5(
  name,
  description,
  feedback,
  content='tb_search_tools_v3',
  content_rowid='id',
  tokenize='trigram'
);
CREATE TRIGGER IF NOT EXISTS tb_search_tools_v3_ai AFTER INSERT ON tb_search_tools_v3 BEGIN
  INSERT INTO tb_search_tools_fts_v3(rowid, name, description, feedback)
  VALUES (new.id, new.name, new.description, new.feedback);
END;
CREATE TRIGGER IF NOT EXISTS tb_search_tools_v3_ad AFTER DELETE ON tb_search_tools_v3 BEGIN
  INSERT INTO tb_search_tools_fts_v3(tb_search_tools_fts_v3, rowid, name, description, feedback)
  VALUES ('delete', old.id, old.name, old.description, old.feedback);
END;
CREATE TRIGGER IF NOT EXISTS tb_search_tools_v3_au
AFTER UPDATE OF name, description, feedback ON tb_search_tools_v3 BEGIN
  INSERT INTO tb_search_tools_fts_v3(tb_search_tools_fts_v3, rowid, name, description, feedback)
  VALUES ('delete', old.id, old.name, old.description, old.feedback);
  INSERT INTO tb_search_tools_fts_v3(rowid, name, description, feedback)
  VALUES (new.id, new.name, new.description, new.feedback);
END;
CREATE TABLE IF NOT EXISTS tb_search_meta_v3 (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  seeded INTEGER NOT NULL DEFAULT 0,
  cursor_secret TEXT NOT NULL
);
INSERT OR IGNORE INTO tb_search_meta_v3(
  singleton, revision, seeded, cursor_secret
) VALUES (1, 0, 0, lower(hex(randomblob(32))));
CREATE TABLE IF NOT EXISTS tb_search_snapshots_v3 (
  path TEXT PRIMARY KEY,
  digest TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS tb_search_snapshots_v3_capacity
BEFORE INSERT ON tb_search_snapshots_v3
WHEN NOT EXISTS (
  SELECT 1 FROM tb_search_snapshots_v3 WHERE path = new.path
) AND (SELECT COUNT(*) FROM tb_search_snapshots_v3) >= ${TOOL_SEARCH_AUDIT_NODE_LIMIT}
BEGIN
  SELECT RAISE(ABORT, 'tb_search_path_capacity');
END;
`

const INSERT_SQL = `
INSERT INTO tb_search_tools_v3 (path, name, description, feedback)
VALUES (@path, @name, @description, @feedback)
`

const BUMP_REVISION_SQL = `
UPDATE tb_search_meta_v3 SET revision = revision + 1 WHERE singleton = 1
`

const COMPLETE_REBUILD_SQL = `
UPDATE tb_search_meta_v3 SET seeded = 1, revision = revision + 1 WHERE singleton = 1
`

interface CandidateRow {
  id: number
  name: string
  path: string
}

interface MetaRow {
  cursor_secret: string
  revision: number
  seeded: number
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

  private meta(): MetaRow {
    const row = this.db.prepare(
      'SELECT revision, seeded, cursor_secret FROM tb_search_meta_v3 WHERE singleton = 1',
    ).get() as MetaRow
    return row
  }

  private snapshotDigests(): Map<TreePath, string> {
    const rows = this.db.prepare(
      'SELECT path, digest FROM tb_search_snapshots_v3 ORDER BY path',
    ).all() as Array<{ digest: string, path: string }>
    return new Map(rows.map(row => [row.path, row.digest]))
  }

  private insertSnapshotDigests(digests: ReadonlyMap<TreePath, string>): void {
    const insert = this.db.prepare(
      'INSERT INTO tb_search_snapshots_v3(path, digest) VALUES (?, ?)',
    )
    for (const [path, digest] of digests) insert.run(path, digest)
  }

  async initialized(): Promise<boolean> {
    return this.meta().seeded === 1
  }

  async replace(
    path: TreePath,
    tools: readonly ToolSpec[],
    opts: { feedback?: string } = {},
  ): Promise<void> {
    const canonical = normalizeToolSearchPath(path)
    const records = serializeToolSearchSnapshot(canonical, tools, opts.feedback ?? '')
    const current = this.db.prepare(`
      SELECT snapshots.digest,
        EXISTS(SELECT 1 FROM tb_search_tools_v3 WHERE path = ?) AS has_tools,
        (SELECT COUNT(*) FROM tb_search_snapshots_v3) AS path_count
      FROM (SELECT 1) AS singleton
      LEFT JOIN tb_search_snapshots_v3 AS snapshots ON snapshots.path = ?
    `).get(canonical, canonical) as {
      digest: string | null
      has_tools: number
      path_count: number
    }
    const digest = records.length === 0 ? null : toolSearchSnapshotDigest(records)
    if (
      (digest !== null && current.digest === digest)
      || (current.digest === null && digest === null && current.has_tools === 0)
    ) return
    if (
      digest !== null
      && current.digest === null
      && current.path_count >= TOOL_SEARCH_AUDIT_NODE_LIMIT
    ) {
      throw new TBError('rate_limited', '工具搜索索引节点容量已满')
    }
    try {
      this.db.transaction(() => {
        this.db.prepare('DELETE FROM tb_search_tools_v3 WHERE path = ?').run(canonical)
        this.insertRecords(records)
        this.db.prepare('DELETE FROM tb_search_snapshots_v3 WHERE path = ?').run(canonical)
        if (digest !== null) {
          this.db.prepare(
            'INSERT INTO tb_search_snapshots_v3(path, digest) VALUES (?, ?)',
          ).run(canonical, digest)
        }
        this.db.prepare(BUMP_REVISION_SQL).run()
      })()
    } catch (error) {
      if (String(error).includes('tb_search_path_capacity')) {
        throw new TBError('rate_limited', '工具搜索索引节点容量已满')
      }
      throw error
    }
  }

  async remove(path: TreePath): Promise<void> {
    const canonical = normalizeToolSearchPath(path)
    const current = this.db.prepare(
      'SELECT 1 AS present FROM tb_search_tools_v3 WHERE path = ? LIMIT 1',
    ).get(canonical) as { present: number } | undefined
    if (current === undefined) return
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM tb_search_tools_v3 WHERE path = ?').run(canonical)
      this.db.prepare('DELETE FROM tb_search_snapshots_v3 WHERE path = ?').run(canonical)
      this.db.prepare(BUMP_REVISION_SQL).run()
    })()
  }

  async removePrefix(path: TreePath): Promise<void> {
    const canonical = normalizeToolSearchPath(path)
    const current = this.db.prepare(`
      SELECT 1 AS present FROM tb_search_tools_v3
      WHERE path = ? OR substr(path, 1, length(?) + 1) = ? || '/'
      LIMIT 1
    `).get(canonical, canonical, canonical) as { present: number } | undefined
    if (current === undefined) return
    this.db.transaction(() => {
      this.db.prepare(`
        DELETE FROM tb_search_tools_v3
        WHERE path = ? OR substr(path, 1, length(?) + 1) = ? || '/'
      `).run(canonical, canonical, canonical)
      this.db.prepare(`
        DELETE FROM tb_search_snapshots_v3
        WHERE path = ? OR substr(path, 1, length(?) + 1) = ? || '/'
      `).run(canonical, canonical, canonical)
      this.db.prepare(BUMP_REVISION_SQL).run()
    })()
  }

  async rebuild(documents: readonly ToolSearchDocument[]): Promise<void> {
    const records = serializeToolSearchDocuments(documents)
    const desired = toolSearchSnapshotDigests(records)
    const current = this.snapshotDigests()
    if (this.meta().seeded === 1 && toolSearchSnapshotDigestsEqual(current, desired)) {
      return
    }
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM tb_search_tools_v3').run()
      this.db.prepare('DELETE FROM tb_search_snapshots_v3').run()
      this.insertRecords(records)
      this.insertSnapshotDigests(desired)
      this.db.prepare(COMPLETE_REBUILD_SQL).run()
    })()
  }

  async search(
    query: string,
    opts?: ToolSearchOptions,
  ): Promise<{ cursor?: string, items: ToolSearchCandidate[] }> {
    assertKeywordToolSearchMode(opts)
    const normalized = normalizeToolSearchQuery(query)
    const mode = opts?.mode ?? 'keyword'
    const meta = this.meta()
    const revision = meta.revision
    const offset = await decodeToolSearchCursor(
      opts?.cursor,
      normalized,
      mode,
      revision,
      meta.cursor_secret,
    )
    const limit = Math.min(normalizeToolSearchLimit(opts?.limit), TOOL_SEARCH_BATCH_LIMIT)
    const prepared = prepareToolSearchQuery(normalized)
    let rows: CandidateRow[]
    if (prepared.kind === 'like') {
      rows = this.db.prepare(`
        WITH ${shortTermsSql(prepared.patterns)}
        SELECT tools.id, tools.path, tools.name, ${SHORT_SCORE_SQL} AS short_score
        FROM tb_search_tools_v3 AS tools
        WHERE ${SHORT_MATCH_SQL}
        ORDER BY short_score DESC, tools.path, tools.name
        LIMIT ? OFFSET ?
      `).all(...prepared.patterns, limit + 1, offset) as CandidateRow[]
    } else if (prepared.kind === 'hybrid') {
      rows = this.db.prepare(`
        WITH ${shortTermsSql(prepared.patterns)},
        long_hits AS (
          SELECT tools.id, bm25(tb_search_tools_fts_v3, 10.0, 3.0, 1.0) AS fts_rank
          FROM tb_search_tools_fts_v3
          JOIN tb_search_tools_v3 AS tools ON tools.id = tb_search_tools_fts_v3.rowid
          WHERE tb_search_tools_fts_v3 MATCH ?
        )
        SELECT tools.id, tools.path, tools.name, long_hits.fts_rank,
          ${SHORT_SCORE_SQL} AS short_score
        FROM long_hits
        JOIN tb_search_tools_v3 AS tools ON tools.id = long_hits.id
        WHERE ${SHORT_MATCH_SQL}
        ORDER BY long_hits.fts_rank, short_score DESC, tools.path, tools.name
        LIMIT ? OFFSET ?
      `).all(...prepared.patterns, prepared.expression, limit + 1, offset) as CandidateRow[]
    } else {
      rows = this.db.prepare(`
        SELECT tools.id, tools.path, tools.name
        FROM tb_search_tools_fts_v3
        JOIN tb_search_tools_v3 AS tools ON tools.id = tb_search_tools_fts_v3.rowid
        WHERE tb_search_tools_fts_v3 MATCH ?
        ORDER BY bm25(tb_search_tools_fts_v3, 10.0, 3.0, 1.0), tools.path, tools.name
        LIMIT ? OFFSET ?
      `).all(prepared.expression, limit + 1, offset) as CandidateRow[]
    }
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const items = page.map((row, index): ToolSearchCandidate => ({
      name: row.name,
      path: row.path,
      ref: String(row.id),
      resumeOffset: offset + index + 1,
      revision,
    }))
    const last = items[items.length - 1]
    return hasMore && last !== undefined
      ? {
          items,
          cursor: await encodeToolSearchCursor(
            normalized,
            mode,
            revision,
            last.resumeOffset,
            meta.cursor_secret,
          ),
        }
      : { items }
  }

  async cursorFor(
    query: string,
    candidate: ToolSearchCandidate,
    mode: 'keyword' | 'semantic' = 'keyword',
  ): Promise<string> {
    const meta = this.meta()
    if (candidate.revision !== meta.revision) {
      throw new TBError('invalid_argument', '搜索 cursor 已失效')
    }
    return await encodeToolSearchCursor(
      query,
      mode,
      meta.revision,
      candidate.resumeOffset,
      meta.cursor_secret,
    )
  }

  close(): void {
    this.db.close()
  }
}
