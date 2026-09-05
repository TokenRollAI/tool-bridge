import {
  base64urlEncode, createEncryptionKeyring, DeviceMailboxService, MemoryObjectStore,
  SecretStoreImpl, StoreService,
} from '@tool-bridge/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres, { type Sql } from 'postgres'
import { randomUUID } from 'node:crypto'
import type { BootstrapSecrets } from '../src/bootstrapState'
import { type KeyManagementHooks, KeyManager } from '../src/keyManager'
import { PgMailboxRepository } from '../src/pgMailboxRepository'
import { PgStoreRepository } from '../src/pgStoreRepository'
import { PgStateStore } from '../src/pgStateStore'

const databaseUrl = process.env.TB_TEST_DATABASE_URL
const suite = databaseUrl === undefined ? describe.skip : describe
let admin: Sql
const cleanups: Array<() => Promise<void>> = []

suite('administrator key lifecycle (real PG)', () => {
  beforeAll(() => {
    admin = postgres(databaseUrl as string, { onnotice: () => {} })
  })
  afterAll(async () => {
    for (const cleanup of cleanups) await cleanup()
    await admin.end({ timeout: 5 })
  })

  async function fixture() {
    const schema = `tb_keys_${randomUUID().replaceAll('-', '')}`
    await admin`CREATE SCHEMA ${admin(schema)}`
    const connect = (url: string) => postgres(url, { max: 5, onnotice: () => {}, connection: { search_path: schema } })
    const sql = connect(databaseUrl as string)
    cleanups.push(async () => {
      await sql.end({ timeout: 5 })
      await admin`DROP SCHEMA ${admin(schema)} CASCADE`
    })
    const state = new PgStateStore(sql)
    const storeRepository = new PgStoreRepository(sql)
    const mailboxRepository = new PgMailboxRepository(sql)
    await Promise.all([state.ensureSchema(), storeRepository.ensureSchema(), mailboxRepository.ensureSchema()])
    await sql`INSERT INTO tb_storage_backends(id,record) VALUES('objects','{}'::jsonb)`
    await sql`INSERT INTO tb_storage_active(id,backend_id,revision) VALUES(1,'objects',1)`
    const encryptionRoot = base64urlEncode(new Uint8Array(32).fill(21))
    const signingRoot = base64urlEncode(new Uint8Array(32).fill(31))
    let keys: BootstrapSecrets = { keyring: createEncryptionKeyring(encryptionRoot),
      storeTokenKeyring: { activeKeyId: 's1', keys: { s1: signingRoot } }, oauthKey: 'independent-oauth-root', adminSk: 'DO-NOT-BACKUP-ADMIN' }
    let revision = 1
    let now = new Date('2026-09-05T00:00:00.000Z')
    let paused = false
    let reloads = 0
    let lockHeld = false
    let exclusiveTail = Promise.resolve()
    const instanceId = randomUUID()
    const replicaId = randomUUID()
    const hooks: KeyManagementHooks = {
      readSnapshot: async () => ({ databaseUrl: databaseUrl as string, instanceId, replicaId, revision }),
      exclusive: async (run) => {
        const previous = exclusiveTail
        let release!: () => void
        exclusiveTail = new Promise<void>((resolve) => {
          release = resolve
        })
        await previous
        lockHeld = true
        try {
          return await run()
        } finally {
          lockHeld = false
          release()
        }
      },
      quiesce: async () => {
        paused = true
        return { resume: async () => {
          paused = false
        } }
      },
      readKeys: async () => structuredClone(keys),
      writeKeys: async (next) => {
        keys = structuredClone(next)
        return ++revision
      },
      reload: async () => {
        reloads++
      },
    }
    const manager = new KeyManager(hooks, { connect, now: () => now })
    const objects = new MemoryObjectStore(() => now.toISOString())
    const resolver = { defaultBackend: async () => ({ id: 'objects', objects }), resolveBackend: async () => objects }
    return { manager, hooks, sql, state, storeRepository, mailboxRepository, instanceId, replicaId,
      keys: () => keys, revision: () => revision, paused: () => paused, reloads: () => reloads, lockHeld: () => lockHeld,
      advance: (milliseconds: number) => {
        now = new Date(now.getTime() + milliseconds)
      },
      store: () => new StoreService(storeRepository, resolver, { tokenKeyring: keys.storeTokenKeyring, now: () => now.toISOString() }),
      secret: () => new SecretStoreImpl(state, keys.keyring),
      mailbox: () => new DeviceMailboxService(mailboxRepository, keys.keyring, { now: () => now.getTime() }) }
  }

  it('rotates, resumes and retires an encryption root only after both durable domains are re-encrypted', async () => {
    const f = await fixture()
    await f.secret().set('upstream', 'encrypted-private-value', '2026-09-05T00:00:00.000Z')
    const mailbox = f.mailbox()
    const op = await mailbox.enqueue({ deviceId: 'device', deviceKeyId: 'key', mountPath: 'device/a', targetPath: 'device/a/run',
      path: 'run', arguments: { private: 'argument' }, caller: { keyId: 'caller', owner: 'agent:owner' }, traceId: 'trace' })
    const claimed = (await mailbox.claim({ deviceId: 'device', deviceKeyId: 'key' })).operation!
    await mailbox.complete({ deviceId: 'device', deviceKeyId: 'key', operationId: op.operationId, leaseId: claimed.leaseId },
      { outcome: 'succeeded', result: { private: 'result' } })
    let status = await f.manager.rotate({ expectedRevision: 1, target: 'encryption' })
    expect(status.jobId).toBeDefined()
    expect(status.encryption.activeKeyId).not.toBe('k1')
    expect(JSON.stringify(status)).not.toContain('encrypted-private-value')
    await expect(f.manager.retire({ expectedRevision: f.revision(), target: 'encryption', keyId: 'k1' }))
      .rejects.toMatchObject({ code: 'conflict' })
    const jobId = status.jobId!
    for (let i = 0; i < 5 && status.jobs.find(row => row.id === jobId)?.status !== 'completed'; i++) status = await f.manager.resume({ jobId })
    expect(status.jobs.find(row => row.id === jobId)?.status).toBe('completed')
    await f.manager.retire({ expectedRevision: f.revision(), target: 'encryption', keyId: 'k1' })
    expect(f.keys().keyring.keys.k1).toBeUndefined()
    expect(await f.secret().resolve('upstream')).toBe('encrypted-private-value')
    expect((await f.mailbox().get('device', op.operationId)).result).toEqual({ private: 'result' })
    expect(f.paused()).toBe(false)
    expect(f.reloads()).toBeGreaterThan(0)
  })

  it('preserves old signed grants for seven days and rejects retirement before the window', async () => {
    const f = await fixture()
    const old = await f.store().beginUpload({ contentType: 'text/plain', size: 3, idempotencyKey: 'old' }, { owner: 'agent:owner' })
    const status = await f.manager.rotate({ expectedRevision: 1, target: 'signing' })
    expect(status.signing.activeKeyId).not.toBe('s1')
    expect((await f.store().verifyUploadToken(old.uploadToken)).signingKeyId).toBe('s1')
    await expect(f.manager.retire({ expectedRevision: f.revision(), target: 'signing', keyId: 's1' })).rejects.toMatchObject({ code: 'conflict' })
    f.advance(8 * 86400000)
    await f.manager.retire({ expectedRevision: f.revision(), target: 'signing', keyId: 's1' })
    expect(f.keys().storeTokenKeyring.keys.s1).toBeUndefined()
  })

  it('a concurrent status snapshot cannot recover a backwards job during the first encryption rotation', async () => {
    const f = await fixture()
    await f.secret().set('upstream', 'preserved-secret', '2026-09-05T00:00:00.000Z')
    const readKeys = f.hooks.readKeys
    let firstRead = true
    let rotating: Promise<void> | undefined
    f.hooks.readKeys = async () => {
      const snapshot = await readKeys()
      if (firstRead) {
        firstRead = false
        // Schedule rotation at the exact snapshot boundary. When status owns the
        // bootstrap lock it queues; an unlocked read permits it to finish first.
        rotating = (async () => {
          let rotated = await f.manager.rotate({ expectedRevision: 1, target: 'encryption' })
          const jobId = rotated.jobId!
          for (let i = 0; i < 5 && rotated.jobs.find(row => row.id === jobId)?.status !== 'completed'; i++) {
            rotated = await f.manager.resume({ jobId })
          }
          expect(rotated.jobs.find(row => row.id === jobId)?.status).toBe('completed')
        })()
        if (!f.lockHeld()) await rotating
      }
      return snapshot
    }
    await f.manager.status()
    await rotating
    const jobs = await f.sql<{ status: string, target_key_id: string }[]>`SELECT target_key_id,status FROM tb_key_rotation_jobs`
    expect(jobs).toEqual([{ target_key_id: f.keys().keyring.activeKeyId, status: 'completed' }])
    expect(await f.secret().resolve('upstream')).toBe('preserved-secret')
    await expect(f.manager.rotate({ expectedRevision: f.revision(), target: 'encryption' })).resolves.toHaveProperty('jobId')
  })

  it('status still recovers a job when the active root was persisted before job creation', async () => {
    const f = await fixture()
    await f.secret().set('upstream', 'preserved-secret', '2026-09-05T00:00:00.000Z')
    const keys = await f.hooks.readKeys()
    keys.keyring = { activeKeyId: 'recovered', keys: { ...keys.keyring.keys, recovered: base64urlEncode(new Uint8Array(32).fill(41)) } }
    await f.hooks.exclusive(() => f.hooks.writeKeys(keys))
    let status = await f.manager.status()
    expect(status.jobs).toMatchObject([{ targetKeyId: 'recovered', status: 'running' }])
    const jobId = status.jobs[0]!.id
    for (let i = 0; i < 5 && status.jobs[0]?.status !== 'completed'; i++) status = await f.manager.resume({ jobId })
    expect(status.jobs[0]?.status).toBe('completed')
    expect(await f.secret().resolve('upstream')).toBe('preserved-secret')
  })

  it('explicit revoke invalidates pending/completed grants and even a late old-runtime grant', async () => {
    const f = await fixture()
    const oldRuntime = f.store()
    const pending = await oldRuntime.beginUpload({ contentType: 'text/plain', size: 3 }, { owner: 'agent:owner' })
    const ready = await oldRuntime.beginUpload({ contentType: 'text/plain', size: 3 }, { owner: 'agent:owner' })
    await oldRuntime.commitRelayUpload({ uploadToken: ready.uploadToken, body: 'abc' })
    const share = await oldRuntime.share(ready.objectUri, 'agent:owner')
    await f.manager.rotate({ expectedRevision: 1, target: 'signing', revokeExisting: true })
    for (const token of [pending.uploadToken, ready.uploadToken]) await expect(f.store().verifyUploadToken(token)).rejects.toMatchObject({ code: 'permission_denied' })
    await expect(f.store().verifyShareToken(share.token)).rejects.toMatchObject({ code: 'permission_denied' })
    const late = await oldRuntime.beginUpload({ contentType: 'text/plain', size: 3 }, { owner: 'agent:owner' })
    await expect(f.store().verifyUploadToken(late.uploadToken)).rejects.toMatchObject({ code: 'permission_denied' })
    expect(f.keys().storeTokenKeyring.keys.s1).toBeUndefined()
  })

  it.each([60, -60])('refuses an undrained replica whose lease expires in %s seconds and rejects stale revisions', async (expiresInSec) => {
    const f = await fixture()
    await f.manager.status()
    const keysBefore = structuredClone(f.keys())
    // The registry row alone must block mutation: this fixture holds no runtime session lock.
    await f.sql`INSERT INTO tb_runtime_replicas(replica_id,instance_id,expires_at) VALUES('other',${f.instanceId},now()+${expiresInSec}::integer*interval '1 second')`
    await expect(f.manager.rotate({ expectedRevision: 1, target: 'encryption' })).rejects.toMatchObject({ code: 'conflict' })
    expect(f.revision()).toBe(1)
    expect(f.keys()).toEqual(keysBefore)
    expect(f.paused()).toBe(false)
    expect((await f.sql`SELECT id FROM tb_runtime_maintenance`)).toHaveLength(0)
    expect((await f.sql`SELECT replica_id FROM tb_runtime_replicas`)).toEqual([{ replica_id: 'other' }])
    await expect(f.manager.rotate({ expectedRevision: 0, target: 'signing' })).rejects.toMatchObject({ code: 'conflict' })
  })

  it('exports an explicit instance-bound backup without the administrator credential', async () => {
    const f = await fixture()
    const backup = await f.manager.backup()
    expect(backup).toMatchObject({ version: 1, instanceId: f.instanceId, keyring: f.keys().keyring })
    expect(JSON.stringify(backup)).not.toContain('DO-NOT-BACKUP-ADMIN')
    expect(JSON.stringify(await f.manager.status())).not.toContain(f.keys().keyring.keys.k1)
  })

  it.each(['copying', 'retired', 'discarded'])('key mutation preserves a same-owner database %s fence', async (phase) => {
    const f = await fixture()
    await f.manager.status()
    await f.sql`INSERT INTO tb_runtime_maintenance(id,owner_replica_id,expires_at,purpose,phase,operation_id)
      VALUES(1,${f.replicaId},'infinity','database',${phase},'migration')`
    await expect(f.manager.rotate({ expectedRevision: 1, target: 'encryption' })).rejects.toMatchObject({ code: 'conflict' })
    expect(f.revision()).toBe(1)
    expect(f.paused()).toBe(false)
    expect(await f.sql`SELECT purpose,phase,operation_id FROM tb_runtime_maintenance`)
      .toEqual([{ purpose: 'database', phase, operation_id: 'migration' }])
  })
})
