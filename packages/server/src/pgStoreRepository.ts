import type { Sql } from 'postgres'
import { assertUploadBinding, type BeginStoreUpload, type CallUploadCapability, reserveUploadQuota,
  type ShareGrant, type StoreIdempotencyBinding, type StoreObject, type StoreRecords,
  type StoreRepository, TBError, type UploadSession } from '@tool-bridge/core'

type StoreTable = 'tb_store_objects' | 'tb_store_uploads' | 'tb_store_shares' | 'tb_store_call_capabilities' | 'tb_store_idempotency'

class PgStoreRecords<T extends { revision: number }> implements StoreRecords<T> {
  constructor(private readonly sql: Sql, private readonly table: StoreTable) {}
  async get(id: string): Promise<T | null> {
    const rows = await this.sql<{ record: T }[]>`SELECT record FROM ${this.sql(this.table)} WHERE id = ${id}`
    return rows[0]?.record ?? null
  }

  async compare(id: string, revision: number | null, next: T | null): Promise<boolean> {
    if (revision === null) {
      if (next === null) return false
      const rows = await this.sql`INSERT INTO ${this.sql(this.table)} (id, record)
        VALUES (${id}, ${this.sql.json(next as never)}) ON CONFLICT (id) DO NOTHING`
      return rows.count > 0
    }
    if (!Number.isSafeInteger(revision) || revision < 1 || (next !== null && next.revision !== revision + 1)) return false
    const rows = next === null
      ? await this.sql`DELETE FROM ${this.sql(this.table)} WHERE id = ${id} AND revision = ${revision}`
      : await this.sql`UPDATE ${this.sql(this.table)} SET record = ${this.sql.json(next as never)}
          WHERE id = ${id} AND revision = ${revision}
          AND (record->>'backendId' IS NOT DISTINCT FROM ${this.sql.json(next as never)}->>'backendId')`
    return rows.count > 0
  }

  async list(opts: { cursor?: string, limit: number }): Promise<{ cursor?: string, items: Array<{ key: string, value: T }> }> {
    const rows = await this.sql<{ id: string, record: T }[]>`SELECT id, record FROM ${this.sql(this.table)}
      WHERE id > ${opts.cursor ?? ''} ORDER BY id LIMIT ${opts.limit + 1}`
    const items = rows.slice(0, opts.limit).map(row => ({ key: row.id, value: row.record }))
    const last = items.at(-1)
    return { items, ...(rows.length > opts.limit && last !== undefined ? { cursor: last.key } : {}) }
  }
}

/** PG-only metadata authority. No operation accepts callbacks or performs object/network I/O. */
export class PgStoreRepository implements StoreRepository {
  readonly objects: StoreRecords<StoreObject>
  readonly uploads: StoreRecords<UploadSession>
  readonly shares: StoreRecords<ShareGrant>
  readonly callCapabilities: StoreRecords<CallUploadCapability>
  readonly idempotencyBindings: StoreRecords<StoreIdempotencyBinding>

  constructor(private readonly sql: Sql) {
    this.objects = new PgStoreRecords(sql, 'tb_store_objects')
    this.uploads = new PgStoreRecords(sql, 'tb_store_uploads')
    this.shares = new PgStoreRecords(sql, 'tb_store_shares')
    this.callCapabilities = new PgStoreRecords(sql, 'tb_store_call_capabilities')
    this.idempotencyBindings = new PgStoreRecords(sql, 'tb_store_idempotency')
  }

  async ensureSchema(): Promise<void> {
    await this.sql.begin(async (sql) => {
      // Serialize migrations across replicas; all DDL below is one recoverable transaction.
      await sql`SELECT pg_advisory_xact_lock(hashtextextended('tb:store:schema:v1', 0))`
      await sql`CREATE TABLE IF NOT EXISTS tb_storage_backends (id text PRIMARY KEY, record jsonb NOT NULL)`
      await sql`CREATE TABLE IF NOT EXISTS tb_storage_active (
        id integer PRIMARY KEY CHECK (id = 1),
        backend_id text NOT NULL REFERENCES tb_storage_backends(id), revision bigint NOT NULL CHECK (revision > 0))`
      await sql`CREATE TABLE IF NOT EXISTS tb_store_objects (
        id text COLLATE "C" PRIMARY KEY, record jsonb NOT NULL,
        revision bigint GENERATED ALWAYS AS ((record->>'revision')::bigint) STORED NOT NULL CHECK (revision > 0),
        backend_id text GENERATED ALWAYS AS (record->>'backendId') STORED NOT NULL REFERENCES tb_storage_backends(id),
        owner text GENERATED ALWAYS AS (record->>'owner') STORED NOT NULL,
        status text GENERATED ALWAYS AS (record->>'status') STORED NOT NULL,
        expires_at text COLLATE "C" GENERATED ALWAYS AS (record->>'expiresAt') STORED,
        CHECK (record->>'id' = id), UNIQUE (id, backend_id))`
      await sql`CREATE INDEX IF NOT EXISTS tb_store_objects_owner_status_page ON tb_store_objects (owner, status, id)`
      await sql`CREATE INDEX IF NOT EXISTS tb_store_objects_expiry ON tb_store_objects (expires_at) WHERE expires_at IS NOT NULL`
      await sql`CREATE TABLE IF NOT EXISTS tb_store_uploads (
        id text COLLATE "C" PRIMARY KEY, record jsonb NOT NULL,
        revision bigint GENERATED ALWAYS AS ((record->>'revision')::bigint) STORED NOT NULL CHECK (revision > 0),
        object_id text GENERATED ALWAYS AS (record->>'objectId') STORED NOT NULL,
        backend_id text GENERATED ALWAYS AS (record->>'backendId') STORED NOT NULL REFERENCES tb_storage_backends(id),
        expires_at text COLLATE "C" GENERATED ALWAYS AS (record->>'expiresAt') STORED NOT NULL,
        CHECK (record->>'id' = id), FOREIGN KEY (object_id, backend_id) REFERENCES tb_store_objects(id, backend_id) ON DELETE CASCADE)`
      await sql`CREATE INDEX IF NOT EXISTS tb_store_uploads_expiry ON tb_store_uploads (expires_at, id)`
      await sql`CREATE TABLE IF NOT EXISTS tb_store_call_capabilities (
        id text COLLATE "C" PRIMARY KEY, record jsonb NOT NULL,
        revision bigint GENERATED ALWAYS AS ((record->>'revision')::bigint) STORED NOT NULL CHECK (revision > 0),
        expires_at text COLLATE "C" GENERATED ALWAYS AS (record->>'expiresAt') STORED NOT NULL, CHECK (record->>'id' = id))`
      await sql`CREATE INDEX IF NOT EXISTS tb_store_call_capability_expiry ON tb_store_call_capabilities (expires_at, id)`
      await sql`CREATE TABLE IF NOT EXISTS tb_store_call_reservations (
        capability_id text NOT NULL REFERENCES tb_store_call_capabilities(id) ON DELETE CASCADE,
        object_id text NOT NULL, max_bytes bigint NOT NULL CHECK (max_bytes > 0), PRIMARY KEY (capability_id, object_id))`
      await sql`CREATE TABLE IF NOT EXISTS tb_store_shares (
        id text COLLATE "C" PRIMARY KEY, record jsonb NOT NULL,
        revision bigint GENERATED ALWAYS AS ((record->>'revision')::bigint) STORED NOT NULL CHECK (revision > 0),
        object_id text GENERATED ALWAYS AS (record->>'objectId') STORED NOT NULL REFERENCES tb_store_objects(id) ON DELETE CASCADE,
        expires_at text COLLATE "C" GENERATED ALWAYS AS (record->>'expiresAt') STORED NOT NULL, CHECK (record->>'id' = id))`
      await sql`CREATE INDEX IF NOT EXISTS tb_store_shares_expiry ON tb_store_shares (expires_at, id)`
      await sql`CREATE TABLE IF NOT EXISTS tb_store_idempotency (
        id text COLLATE "C" PRIMARY KEY, record jsonb NOT NULL,
        revision bigint GENERATED ALWAYS AS ((record->>'revision')::bigint) STORED NOT NULL CHECK (revision > 0),
        expires_at text COLLATE "C" GENERATED ALWAYS AS (record->>'expiresAt') STORED NOT NULL)`
      await sql`CREATE INDEX IF NOT EXISTS tb_store_idempotency_expiry ON tb_store_idempotency (expires_at, id)`
    })
  }

  async beginUpload(candidate: BeginStoreUpload): Promise<{ object: StoreObject, session: UploadSession } | 'backend_changed'> {
    // The domain calculation adjusts a local candidate, never the caller's object.
    const input = structuredClone(candidate)
    const result = await this.sql.begin(async (sql) => {
      if (input.binding !== undefined) {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`tb:store:binding:${input.binding.id}`}, 0))`
        const bindings = await sql<{ record: StoreIdempotencyBinding }[]>`SELECT record FROM tb_store_idempotency WHERE id = ${input.binding.id}`
        const previous = bindings[0]?.record
        if (previous !== undefined) {
          assertUploadBinding(previous, input.binding.record, input.now)
          const rows = await sql<{ object: StoreObject, session: UploadSession }[]>`
            SELECT o.record AS object, u.record AS session FROM tb_store_objects o
            JOIN tb_store_uploads u ON u.object_id = o.id WHERE o.id = ${previous.objectId} AND u.id = ${previous.uploadId}`
          if (rows[0] === undefined) throw new TBError('internal', 'upload identity records missing')
          return rows[0]
        }
      }
      const active = await sql<{ backend_id: string }[]>`SELECT backend_id FROM tb_storage_active WHERE id = 1 FOR SHARE`
      if (active[0]?.backend_id !== input.object.backendId) return 'backend_changed' as const
      if (input.capability !== undefined) {
        const rows = await sql<{ record: CallUploadCapability }[]>`SELECT record FROM tb_store_call_capabilities WHERE id = ${input.capability.id} FOR UPDATE`
        if (rows[0] === undefined) throw new TBError('permission_denied', 'call upload capability 不存在')
        const next = reserveUploadQuota(input, rows[0].record)
        await sql`UPDATE tb_store_call_capabilities SET record = ${sql.json(next as never)} WHERE id = ${next.id}`
        await sql`INSERT INTO tb_store_call_reservations (capability_id, object_id, max_bytes)
          VALUES (${next.id}, ${input.object.id}, ${input.session.maxBytes})`
      }
      await sql`INSERT INTO tb_store_objects (id, record) VALUES (${input.object.id}, ${sql.json(input.object as never)})`
      await sql`INSERT INTO tb_store_uploads (id, record) VALUES (${input.session.id}, ${sql.json(input.session as never)})`
      if (input.binding !== undefined) await sql`INSERT INTO tb_store_idempotency (id, record) VALUES (${input.binding.id}, ${sql.json(input.binding.record as never)})`
      return { object: input.object, session: input.session }
    })
    return result as { object: StoreObject, session: UploadSession } | 'backend_changed'
  }

  async finishUpload(object: StoreObject, session: UploadSession): Promise<StoreObject | null> {
    const result = await this.sql.begin(async (sql) => {
      const rows = await sql<{ record: StoreObject }[]>`SELECT record FROM tb_store_objects WHERE id = ${object.id} FOR UPDATE`
      const current = rows[0]?.record
      if (current?.status === 'ready') return current
      if (current?.status !== 'pending' || current.revision !== object.revision - 1) return null
      const uploads = await sql`UPDATE tb_store_uploads SET record = ${sql.json(session as never)}
        WHERE id = ${session.id} AND object_id = ${object.id} AND revision = ${session.revision - 1} AND record->>'status' = 'created'`
      if (uploads.count === 0) return null
      await sql`UPDATE tb_store_objects SET record = ${sql.json(object as never)} WHERE id = ${object.id}`
      return object
    })
    return result as StoreObject | null
  }

  async terminateUpload(object: StoreObject, session: UploadSession): Promise<boolean> {
    return await this.sql.begin(async (sql) => {
      const rows = await sql`SELECT id FROM tb_store_objects WHERE id = ${object.id}
        AND revision = ${object.revision - 1} AND status <> 'ready' FOR UPDATE`
      if (rows.length === 0) return false
      const uploads = await sql`UPDATE tb_store_uploads SET record = ${sql.json(session as never)}
        WHERE id = ${session.id} AND object_id = ${object.id} AND revision = ${session.revision - 1} AND record->>'status' = 'created'`
      if (uploads.count === 0) return false
      await sql`UPDATE tb_store_objects SET record = ${sql.json(object as never)} WHERE id = ${object.id}`
      return true
    }) as boolean
  }

  async listReadyObjects(owner: string, opts: { cursor?: string, limit: number }): Promise<{ cursor?: string, items: StoreObject[] }> {
    const rows = await this.sql<{ id: string, record: StoreObject }[]>`SELECT id, record FROM tb_store_objects
      WHERE owner = ${owner} AND status = 'ready' AND id > ${opts.cursor ?? ''} ORDER BY id LIMIT ${opts.limit + 1}`
    const items = rows.slice(0, opts.limit).map(row => row.record)
    const last = items.at(-1)
    return { items, ...(rows.length > opts.limit && last !== undefined ? { cursor: last.id } : {}) }
  }
}
