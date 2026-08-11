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
  TBError,
  TOOL_SEARCH_AUDIT_NODE_LIMIT,
  TOOL_SEARCH_BATCH_LIMIT,
  TOOL_SEARCH_PAGE_BYTES,
  TOOL_SEARCH_RECORD_JSON_BYTES_MAX,
  type ToolSearchCandidate,
  type ToolSearchDocument,
  type ToolSearchHit,
  type ToolSearchHydration,
  type ToolSearchOptions,
  toolSearchSnapshotDigest,
  toolSearchSnapshotDigests,
  toolSearchSnapshotDigestsEqual,
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
  `CREATE TABLE IF NOT EXISTS tb_search_tools_v2 (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    feedback TEXT NOT NULL DEFAULT '',
    tool_json TEXT NOT NULL,
    UNIQUE(path, name)
  )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS tb_search_tools_fts_v2 USING fts5(
    name,
    description,
    feedback,
    content='tb_search_tools_v2',
    content_rowid='id',
    tokenize='trigram'
  )`,
  `CREATE TRIGGER IF NOT EXISTS tb_search_tools_v2_ai AFTER INSERT ON tb_search_tools_v2 BEGIN
    INSERT INTO tb_search_tools_fts_v2(rowid, name, description, feedback)
    VALUES (new.id, new.name, new.description, new.feedback);
  END`,
  `CREATE TRIGGER IF NOT EXISTS tb_search_tools_v2_ad AFTER DELETE ON tb_search_tools_v2 BEGIN
    INSERT INTO tb_search_tools_fts_v2(tb_search_tools_fts_v2, rowid, name, description, feedback)
    VALUES ('delete', old.id, old.name, old.description, old.feedback);
  END`,
  `CREATE TRIGGER IF NOT EXISTS tb_search_tools_v2_au
  AFTER UPDATE OF name, description, feedback ON tb_search_tools_v2 BEGIN
    INSERT INTO tb_search_tools_fts_v2(tb_search_tools_fts_v2, rowid, name, description, feedback)
    VALUES ('delete', old.id, old.name, old.description, old.feedback);
    INSERT INTO tb_search_tools_fts_v2(rowid, name, description, feedback)
    VALUES (new.id, new.name, new.description, new.feedback);
  END`,
  `CREATE TABLE IF NOT EXISTS tb_search_meta_v2 (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    revision INTEGER NOT NULL DEFAULT 0,
    seeded INTEGER NOT NULL DEFAULT 0,
    legacy_migrated INTEGER NOT NULL DEFAULT 0,
    cursor_secret TEXT NOT NULL
  )`,
  `INSERT OR IGNORE INTO tb_search_meta_v2(
    singleton, revision, seeded, legacy_migrated, cursor_secret
  ) VALUES (1, 0, 0, 0, lower(hex(randomblob(32))))`,
  `CREATE TABLE IF NOT EXISTS tb_search_snapshots_v2 (
    path TEXT PRIMARY KEY,
    digest TEXT NOT NULL
  )`,
  `CREATE TRIGGER IF NOT EXISTS tb_search_snapshots_v2_capacity
  BEFORE INSERT ON tb_search_snapshots_v2
  WHEN NOT EXISTS (
    SELECT 1 FROM tb_search_snapshots_v2 WHERE path = new.path
  ) AND (SELECT COUNT(*) FROM tb_search_snapshots_v2) >= ${TOOL_SEARCH_AUDIT_NODE_LIMIT}
  BEGIN
    SELECT RAISE(ABORT, 'tb_search_path_capacity');
  END`,
  `INSERT OR IGNORE INTO tb_search_tools_v2(path, name, description, feedback, tool_json)
  SELECT path, name, description, '', tool_json FROM tb_search_tools
  WHERE (SELECT legacy_migrated FROM tb_search_meta_v2 WHERE singleton = 1) = 0`,
  `UPDATE tb_search_meta_v2
  SET
    revision = revision + CASE WHEN EXISTS (SELECT 1 FROM tb_search_tools_v2) THEN 1 ELSE 0 END,
    legacy_migrated = 1
  WHERE singleton = 1 AND legacy_migrated = 0`,
] as const

const INSERT_JSON_SQL = `
INSERT INTO tb_search_tools_v2 (path, name, description, feedback, tool_json)
SELECT
  json_extract(value, '$.path'),
  json_extract(value, '$.name'),
  json_extract(value, '$.description'),
  json_extract(value, '$.feedback'),
  json(json_extract(value, '$.tool'))
FROM json_each(?)
`

const BUMP_REVISION_SQL
  = 'UPDATE tb_search_meta_v2 SET revision = revision + 1 WHERE singleton = 1'
const COMPLETE_REBUILD_SQL
  = 'UPDATE tb_search_meta_v2 SET seeded = 1, revision = revision + 1 WHERE singleton = 1'

const D1_SEARCH_JSON_CHUNK_BYTES = TOOL_SEARCH_RECORD_JSON_BYTES_MAX
/** source + snapshot JSON1 导入块总上限；完整 cold search 最坏 48 queries。 */
export const D1_SEARCH_MUTATION_LIMIT = 20
export const D1_SEARCH_COLD_QUERY_MAX
  = SCHEMA_STATEMENTS.length
    + 2 // rebuild snapshot + meta
    + 2 // rebuild source/snapshot deletes
    + D1_SEARCH_MUTATION_LIMIT // source + snapshot JSON1 chunks
    + 1 // complete rebuild revision
    + 8 // four candidate batches: meta + candidate SQL
    + 2 // hydrate meta + JSON1 query
    + 1 // mid-batch public cursor meta

interface CandidateRow {
  id: number
  name: string
  path: string
}

interface HydratedRow {
  name: string
  ord: number
  path: string
  tool_json: string
}

interface MetaRow {
  cursor_secret: string
  revision: number
  seeded: number
}

function hitFromRow(row: HydratedRow): ToolSearchHit {
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

function shortTermsSql(patterns: readonly string[]): string {
  return `short_terms(pattern) AS (VALUES ${patterns.map(() => '(?)').join(', ')})`
}

const SHORT_MATCH_SQL = `
NOT EXISTS (
  SELECT 1 FROM short_terms
  WHERE tools.name NOT LIKE pattern ESCAPE '!'
    AND tools.description NOT LIKE pattern ESCAPE '!'
    AND tools.feedback NOT LIKE pattern ESCAPE '!'
)
`

const SHORT_SCORE_SQL = `
(
  SELECT COALESCE(SUM(
    CASE
      WHEN tools.name LIKE pattern ESCAPE '!' THEN 10
      WHEN tools.description LIKE pattern ESCAPE '!' THEN 3
      WHEN tools.feedback LIKE pattern ESCAPE '!' THEN 1
      ELSE 0
    END
  ), 0)
  FROM short_terms
)
`

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

  private insertStatements(records: readonly SerializedToolSearchRecord[]): D1PreparedStatement[] {
    const payload = records.map(record => ({
      description: record.description,
      feedback: record.feedback,
      name: record.name,
      path: record.path,
      tool: JSON.parse(record.toolJson) as unknown,
    }))
    return this.jsonChunks(payload).map(chunk => this.db.prepare(INSERT_JSON_SQL).bind(chunk))
  }

  private async meta(): Promise<MetaRow> {
    const row = await this.db.prepare(
      'SELECT revision, seeded, cursor_secret FROM tb_search_meta_v2 WHERE singleton = 1',
    ).first<MetaRow>()
    if (row === null) throw new TBError('internal', '工具搜索 meta 缺失')
    return row
  }

  private async snapshotDigests(): Promise<Map<TreePath, string>> {
    const result = await this.db.prepare(
      'SELECT path, digest FROM tb_search_snapshots_v2 ORDER BY path',
    ).all<{ digest: string, path: string }>()
    return new Map(result.results.map(row => [row.path, row.digest]))
  }

  private snapshotStatements(digests: ReadonlyMap<TreePath, string>): D1PreparedStatement[] {
    return this.jsonChunks([...digests]).map(chunk => this.db.prepare(`
      INSERT INTO tb_search_snapshots_v2(path, digest)
      SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?)
    `).bind(chunk))
  }

  async initialized(): Promise<boolean> {
    await this.ensureSchema()
    return (await this.meta()).seeded === 1
  }

  async replace(
    path: TreePath,
    tools: readonly ToolSpec[],
    opts: { feedback?: string } = {},
  ): Promise<void> {
    const canonical = normalizeToolSearchPath(path)
    const records = serializeToolSearchSnapshot(canonical, tools, opts.feedback ?? '')
    await this.ensureSchema()
    const current = await this.db.prepare(`
      SELECT snapshots.digest,
        EXISTS(SELECT 1 FROM tb_search_tools_v2 WHERE path = ?) AS has_tools,
        (SELECT COUNT(*) FROM tb_search_snapshots_v2) AS path_count
      FROM (SELECT 1) AS singleton
      LEFT JOIN tb_search_snapshots_v2 AS snapshots ON snapshots.path = ?
    `).bind(canonical, canonical).first<{
      digest: string | null
      has_tools: number
      path_count: number
    }>()
    const digest = records.length === 0 ? null : toolSearchSnapshotDigest(records)
    if (
      current !== null
      && (
        (digest !== null && current.digest === digest)
        || (digest === null && current.digest === null && current.has_tools === 0)
      )
    ) return
    if (
      digest !== null
      && current?.digest === null
      && (current?.path_count ?? 0) >= TOOL_SEARCH_AUDIT_NODE_LIMIT
    ) {
      throw new TBError('rate_limited', '工具搜索索引节点容量已满')
    }
    const inserts = this.insertStatements(records)
    if (inserts.length > D1_SEARCH_MUTATION_LIMIT) {
      throw new TBError(
        'invalid_argument',
        `D1 工具索引单次 mutation 最多 ${D1_SEARCH_MUTATION_LIMIT} 个 JSON1 块`,
      )
    }
    const statements = [
      this.db.prepare('DELETE FROM tb_search_tools_v2 WHERE path = ?').bind(canonical),
      ...inserts,
      this.db.prepare('DELETE FROM tb_search_snapshots_v2 WHERE path = ?').bind(canonical),
      ...(digest === null
        ? []
        : [this.db.prepare(
            'INSERT INTO tb_search_snapshots_v2(path, digest) VALUES (?, ?)',
          ).bind(canonical, digest)]),
      this.db.prepare(BUMP_REVISION_SQL),
    ]
    try {
      await this.db.batch(statements)
    } catch (error) {
      if (String(error).includes('tb_search_path_capacity')) {
        throw new TBError('rate_limited', '工具搜索索引节点容量已满')
      }
      throw error
    }
  }

  async remove(path: TreePath): Promise<void> {
    const canonical = normalizeToolSearchPath(path)
    await this.ensureSchema()
    const current = await this.db.prepare(
      'SELECT 1 AS present FROM tb_search_tools_v2 WHERE path = ? LIMIT 1',
    ).bind(canonical).first<{ present: number }>()
    if (current === null) return
    await this.db.batch([
      this.db.prepare('DELETE FROM tb_search_tools_v2 WHERE path = ?').bind(canonical),
      this.db.prepare('DELETE FROM tb_search_snapshots_v2 WHERE path = ?').bind(canonical),
      this.db.prepare(BUMP_REVISION_SQL),
    ])
  }

  async removePrefix(path: TreePath): Promise<void> {
    const canonical = normalizeToolSearchPath(path)
    await this.ensureSchema()
    const current = await this.db.prepare(`
      SELECT 1 AS present FROM tb_search_tools_v2
      WHERE path = ? OR substr(path, 1, length(?) + 1) = ? || '/'
      LIMIT 1
    `).bind(canonical, canonical, canonical).first<{ present: number }>()
    if (current === null) return
    await this.db.batch([
      this.db.prepare(`
        DELETE FROM tb_search_tools_v2
        WHERE path = ? OR substr(path, 1, length(?) + 1) = ? || '/'
      `).bind(canonical, canonical, canonical),
      this.db.prepare(`
        DELETE FROM tb_search_snapshots_v2
        WHERE path = ? OR substr(path, 1, length(?) + 1) = ? || '/'
      `).bind(canonical, canonical, canonical),
      this.db.prepare(BUMP_REVISION_SQL),
    ])
  }

  async rebuild(documents: readonly ToolSearchDocument[]): Promise<void> {
    const records = serializeToolSearchDocuments(documents)
    await this.ensureSchema()
    const desired = toolSearchSnapshotDigests(records)
    const current = await this.snapshotDigests()
    if ((await this.meta()).seeded === 1 && toolSearchSnapshotDigestsEqual(current, desired)) {
      return
    }
    const inserts = this.insertStatements(records)
    const snapshots = this.snapshotStatements(desired)
    if (inserts.length + snapshots.length > D1_SEARCH_MUTATION_LIMIT) {
      throw new TBError(
        'invalid_argument',
        `D1 工具索引单次 mutation 最多 ${D1_SEARCH_MUTATION_LIMIT} 个 JSON1 块`,
      )
    }
    await this.db.batch([
      this.db.prepare('DELETE FROM tb_search_tools_v2'),
      this.db.prepare('DELETE FROM tb_search_snapshots_v2'),
      ...inserts,
      ...snapshots,
      this.db.prepare(COMPLETE_REBUILD_SQL),
    ])
  }

  async search(
    query: string,
    opts?: ToolSearchOptions,
  ): Promise<{ cursor?: string, items: ToolSearchCandidate[] }> {
    assertKeywordToolSearchMode(opts)
    const normalized = normalizeToolSearchQuery(query)
    const mode = opts?.mode ?? 'keyword'
    await this.ensureSchema()
    const meta = await this.meta()
    const revision = meta.revision
    const secret = meta.cursor_secret
    const offset = await decodeToolSearchCursor(opts?.cursor, normalized, mode, revision, secret)
    const limit = Math.min(normalizeToolSearchLimit(opts?.limit), TOOL_SEARCH_BATCH_LIMIT)
    const prepared = prepareToolSearchQuery(normalized)
    let statement: D1PreparedStatement
    if (prepared.kind === 'like') {
      statement = this.db.prepare(`
        WITH ${shortTermsSql(prepared.patterns)}
        SELECT tools.id, tools.path, tools.name, ${SHORT_SCORE_SQL} AS short_score
        FROM tb_search_tools_v2 AS tools
        WHERE ${SHORT_MATCH_SQL}
        ORDER BY short_score DESC, tools.path, tools.name
        LIMIT ? OFFSET ?
      `).bind(...prepared.patterns, limit + 1, offset)
    } else if (prepared.kind === 'hybrid') {
      statement = this.db.prepare(`
        WITH ${shortTermsSql(prepared.patterns)},
        long_hits AS (
          SELECT tools.id, bm25(tb_search_tools_fts_v2, 10.0, 3.0, 1.0) AS fts_rank
          FROM tb_search_tools_fts_v2
          JOIN tb_search_tools_v2 AS tools ON tools.id = tb_search_tools_fts_v2.rowid
          WHERE tb_search_tools_fts_v2 MATCH ?
        )
        SELECT tools.id, tools.path, tools.name, long_hits.fts_rank,
          ${SHORT_SCORE_SQL} AS short_score
        FROM long_hits
        JOIN tb_search_tools_v2 AS tools ON tools.id = long_hits.id
        WHERE ${SHORT_MATCH_SQL}
        ORDER BY long_hits.fts_rank, short_score DESC, tools.path, tools.name
        LIMIT ? OFFSET ?
      `).bind(...prepared.patterns, prepared.expression, limit + 1, offset)
    } else {
      statement = this.db.prepare(`
        SELECT tools.id, tools.path, tools.name
        FROM tb_search_tools_fts_v2
        JOIN tb_search_tools_v2 AS tools ON tools.id = tb_search_tools_fts_v2.rowid
        WHERE tb_search_tools_fts_v2 MATCH ?
        ORDER BY bm25(tb_search_tools_fts_v2, 10.0, 3.0, 1.0), tools.path, tools.name
        LIMIT ? OFFSET ?
      `).bind(prepared.expression, limit + 1, offset)
    }
    const result = await statement.all<CandidateRow>()
    const hasMore = result.results.length > limit
    const page = hasMore ? result.results.slice(0, limit) : result.results
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
            secret,
          ),
        }
      : { items }
  }

  async cursorFor(
    query: string,
    candidate: ToolSearchCandidate,
    mode: 'keyword' | 'semantic' = 'keyword',
  ): Promise<string> {
    await this.ensureSchema()
    const meta = await this.meta()
    if (candidate.revision !== meta.revision) {
      throw new TBError('invalid_argument', '搜索 cursor 已失效')
    }
    return await encodeToolSearchCursor(
      query,
      mode,
      candidate.revision,
      candidate.resumeOffset,
      meta.cursor_secret,
    )
  }

  async hydrate(candidates: readonly ToolSearchCandidate[]): Promise<ToolSearchHydration> {
    if (candidates.length === 0) return { consumed: 0, hits: [] }
    if (candidates.length > 200) {
      throw new TBError('invalid_argument', '单次 hydrate 最多 200 个工具候选')
    }
    await this.ensureSchema()
    const meta = await this.meta()
    if (candidates.some(candidate => candidate.revision !== meta.revision || !/^\d+$/.test(candidate.ref))) {
      throw new TBError('invalid_argument', '搜索 cursor 已失效')
    }
    const refs = candidates.map(candidate => Number(candidate.ref))
    const result = await this.db.prepare(`
      WITH requested AS (
        SELECT CAST(key AS INTEGER) AS ord, CAST(value AS INTEGER) AS id
        FROM json_each(?)
      ), sized AS (
        SELECT requested.ord, tools.path, tools.name, tools.tool_json,
          length(CAST(tools.tool_json AS BLOB)) AS byte_len
        FROM requested
        JOIN tb_search_tools_v2 AS tools ON tools.id = requested.id
      ), accumulated AS (
        SELECT *, SUM(byte_len) OVER (ORDER BY ord ROWS UNBOUNDED PRECEDING) AS total_bytes
        FROM sized
      )
      SELECT ord, path, name, tool_json
      FROM accumulated
      WHERE total_bytes <= ?
      ORDER BY ord
    `).bind(JSON.stringify(refs), TOOL_SEARCH_PAGE_BYTES).all<HydratedRow>()
    const hits = result.results.map((row, index) => {
      const candidate = candidates[index]
      if (
        row.ord !== index
        || candidate === undefined
        || row.path !== candidate.path
        || row.name !== candidate.name
      ) {
        throw new TBError('internal', '工具搜索候选在 hydrate 前发生漂移')
      }
      return hitFromRow(row)
    })
    return { consumed: hits.length, hits }
  }
}
