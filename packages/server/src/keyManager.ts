import {
  DeviceMailboxService, type KeyBackup, type KeyManagement, type KeyStatus,
  SecretStoreImpl, TBError, validateEncryptionKeyring, validateStoreTokenKeyring,
} from '@tool-bridge/core'
import { randomBytes, randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import type { BootstrapSecrets } from './bootstrapState'
import { ensureRuntimeCoordinationSchema } from './pgMaintenanceFence'
import { type KeyRotationJob, PgKeyRotation } from './pgKeyRotation'
import { PgMailboxRepository } from './pgMailboxRepository'
import { PgStateStore } from './pgStateStore'

export interface KeyManagementSnapshot {
  databaseUrl: string
  instanceId: string
  replicaId: string
  revision: number
}
export interface KeyManagementHooks {
  exclusive<T>(run: () => Promise<T>): Promise<T>
  quiesce(): Promise<{ resume(): Promise<void> }>
  readKeys(): Promise<BootstrapSecrets>
  readSnapshot(): Promise<KeyManagementSnapshot>
  /** Reload the stopped local runtime from the persisted bootstrap keys. */
  reload(): Promise<void>
  /** Atomically persist the key file and advance bootstrap revision. */
  writeKeys(keys: BootstrapSecrets): Promise<number>
}
interface KeyManagerOptions {
  /** Injection is only for isolated local-PG integration schemas. */
  connect?: (databaseUrl: string) => Sql
  now?: () => Date
}

const SIGNING_RETENTION_MS = 604800000

/** Admin-only key lifecycle. The business pool may be closed during every mutation. */
export class KeyManager implements KeyManagement {
  private readonly now: () => Date
  private readonly connect: (url: string) => Sql
  constructor(private readonly hooks: KeyManagementHooks, options: KeyManagerOptions = {}) {
    this.now = options.now ?? (() => new Date())
    this.connect = options.connect ?? (url => postgres(url, { max: 3, connect_timeout: 5, onnotice: () => {} }))
  }

  private async ensure(sql: Sql): Promise<void> {
    await ensureRuntimeCoordinationSchema(sql)
  }

  private rotation(sql: Sql, keys: BootstrapSecrets): PgKeyRotation {
    return new PgKeyRotation(sql, new SecretStoreImpl(new PgStateStore(sql), keys.keyring),
      new DeviceMailboxService(new PgMailboxRepository(sql), keys.keyring), keys.keyring.activeKeyId)
  }

  async status(): Promise<KeyStatus> {
    // Status repairs a missing rotation job, so its snapshot and repair must
    // serialize with key-file writes just like explicit key mutations.
    return this.hooks.exclusive(() => this.statusUnderLock())
  }

  private async statusUnderLock(): Promise<KeyStatus> {
    const snapshot = await this.hooks.readSnapshot()
    const keys = await this.hooks.readKeys()
    const sql = this.connect(snapshot.databaseUrl)
    try {
      await this.ensure(sql)
      const rotation = this.rotation(sql, keys)
      await rotation.ensureSchema()
      // A crash after key-file commit but before job creation is recovered from the active root.
      if (await rotation.countOtherEncryptionReferences(keys.keyring.activeKeyId) > 0) await rotation.start()
      const jobs = await sql<Array<{
        changed: number
        error: string | null
        id: string
        phase: KeyRotationJob['phase']
        status: KeyRotationJob['status']
        target_key_id: string
      }>>`SELECT id,target_key_id,phase,status,changed,error FROM tb_key_rotation_jobs ORDER BY updated_at DESC`
      return {
        revision: snapshot.revision, instanceId: snapshot.instanceId,
        encryption: { activeKeyId: keys.keyring.activeKeyId, keys: await Promise.all(Object.keys(keys.keyring.keys).map(async keyId => ({
          keyId, active: keyId === keys.keyring.activeKeyId, references: await rotation.encryptionReferences(keyId),
        }))) },
        signing: { activeKeyId: keys.storeTokenKeyring.activeKeyId, keys: await Promise.all(Object.keys(keys.storeTokenKeyring.keys).map(async keyId => ({
          keyId, active: keyId === keys.storeTokenKeyring.activeKeyId, references: await rotation.signingReferences(keyId, this.now().toISOString()),
          ...(keys.signingRetireAfter?.[keyId] === undefined ? {} : { retireAfter: keys.signingRetireAfter[keyId] }),
        }))) },
        jobs: jobs.map(row => ({ id: row.id, targetKeyId: row.target_key_id, phase: row.phase, status: row.status,
          changed: row.changed, ...(row.error === null ? {} : { error: row.error }) })),
      }
    } finally { await sql.end({ timeout: 5 }) }
  }

  private async mutate(
    expectedRevision: number | undefined,
    operation: (sql: Sql, keys: BootstrapSecrets, snapshot: KeyManagementSnapshot) => Promise<string | undefined>,
  ): Promise<KeyStatus> {
    const jobId = await this.hooks.exclusive(async () => {
      const snapshot = await this.hooks.readSnapshot()
      if (expectedRevision !== undefined && snapshot.revision !== expectedRevision) throw new TBError('conflict', 'bootstrap revision changed; reload first')
      const keys = await this.hooks.readKeys()
      const sql = this.connect(snapshot.databaseUrl)
      let quiet: { resume(): Promise<void> } | undefined
      let heartbeat: ReturnType<typeof setInterval> | undefined
      let renewal: Promise<void> = Promise.resolve()
      try {
        await this.ensure(sql)
        await sql.begin(async (tx) => {
          // Server replica registration uses this same lock and refuses a foreign active fence.
          await tx`SELECT pg_advisory_xact_lock(7283022)`
          // Expiry is failure detection, not evidence that old requests drained.
          const others = await tx`SELECT replica_id FROM tb_runtime_replicas
            WHERE instance_id=${snapshot.instanceId} AND replica_id<>${snapshot.replicaId}`
          if (others.length > 0) throw new TBError('conflict', 'key maintenance requires stopping all other replicas')
          const [fence] = await tx<{ owner_replica_id: string, purpose: string }[]>`SELECT owner_replica_id,purpose FROM tb_runtime_maintenance WHERE id=1 AND expires_at>now()`
          if (fence && (fence.purpose === 'database' || fence.owner_replica_id !== snapshot.replicaId)) throw new TBError('conflict', 'another instance maintenance operation is running')
          await tx`INSERT INTO tb_runtime_maintenance(id,owner_replica_id,expires_at,purpose,phase,operation_id)
            VALUES(1,${snapshot.replicaId},now()+interval '90 seconds','keys','active',NULL)
            ON CONFLICT(id) DO UPDATE SET owner_replica_id=excluded.owner_replica_id,expires_at=excluded.expires_at,
              purpose=excluded.purpose,phase=excluded.phase,operation_id=excluded.operation_id`
        })
        heartbeat = setInterval(() => {
          renewal = renewal.then(async () => {
            await sql`UPDATE tb_runtime_maintenance SET expires_at=now()+interval '90 seconds'
              WHERE id=1 AND owner_replica_id=${snapshot.replicaId} AND purpose='keys'`
          })
          // Surface failure at the next boundary; do not create an unhandled rejection.
          void renewal.catch(() => {})
        }, 20000)
        heartbeat.unref()
        quiet = await this.hooks.quiesce()
        await renewal
        const result = await operation(sql, keys, snapshot)
        await renewal
        await this.hooks.reload()
        return result
      } finally {
        if (heartbeat !== undefined) clearInterval(heartbeat)
        try {
          await renewal
        } finally {
          await sql`DELETE FROM tb_runtime_maintenance WHERE id=1 AND owner_replica_id=${snapshot.replicaId} AND purpose='keys'`.catch(() => {})
          await sql.end({ timeout: 5 })
          await quiet?.resume()
        }
      }
    })
    return { ...await this.status(), ...(jobId === undefined ? {} : { jobId }) }
  }

  async rotate(input: Parameters<KeyManagement['rotate']>[0]): Promise<KeyStatus> {
    if (input.target === 'encryption' && input.revokeExisting) throw new TBError('invalid_argument', 'encryption roots must remain until re-encryption is complete')
    return this.mutate(input.expectedRevision, async (sql, keys) => {
      const id = `k_${randomUUID().replaceAll('-', '')}`
      const root = randomBytes(32).toString('base64url')
      if (input.target === 'encryption') {
        const previousRotation = this.rotation(sql, keys)
        await previousRotation.ensureSchema()
        const pending = await sql`SELECT id FROM tb_key_rotation_jobs WHERE status<>'completed' LIMIT 1`
        if (pending.length > 0) throw new TBError('conflict', 'finish the active re-encryption job before rotating again')
        keys.keyring = validateEncryptionKeyring({ activeKeyId: id, keys: { ...keys.keyring.keys, [id]: root } })
        await this.hooks.writeKeys(keys)
        const rotation = this.rotation(sql, keys)
        await rotation.ensureSchema()
        const job = await rotation.start()
        await rotation.runBatch(job.id)
        return job.id
      }
      const previousIds = Object.keys(keys.storeTokenKeyring.keys)
      keys.storeTokenKeyring = validateStoreTokenKeyring({ activeKeyId: id, keys: { ...keys.storeTokenKeyring.keys, [id]: root } })
      keys.signingRetireAfter = { ...keys.signingRetireAfter }
      const retireAfter = new Date(this.now().getTime() + SIGNING_RETENTION_MS).toISOString()
      for (const oldId of previousIds) keys.signingRetireAfter[oldId] = retireAfter
      // Persist the new root before revocation; a process interruption can only retain extra keys.
      await this.hooks.writeKeys(keys)
      if (input.revokeExisting) {
        await this.revokeSigning(sql, previousIds)
        keys.storeTokenKeyring.keys = { [id]: root }
        keys.signingRetireAfter = {}
        await this.hooks.writeKeys(keys)
      }
      return undefined
    })
  }

  async resume(input: Parameters<KeyManagement['resume']>[0]): Promise<KeyStatus> {
    return this.mutate(undefined, async (sql, keys) => {
      const rotation = this.rotation(sql, keys)
      await rotation.ensureSchema()
      await rotation.runBatch(input.jobId)
      return input.jobId
    })
  }

  async retire(input: Parameters<KeyManagement['retire']>[0]): Promise<KeyStatus> {
    return this.mutate(input.expectedRevision, async (sql, keys) => {
      const ring = input.target === 'encryption' ? keys.keyring : keys.storeTokenKeyring
      if (input.keyId === ring.activeKeyId) throw new TBError('conflict', 'the active key cannot be retired')
      if (!Object.hasOwn(ring.keys, input.keyId)) throw TBError.notFound('key not found')
      const rotation = this.rotation(sql, keys)
      if (input.target === 'encryption') {
        if (await rotation.encryptionReferences(input.keyId) > 0) throw new TBError('conflict', 'encrypted records still reference this key')
      } else {
        const retireAfter = keys.signingRetireAfter?.[input.keyId]
        if (retireAfter === undefined || !Number.isFinite(Date.parse(retireAfter)) || Date.parse(retireAfter) > this.now().getTime()
          || await rotation.signingReferences(input.keyId, this.now().toISOString()) > 0) {
          throw new TBError('conflict', 'signing capabilities or their revocation window still reference this key')
        }
      }
      delete ring.keys[input.keyId]
      if (input.target === 'signing' && keys.signingRetireAfter) delete keys.signingRetireAfter[input.keyId]
      await this.hooks.writeKeys(keys)
      return undefined
    })
  }

  private async revokeSigning(sql: Sql, keyIds: string[]): Promise<void> {
    const now = this.now().toISOString()
    await sql.begin(async (tx) => {
      await tx`UPDATE tb_store_objects SET record=record || jsonb_build_object('status','abandoned','updatedAt',${now}::text,'revision',revision+1)
        WHERE status='pending' AND id IN (SELECT object_id FROM tb_store_uploads WHERE record->>'signingKeyId'=ANY(${tx.array(keyIds)}))`
      await tx`UPDATE tb_store_uploads SET record=record || jsonb_build_object('revokedAt',${now}::text,'revision',revision+1)
        || CASE WHEN record->>'status'='created' THEN jsonb_build_object('status','aborted','terminalAt',${now}::text) ELSE '{}'::jsonb END
        WHERE record->>'signingKeyId'=ANY(${tx.array(keyIds)})`
      for (const table of ['tb_store_shares', 'tb_store_call_capabilities']) {
        await tx`UPDATE ${tx(table)} SET record=record || jsonb_build_object('status','revoked','terminalAt',${now}::text,'revision',revision+1)
          WHERE record->>'signingKeyId'=ANY(${tx.array(keyIds)}) AND record->>'status' IN ('active','exhausted')`
      }
    })
  }

  async backup(): Promise<KeyBackup> {
    return this.hooks.exclusive(async () => {
      const snapshot = await this.hooks.readSnapshot()
      const keys = await this.hooks.readKeys()
      return { version: 1, instanceId: snapshot.instanceId, exportedAt: this.now().toISOString(),
        keyring: keys.keyring, storeTokenKeyring: keys.storeTokenKeyring, oauthKey: keys.oauthKey,
        ...(keys.signingRetireAfter === undefined ? {} : { signingRetireAfter: keys.signingRetireAfter }) }
    })
  }
}
