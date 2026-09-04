import type { Sql } from 'postgres'
import { assertMailboxIdentity, type DeviceOperationRecord, type MailboxQuery, type MailboxRepository, TBError } from '@tool-bridge/core'

/** Indexed operation ledger;
encrypted payload/result stay opaque to persistence. */
export class PgMailboxRepository implements MailboxRepository {
  constructor(private readonly sql: Sql) {}

  async ensureSchema(): Promise<void> {
    await this.sql.begin(async (sql) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended('tb:mailbox:schema:v1', 0))`
      await sql`CREATE TABLE IF NOT EXISTS tb_device_operations (
        id text COLLATE "C" PRIMARY KEY, record jsonb NOT NULL,
        revision bigint GENERATED ALWAYS AS ((record->>'revision')::bigint) STORED NOT NULL CHECK (revision > 0),
        device_id text GENERATED ALWAYS AS (record->>'deviceId') STORED NOT NULL,
        device_key_id text GENERATED ALWAYS AS (record->>'deviceKeyId') STORED NOT NULL,
        state text GENERATED ALWAYS AS (record->>'state') STORED NOT NULL,
        expires_at text COLLATE "C" GENERATED ALWAYS AS (record->>'expiresAt') STORED NOT NULL,
        lease_until text COLLATE "C" GENERATED ALWAYS AS (record->>'leaseUntil') STORED,
        terminal_at text COLLATE "C" GENERATED ALWAYS AS (record->>'terminalAt') STORED,
        CHECK (record->>'operationId' = id))`
      await sql`CREATE INDEX IF NOT EXISTS tb_device_operations_device_page ON tb_device_operations (device_id, id)`
      await sql`CREATE INDEX IF NOT EXISTS tb_device_operations_pending ON tb_device_operations (device_id, expires_at)
        WHERE state IN ('queued', 'claimed')`
      await sql`CREATE INDEX IF NOT EXISTS tb_device_operations_claim ON tb_device_operations (device_id, device_key_id, state, lease_until, id)
        WHERE state IN ('queued', 'claimed')`
      await sql`CREATE INDEX IF NOT EXISTS tb_device_operations_expiry ON tb_device_operations (expires_at, id) WHERE state IN ('queued', 'claimed')`
      await sql`CREATE INDEX IF NOT EXISTS tb_device_operations_retention ON tb_device_operations (terminal_at, id) WHERE terminal_at IS NOT NULL`
    })
  }

  async get(id: string): Promise<DeviceOperationRecord | null> {
    const rows = await this.sql<{ record: DeviceOperationRecord }[]>`SELECT record FROM tb_device_operations WHERE id = ${id}`
    return rows[0]?.record ?? null
  }

  async list(query: MailboxQuery): Promise<{ cursor?: string, items: Array<{ key: string, value: DeviceOperationRecord }> }> {
    const rows = await this.sql<{ id: string, record: DeviceOperationRecord }[]>`SELECT id, record FROM tb_device_operations
      WHERE id > ${query.cursor ?? ''}
      ${query.deviceId === undefined ? this.sql`` : this.sql`AND device_id = ${query.deviceId}`}
      ${query.states === undefined ? this.sql`` : this.sql`AND state = ANY(${this.sql.array(query.states)})`}
      ${query.claimableBy === undefined
        ? this.sql``
        : this.sql`AND device_key_id = ${query.claimableBy}
        AND expires_at > ${query.now ?? ''} AND (state = 'queued' OR (state = 'claimed' AND lease_until <= ${query.now ?? ''}))`}
      ORDER BY id LIMIT ${query.limit + 1}`
    const items = rows.slice(0, query.limit).map(row => ({ key: row.id, value: row.record }))
    const last = items.at(-1)
    return { items, ...(rows.length > query.limit && last !== undefined ? { cursor: last.key } : {}) }
  }

  async compare(id: string, revision: number, next: DeviceOperationRecord | null): Promise<boolean> {
    if (!Number.isSafeInteger(revision) || revision < 1 || (next !== null && next.revision !== revision + 1)) return false
    const rows = next === null
      ? await this.sql`DELETE FROM tb_device_operations WHERE id = ${id} AND revision = ${revision}`
      : await this.sql`UPDATE tb_device_operations SET record = ${this.sql.json(next as never)}
          WHERE id = ${id} AND revision = ${revision} AND device_id = ${next.deviceId} AND device_key_id = ${next.deviceKeyId}`
    return rows.count > 0
  }

  async enqueue(record: DeviceOperationRecord, maxPending: number, now: string): Promise<DeviceOperationRecord> {
    return await this.sql.begin(async (sql) => {
      // Candidate uniqueness alone cannot protect a per-device count against two enqueues.
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`tb:mailbox:enqueue:${record.deviceId}`}, 0))`
      const previous = await sql<{ record: DeviceOperationRecord }[]>`SELECT record FROM tb_device_operations WHERE id = ${record.operationId}`
      if (previous[0] !== undefined) {
        assertMailboxIdentity(previous[0].record, record)
        return previous[0].record
      }
      const pending = await sql<{ count: number }[]>`SELECT count(*)::integer AS count FROM tb_device_operations
        WHERE device_id = ${record.deviceId} AND state IN ('queued', 'claimed') AND expires_at > ${now}`
      if ((pending[0]?.count ?? 0) >= maxPending) throw new TBError('rate_limited', 'device mailbox pending limit reached', { retryable: true })
      await sql`INSERT INTO tb_device_operations (id, record) VALUES (${record.operationId}, ${sql.json(record as never)})`
      return record
    }) as DeviceOperationRecord
  }

  async claimNext(record: DeviceOperationRecord, revision: number, now: string): Promise<boolean> {
    // Candidate authorization ran outside the transaction. Recheck the exact immutable identity,
    // revision and eligibility in the single conditional update that creates the lease.
    const rows = await this.sql`UPDATE tb_device_operations SET record = ${this.sql.json(record as never)}
      WHERE id = ${record.operationId} AND revision = ${revision}
      AND device_id = ${record.deviceId} AND device_key_id = ${record.deviceKeyId}
      AND expires_at > ${now} AND (state = 'queued' OR (state = 'claimed' AND lease_until <= ${now}))`
    return rows.count > 0
  }

  async renew(record: DeviceOperationRecord, revision: number, now: string): Promise<boolean> {
    return this.writeUnderLease(record, revision, now)
  }

  async complete(record: DeviceOperationRecord, revision: number, now: string): Promise<boolean> {
    return this.writeUnderLease(record, revision, now)
  }

  private async writeUnderLease(record: DeviceOperationRecord, revision: number, now: string): Promise<boolean> {
    const rows = await this.sql`UPDATE tb_device_operations SET record = ${this.sql.json(record as never)}
      WHERE id = ${record.operationId} AND revision = ${revision} AND state = 'claimed'
      AND device_id = ${record.deviceId} AND device_key_id = ${record.deviceKeyId}
      AND record->>'leaseId' = ${record.leaseId ?? ''} AND lease_until > ${now} AND expires_at > ${now}`
    return rows.count > 0
  }
}
