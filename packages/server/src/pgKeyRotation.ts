import type { Sql } from 'postgres'
import { type DeviceMailboxService, type SecretStoreImpl, TBError } from '@tool-bridge/core'
import { randomUUID } from 'node:crypto'

export interface KeyRotationJob {
  changed: number
  cursor: string | null
  error: string | null
  id: string
  phase: 'secrets' | 'mailbox' | 'verify'
  status: 'running' | 'failed' | 'completed'
  targetKeyId: string
}
interface JobRow {
  changed: number
  cursor: string | null
  error: string | null
  id: string
  phase: KeyRotationJob['phase']
  status: KeyRotationJob['status']
  target_key_id: string
}
function job(row: JobRow): KeyRotationJob {
  return { id: row.id, targetKeyId: row.target_key_id, phase: row.phase, cursor: row.cursor,
    status: row.status, changed: row.changed, error: row.error }
}

/** Database holds progress only. Keyring material is injected from the protected host secret file. */
export class PgKeyRotation {
  constructor(
    private readonly sql: Sql,
    private readonly secrets: SecretStoreImpl,
    private readonly mailbox: DeviceMailboxService,
    private readonly activeKeyId: string,
  ) {}

  async ensureSchema(): Promise<void> {
    await this.sql.begin(async (sql) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended('tb:key-rotation:schema:v1', 0))`
      await sql`CREATE TABLE IF NOT EXISTS tb_key_rotation_jobs (
      id text PRIMARY KEY, target_key_id text NOT NULL UNIQUE,
      phase text NOT NULL CHECK (phase IN ('secrets', 'mailbox', 'verify')),
      cursor text, status text NOT NULL CHECK (status IN ('running', 'failed', 'completed')),
      changed integer NOT NULL DEFAULT 0, error text, lease_id text, lease_until timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now())`
    })
  }

  async start(targetKeyId = this.activeKeyId): Promise<KeyRotationJob> {
    if (targetKeyId !== this.activeKeyId) throw new TBError('conflict', 'rotation target is not the active encryption key')
    const rows = await this.sql<JobRow[]>`INSERT INTO tb_key_rotation_jobs (id, target_key_id, phase, status)
      VALUES (${randomUUID()}, ${targetKeyId}, 'secrets', 'running')
      ON CONFLICT (target_key_id) DO UPDATE SET target_key_id = excluded.target_key_id RETURNING *`
    return job(rows[0]!)
  }

  async get(id: string): Promise<KeyRotationJob> {
    const rows = await this.sql<JobRow[]>`SELECT * FROM tb_key_rotation_jobs WHERE id = ${id}`
    if (rows[0] === undefined) throw TBError.notFound('key rotation job not found')
    return job(rows[0])
  }

  async runBatch(id: string, limit = 100): Promise<KeyRotationJob> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new TBError('invalid_argument', 'rotation batch limit must be between 1 and 200')
    const current = await this.get(id)
    if (current.targetKeyId !== this.activeKeyId) throw new TBError('conflict', 'rotation target is not the active encryption key')
    if (current.status === 'completed') return current
    const leaseId = randomUUID()
    const acquired = await this.sql<JobRow[]>`UPDATE tb_key_rotation_jobs
      SET lease_id = ${leaseId}, lease_until = now() + interval '60 seconds', status = 'running', error = NULL
      WHERE id = ${id} AND (lease_until IS NULL OR lease_until <= now()) AND status <> 'completed' RETURNING *`
    if (acquired[0] === undefined) throw new TBError('conflict', 'key rotation batch is already running')
    let next = job(acquired[0])
    try {
      if (next.phase === 'verify') {
        const remaining = await this.countOtherEncryptionReferences(next.targetKeyId)
        next = { ...next, status: remaining === 0 ? 'completed' : 'running', phase: remaining === 0 ? 'verify' : 'secrets', cursor: null }
      } else {
        const options = { limit, ...(next.cursor === null ? {} : { cursor: next.cursor }) }
        const page = next.phase === 'secrets' ? await this.secrets.reencryptPage(options) : await this.mailbox.reencryptPage(options)
        next = { ...next, changed: next.changed + page.changed, cursor: page.cursor ?? null,
          phase: page.cursor !== undefined ? next.phase : next.phase === 'secrets' ? 'mailbox' : 'verify' }
      }
      const rows = await this.sql`UPDATE tb_key_rotation_jobs SET phase = ${next.phase}, cursor = ${next.cursor},
        status = ${next.status}, changed = ${next.changed}, lease_id = NULL, lease_until = NULL, updated_at = now()
        WHERE id = ${id} AND lease_id = ${leaseId}`
      if (rows.count === 0) throw new TBError('conflict', 'key rotation batch lease changed')
      return next
    } catch (error) {
      // Never persist crypto/provider exception strings: they may contain user data or secrets.
      await this.sql`UPDATE tb_key_rotation_jobs SET status = 'failed', error = 're-encryption batch failed',
        lease_id = NULL, lease_until = NULL, updated_at = now() WHERE id = ${id} AND lease_id = ${leaseId}`
      throw error
    }
  }

  async encryptionReferences(keyId: string): Promise<number> {
    const rows = await this.sql<{ count: number }[]>`SELECT (
      (SELECT count(*) FROM tb_kv WHERE key >= 'secret:' AND key < 'secret;' AND value->>'keyId' = ${keyId}) +
      (SELECT count(*) FROM tb_device_operations WHERE record->'payload'->>'keyId' = ${keyId} OR record->'terminalData'->>'keyId' = ${keyId})
    )::integer AS count`
    return rows[0]?.count ?? 0
  }

  async signingReferences(keyId: string, now: string): Promise<number> {
    const rows = await this.sql<{ count: number }[]>`SELECT (
      (SELECT count(*) FROM tb_store_uploads WHERE record->>'signingKeyId' = ${keyId} AND record->>'revokedAt' IS NULL AND expires_at > ${now}) +
      (SELECT count(*) FROM tb_store_shares WHERE record->>'signingKeyId' = ${keyId} AND record->>'status' = 'active' AND expires_at > ${now}) +
      (SELECT count(*) FROM tb_store_call_capabilities WHERE record->>'signingKeyId' = ${keyId} AND record->>'status' IN ('active', 'exhausted') AND expires_at > ${now})
    )::integer AS count`
    return rows[0]?.count ?? 0
  }

  async countOtherEncryptionReferences(targetKeyId: string): Promise<number> {
    const rows = await this.sql<{ count: number }[]>`SELECT (
      (SELECT count(*) FROM tb_kv WHERE key >= 'secret:' AND key < 'secret;' AND COALESCE(value->>'keyId', '') <> ${targetKeyId}) +
      (SELECT count(*) FROM tb_device_operations WHERE COALESCE(record->'payload'->>'keyId', '') <> ${targetKeyId}
        OR (record->'terminalData' IS NOT NULL AND COALESCE(record->'terminalData'->>'keyId', '') <> ${targetKeyId}))
    )::integer AS count`
    return rows[0]?.count ?? 0
  }
}
