import type { Sql, TransactionSql } from 'postgres'
import {
  type BuildSearchDocuments,
  PG_SEARCH_INSERT_ROWS_MAX,
  PG_SEARCH_SCHEMA_STATEMENTS,
  PG_SEARCH_SNAPSHOTS_COLUMNS,
  PG_SEARCH_SNAPSHOTS_TABLE,
  PG_SEARCH_TOOLS_COLUMNS,
  PG_SEARCH_TOOLS_TABLE,
  PG_SEARCH_WRITE_LOCK_KEY,
  pgBulkInsertSql,
  type SearchRegistrySnapshot,
  type SerializedToolSearchRecord,
  type SqlSearchDriver,
  SqlSearchIndex,
  type SqlSearchStatement,
  TOOL_SEARCH_AUDIT_NODE_LIMIT,
  type TreeNode,
  type TreePath,
} from '@tool-bridge/core'
/** PostgreSQL driver: transactions and bounded VALUES batches; search SQL is owned by core/pgSearchSql. */
import { readPgValues } from './pgStateStore'

class PgSearchDriver implements SqlSearchDriver {
  private schemaReady: Promise<void> | undefined

  constructor(private readonly sql: Sql, private readonly tx?: TransactionSql) {}

  async all<T>(statement: SqlSearchStatement): Promise<T[]> {
    return await (this.tx ?? this.sql).unsafe<T[]>(statement.sql, statement.params as never[])
  }

  private async initializeSchema(): Promise<void> {
    try {
      await this.sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(${PG_SEARCH_WRITE_LOCK_KEY})`
        for (const ddl of PG_SEARCH_SCHEMA_STATEMENTS) {
          await tx.unsafe(ddl)
        }
      })
    } catch (error) {
      this.schemaReady = undefined
      throw error
    }
  }

  ensureSchema(): Promise<void> {
    if (this.tx) return Promise.resolve()
    this.schemaReady ??= this.initializeSchema()
    return this.schemaReady
  }

  async first<T>(statement: SqlSearchStatement): Promise<T | null> {
    const rows = await (this.tx ?? this.sql).unsafe<T[]>(statement.sql, statement.params as never[])
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
      record => [record.path, record.name, record.description, record.effect, record.feedback],
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
    const write = async (tx: TransactionSql) => {
      // 全索引 mutation 串行化。容量上限靠 `COUNT(*)` 判定(应用层预检 + 触发器兜底),
      // 而 COUNT 不加锁:499 个 path 时两个并发 replace 都会读到 499、双双通过,
      // 提交后变成 501。事务级 advisory lock 让写路径彼此排队,COUNT 因此可信;
      // 锁随事务结束自动释放(无需显式 unlock,回滚也不泄漏)。
      // 读路径(search/meta)不取锁,不受影响。
      await tx`SELECT pg_advisory_xact_lock(${PG_SEARCH_WRITE_LOCK_KEY})`
      for (const statement of statements) {
        await tx.unsafe(statement.sql, statement.params as never[])
      }
    }
    if (this.tx) await write(this.tx)
    else await this.sql.begin(write)
  }
}

/** Node 自托管宿主的 postgres.js SearchIndex。 */
export class PgSearchIndex extends SqlSearchIndex {
  private snapshot?: { revision: string, tree: SearchRegistrySnapshot }
  private auditing?: Promise<SearchRegistrySnapshot>
  auditCanonical?: (build: BuildSearchDocuments) => Promise<SearchRegistrySnapshot>

  constructor(private readonly sql: Sql) {
    super(new PgSearchDriver(sql))
  }

  /** Install only when the standard host owns both tb_kv and this index. */
  async enableCanonicalAudit(): Promise<void> {
    await this.driver.ensureSchema()
    await this.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(${PG_SEARCH_WRITE_LOCK_KEY})`
      await tx`CREATE TABLE IF NOT EXISTS tb_search_input_v1 (id integer PRIMARY KEY CHECK(id=1), revision bigint NOT NULL)`
      await tx`INSERT INTO tb_search_input_v1 VALUES(1,0) ON CONFLICT DO NOTHING`
      await tx`CREATE OR REPLACE FUNCTION tb_search_input_changed() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE k text := COALESCE(NEW.key,OLD.key);
        BEGIN
          IF left(k,5)='node:' THEN
            IF TG_OP='UPDATE' AND OLD.value-'lastSeenAt'=NEW.value-'lastSeenAt' THEN RETURN NULL; END IF;
          ELSIF left(k,10)='toolcache:' THEN
            IF TG_OP='UPDATE' AND OLD.value->'tools' IS NOT DISTINCT FROM NEW.value->'tools' THEN RETURN NULL; END IF;
          ELSIF left(k,9)<>'feedback:' THEN RETURN NULL;
          END IF;
          UPDATE tb_search_input_v1 SET revision=revision+1 WHERE id=1;
          RETURN NULL;
        END $$`
      await tx`CREATE OR REPLACE TRIGGER tb_search_input_write AFTER INSERT OR UPDATE OR DELETE ON tb_kv
        FOR EACH ROW EXECUTE FUNCTION tb_search_input_changed()`
    })
    this.auditCanonical = async (build) => {
      const [row] = await this.sql<{ revision: string }[]>`SELECT revision::text FROM tb_search_input_v1 WHERE id=1`
      if (this.snapshot && this.snapshot.revision === row!.revision) return this.snapshot.tree
      // Coalesce readers per replica; a caller observing a newer revision must not reuse an older in-flight result.
      if (this.auditing) {
        await this.auditing
        return this.auditCanonical!(build)
      }
      this.auditing = this.audit(build).finally(() => {
        this.auditing = undefined
      })
      return this.auditing
    }
  }

  private async audit(build: BuildSearchDocuments): Promise<SearchRegistrySnapshot> {
    const result = await this.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(${PG_SEARCH_WRITE_LOCK_KEY})`
      // Canonical writes increment this row in their own transaction. Taking its lock
      // keeps registry/cache/feedback and the rebuilt index at a single committed cut.
      const [row] = await tx<{ revision: string }[]>`SELECT revision::text FROM tb_search_input_v1 WHERE id=1 FOR UPDATE`
      const records = await tx<{ value: TreeNode }[]>`SELECT value FROM tb_kv
        WHERE key>='node:' AND key<'node;' ORDER BY key LIMIT ${TOOL_SEARCH_AUDIT_NODE_LIMIT + 1}`
      const tree = { items: records.slice(0, TOOL_SEARCH_AUDIT_NODE_LIMIT).map(r => r.value), truncated: records.length > TOOL_SEARCH_AUDIT_NODE_LIMIT }
      if (!tree.truncated) {
        const documents = await build(tree.items, keys => readPgValues(tx, keys))
        await new SqlSearchIndex(new PgSearchDriver(this.sql, tx)).rebuild(documents)
      }
      return { revision: row!.revision, tree }
    })
    this.snapshot = result
    return result.tree
  }
}
