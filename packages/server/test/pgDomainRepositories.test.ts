import {
  base64urlEncode, createEncryptionKeyring, DeviceMailboxService, MemoryObjectStore, SecretStoreImpl, type StoreBackendResolver,
  type StoreObject, StoreService,
} from '@tool-bridge/core'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import postgres, { type Sql } from 'postgres'
import { PgMailboxRepository } from '../src/pgMailboxRepository'
import { PgStoreRepository } from '../src/pgStoreRepository'
import { PgKeyRotation } from '../src/pgKeyRotation'
import { PgStateStore } from '../src/pgStateStore'

const databaseUrl = process.env.TB_TEST_DATABASE_URL
const suite = databaseUrl === undefined ? describe.skip : describe
const schema = `tb_domain_${process.pid}_${Date.now()}`
const tokenSecret = 'local-integration-store-token-secret'
const encryptionRoot = base64urlEncode(new Uint8Array(32).fill(17))
let admin: Sql
let sql: Sql
let storeRepository: PgStoreRepository
let mailboxRepository: PgMailboxRepository
let store: StoreService
let mailbox: DeviceMailboxService
let objectsA: MemoryObjectStore
let objectsB: MemoryObjectStore
let now: string
let resolver: StoreBackendResolver

suite('PostgreSQL domain authority (real connections)', () => {
  beforeAll(async () => {
    admin = postgres(databaseUrl as string, { onnotice: () => {} })
    await admin`CREATE SCHEMA ${admin(schema)}`
    sql = postgres(databaseUrl as string, { max: 12, onnotice: () => {}, connection: { search_path: schema, application_name: schema } })
    storeRepository = new PgStoreRepository(sql)
    mailboxRepository = new PgMailboxRepository(sql)
    await Promise.all([storeRepository.ensureSchema(), mailboxRepository.ensureSchema(), new PgStateStore(sql).ensureSchema()])
  })

  afterAll(async () => {
    await sql?.end({ timeout: 5 })
    if (admin !== undefined) {
      await admin`DROP SCHEMA ${admin(schema)} CASCADE`
      await admin.end({ timeout: 5 })
    }
  })

  beforeEach(async () => {
    await sql`TRUNCATE tb_kv, tb_store_objects, tb_store_uploads, tb_store_shares, tb_store_call_capabilities,
      tb_store_call_reservations, tb_store_idempotency, tb_device_operations, tb_storage_active, tb_storage_backends CASCADE`
    await sql`INSERT INTO tb_storage_backends (id, record) VALUES ('A', '{}'::jsonb), ('B', '{}'::jsonb)`
    await sql`INSERT INTO tb_storage_active (id, backend_id, revision) VALUES (1, 'A', 1)`
    now = '2026-09-05T00:00:00.000Z'
    objectsA = new MemoryObjectStore(() => now)
    objectsB = new MemoryObjectStore(() => now)
    resolver = {
      defaultBackend: async () => {
        const rows = await sql<{ backend_id: string }[]>`SELECT backend_id FROM tb_storage_active WHERE id = 1`
        const id = rows[0]?.backend_id
        if (id !== 'A' && id !== 'B') throw new Error('missing active backend')
        return { id, objects: id === 'A' ? objectsA : objectsB }
      },
      resolveBackend: async id => id === 'A' ? objectsA : objectsB,
    }
    store = new StoreService(storeRepository, resolver, { tokenSecret, now: () => now, maxObjectBytes: 100, uploadTtlSec: 60 })
    mailbox = new DeviceMailboxService(mailboxRepository, encryptionRoot, {
      now: () => Date.parse(now), maxPendingPerDevice: 2, leaseSeconds: 10,
    })
  })

  function enqueue(idempotencyKey?: string) {
    return mailbox.enqueue({ deviceId: 'camera', deviceKeyId: 'device-key', mountPath: 'device/camera',
      targetPath: 'device/camera/take', path: 'take', arguments: { location: 'private' },
      caller: { keyId: 'caller-key', owner: 'agent:owner' }, traceId: 'trace',
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }) })
  }

  it('concurrent same-key begin produces one object/session/binding and stable upload token', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => store.beginUpload(
      { contentType: 'text/plain', size: 3, idempotencyKey: 'one' }, { owner: 'agent:owner' })))
    expect(new Set(results.map(result => result.uploadId)).size).toBe(1)
    expect(new Set(results.map(result => result.uploadToken)).size).toBe(1)
    const objects = await sql`SELECT id FROM tb_store_objects`
    const uploads = await sql`SELECT id FROM tb_store_uploads`
    const bindings = await sql`SELECT id FROM tb_store_idempotency`
    expect([objects.length, uploads.length, bindings.length]).toEqual([1, 1, 1])
    await expect(store.beginUpload({ contentType: 'text/plain', size: 4, idempotencyKey: 'one' }, { owner: 'agent:owner' }))
      .rejects.toMatchObject({ code: 'conflict' })
  })

  it('quota and creation are atomic, and success/abort retain the existing cumulative reservation semantics', async () => {
    const capability = await store.issueCallUploadCapability({ owner: 'agent:owner', producer: 'device:camera', callId: 'call',
      expiresAt: '2026-09-05T00:10:00.000Z', maxObjects: 2, maxBytes: 6, maxObjectBytes: 3, allowedContentTypes: ['text/*'] })
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => store.beginCallUpload({ contentType: 'text/plain', size: 3 }, capability.token)))
    const accepted = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
    expect(accepted).toHaveLength(2)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(8)
    await store.commitRelayUpload({ uploadToken: accepted[0]!.uploadToken, body: 'abc' })
    await store.abortUploadWithToken(accepted[1]!.uploadId, accepted[1]!.uploadToken)
    await expect(store.beginCallUpload({ contentType: 'text/plain', size: 1 }, capability.token)).rejects.toMatchObject({ code: 'rate_limited' })
    const records = await sql<{ max_bytes: string }[]>`SELECT max_bytes FROM tb_store_call_reservations`
    expect(records).toHaveLength(2)
    expect((await store.verifyCallUploadCapability(capability.token)).reservedBytes).toBe(6)
  })

  it('SQL failure rolls back quota, object and idempotency, allowing the exact identity request to retry', async () => {
    await sql.unsafe(`CREATE FUNCTION fail_upload_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected upload failure';
END $$`)
    await sql.unsafe('CREATE TRIGGER fail_upload BEFORE INSERT ON tb_store_uploads FOR EACH ROW EXECUTE FUNCTION fail_upload_insert()')
    const capability = await store.issueCallUploadCapability({ owner: 'agent:owner', producer: 'device:camera', callId: 'call',
      expiresAt: '2026-09-05T00:10:00.000Z', maxObjects: 1, maxBytes: 3, maxObjectBytes: 3, allowedContentTypes: ['text/*'] })
    const input = { contentType: 'text/plain', size: 3, idempotencyKey: 'rollback' }
    await expect(store.beginCallUpload(input, capability.token)).rejects.toThrow('injected upload failure')
    expect((await sql`SELECT id FROM tb_store_objects`)).toHaveLength(0)
    expect((await sql`SELECT id FROM tb_store_idempotency`)).toHaveLength(0)
    expect((await store.verifyCallUploadCapability(capability.token)).reservedBytes).toBe(0)
    await sql.unsafe('DROP TRIGGER fail_upload ON tb_store_uploads')
    await sql.unsafe('DROP FUNCTION fail_upload_insert()')
    await expect(store.beginCallUpload(input, capability.token)).resolves.toMatchObject({ maxBytes: 3 })
  })

  it('backend switch binds new uploads to B while A completion/read/delete continue using A', async () => {
    const a = await store.beginUpload({ contentType: 'text/plain', size: 3, idempotencyKey: 'A' }, { owner: 'agent:owner' })
    await sql`UPDATE tb_storage_active SET backend_id = 'B', revision = revision + 1 WHERE id = 1`
    const b = await store.beginUpload({ contentType: 'text/plain', size: 3 }, { owner: 'agent:owner' })
    await Promise.all([store.commitRelayUpload({ uploadToken: a.uploadToken, body: 'aaa' }), store.commitRelayUpload({ uploadToken: b.uploadToken, body: 'bbb' })])
    const objectA = await store.authorizeRead(a.objectUri, { owner: 'agent:owner' })
    const objectB = await store.authorizeRead(b.objectUri, { owner: 'agent:owner' })
    expect([objectA.backendId, objectB.backendId]).toEqual(['A', 'B'])
    expect(await objectsA.head(objectA.driverKey)).not.toBeNull()
    expect(await objectsB.head(objectA.driverKey)).toBeNull()
    expect(await objectsB.head(objectB.driverKey)).not.toBeNull()
    await expect(sql`DELETE FROM tb_storage_backends WHERE id = 'A'`).rejects.toMatchObject({ code: '23503' })
    await store.delete(a.objectUri, { owner: 'agent:owner' })
    expect(await objectsA.head(objectA.driverKey)).toBeNull()
  })

  it('activation between default lookup and begin retries without binding a stale backend', async () => {
    let switchOnce = true
    const base = resolver.defaultBackend
    resolver.defaultBackend = async () => {
      const result = await base()
      if (switchOnce) {
        switchOnce = false
        await sql`UPDATE tb_storage_active SET backend_id = 'B', revision = 2 WHERE id = 1`
      }
      return result
    }
    const start = await store.beginUpload({ contentType: 'text/plain', size: 3 }, { owner: 'agent:owner' })
    const session = await store.verifyUploadToken(start.uploadToken)
    expect(session.backendId).toBe('B')
    expect((await sql`SELECT id FROM tb_store_objects`)).toHaveLength(1)
  })

  it('ready/session commit is atomic under competing complete and abort', async () => {
    const start = await store.beginUpload({ contentType: 'text/plain', size: 3 }, { owner: 'agent:owner' })
    const results = await Promise.allSettled([store.commitRelayUpload({ uploadToken: start.uploadToken, body: 'abc' }), store.abortUploadWithToken(start.uploadId, start.uploadToken)])
    expect(results.some(result => result.status === 'fulfilled')).toBe(true)
    const rows = await sql<{ object: StoreObject, session: { status: string } }[]>`SELECT o.record AS object, u.record AS session FROM tb_store_objects o JOIN tb_store_uploads u ON u.object_id = o.id`
    const row = rows[0]!
    expect(row.object.status === 'ready' ? row.session.status === 'completed' : row.session.status === 'aborted').toBe(true)
  })

  it('mailbox concurrent same-key enqueue is idempotent and distinct enqueue cannot exceed pending cap', async () => {
    const same = await Promise.all(Array.from({ length: 12 }, () => enqueue('same')))
    expect(new Set(same.map(row => row.operationId)).size).toBe(1)
    const distinct = await Promise.allSettled(Array.from({ length: 10 }, () => enqueue()))
    expect(distinct.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect((await sql`SELECT id FROM tb_device_operations`)).toHaveLength(2)
    const persisted = JSON.stringify(await sql`SELECT record FROM tb_device_operations`)
    expect(persisted).not.toContain('private')
  })

  it('two claimers get different operations and takeover rejects old lease and result_unknown is terminal/replayable', async () => {
    await Promise.all([enqueue(), enqueue()])
    const claimed = await Promise.all(Array.from({ length: 2 }, () => mailbox.claim({ deviceId: 'camera', deviceKeyId: 'device-key' })))
    const operations = claimed.flatMap(row => row.operation === undefined ? [] : [row.operation])
    expect(operations).toHaveLength(2)
    expect(new Set(operations.map(row => row.operationId)).size).toBe(2)
    expect((await mailbox.claim({ deviceId: 'camera', deviceKeyId: 'rotated-key' })).operation).toBeUndefined()
    const first = operations[0]!
    now = '2026-09-05T00:00:11.000Z'
    const taken = (await mailbox.claim({ deviceId: 'camera', deviceKeyId: 'device-key' })).operation!
    expect(taken.attempt).toBe(2)
    const old = operations.find(row => row.operationId === taken.operationId) ?? first
    await expect(mailbox.complete({ deviceId: 'camera', deviceKeyId: 'device-key', operationId: taken.operationId, leaseId: old.leaseId }, { outcome: 'succeeded', result: {} }))
      .rejects.toMatchObject({ code: 'conflict' })
    const lease = { deviceId: 'camera', deviceKeyId: 'device-key', operationId: taken.operationId, leaseId: taken.leaseId }
    const terminal = await Promise.all([mailbox.complete(lease, { outcome: 'result_unknown' }), mailbox.complete(lease, { outcome: 'result_unknown' })])
    expect(terminal.map(row => row.state)).toEqual(['result_unknown', 'result_unknown'])
    await expect(mailbox.complete(lease, { outcome: 'succeeded', result: { unexpected: true } })).rejects.toMatchObject({ code: 'conflict' })
    await expect(mailbox.renew({ ...lease, authorize: async () => {
      throw new Error('revoked')
    } })).rejects.toThrow()
  })

  it('settings replacement preserves an existing grant limit and idempotent identity', async () => {
    const input = { contentType: 'text/plain', size: 3, idempotencyKey: 'settings' }
    const start = await store.beginUpload(input, { owner: 'agent:owner' })
    const replacement = new StoreService(storeRepository, resolver, { tokenSecret, now: () => now, maxObjectBytes: 1, uploadTtlSec: 1 })
    expect((await replacement.beginUpload(input, { owner: 'agent:owner' })).uploadId).toBe(start.uploadId)
    await expect(replacement.commitRelayUpload({ uploadToken: start.uploadToken, body: 'abc' })).resolves.toMatchObject({ size: 3 })
  })

  it('durable key rotation resumes after interruption and decrypts secrets plus terminal mailbox data with only the new root', async () => {
    const oldRoot = base64urlEncode(new Uint8Array(32).fill(31))
    const newRoot = base64urlEncode(new Uint8Array(32).fill(47))
    const oldRing = createEncryptionKeyring(oldRoot, 'old')
    const rotated = { activeKeyId: 'new', keys: { old: oldRoot, new: newRoot } }
    const state = new PgStateStore(sql)
    const oldSecrets = new SecretStoreImpl(state, oldRing)
    for (const name of ['a', 'b', 'c']) await oldSecrets.set(name, `secret-${name}`, now)
    const oldMailbox = new DeviceMailboxService(mailboxRepository, oldRing, { now: () => Date.parse(now) })
    const operation = await oldMailbox.enqueue({ deviceId: 'camera', deviceKeyId: 'device-key', mountPath: 'device/camera',
      targetPath: 'device/camera/take', path: 'take', arguments: { sensitive: 'payload' },
      caller: { keyId: 'caller-key', owner: 'agent:owner' }, traceId: 'trace' })
    const claimed = (await oldMailbox.claim({ deviceId: 'camera', deviceKeyId: 'device-key' })).operation!
    await oldMailbox.complete({ deviceId: 'camera', deviceKeyId: 'device-key', operationId: operation.operationId, leaseId: claimed.leaseId },
      { outcome: 'succeeded', result: { value: 'preserved-result' } })
    const makeRotation = () => new PgKeyRotation(sql, new SecretStoreImpl(state, rotated),
      new DeviceMailboxService(mailboxRepository, rotated, { now: () => Date.parse(now) }), 'new')
    let worker = makeRotation()
    await worker.ensureSchema()
    let progress = await worker.start()
    progress = await worker.runBatch(progress.id, 1)
    expect(progress.changed).toBe(1)
    expect(progress.cursor).not.toBeNull()
    // A fresh worker reads its authority from PG after a process interruption.
    worker = makeRotation()
    while (progress.phase === 'secrets') progress = await worker.runBatch(progress.id, 1)
    await sql.unsafe(`CREATE FUNCTION fail_reencrypt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected reencrypt failure'; END $$`)
    await sql.unsafe('CREATE TRIGGER fail_reencrypt BEFORE UPDATE ON tb_device_operations FOR EACH ROW EXECUTE FUNCTION fail_reencrypt()')
    await expect(worker.runBatch(progress.id, 1)).rejects.toThrow('injected reencrypt failure')
    expect((await worker.get(progress.id)).status).toBe('failed')
    await sql.unsafe('DROP TRIGGER fail_reencrypt ON tb_device_operations')
    await sql.unsafe('DROP FUNCTION fail_reencrypt()')
    worker = makeRotation()
    for (let attempt = 0; attempt < 10 && progress.status !== 'completed'; attempt++) progress = await worker.runBatch(progress.id, 1)
    expect(progress.status).toBe('completed')
    expect(await worker.encryptionReferences('old')).toBe(0)
    const onlyNew = createEncryptionKeyring(newRoot, 'new')
    expect(await new SecretStoreImpl(state, onlyNew).resolve('a')).toBe('secret-a')
    const newMailbox = new DeviceMailboxService(mailboxRepository, onlyNew, { now: () => Date.parse(now) })
    expect((await newMailbox.get('camera', operation.operationId)).result).toEqual({ value: 'preserved-result' })
    expect(JSON.stringify(await sql`SELECT * FROM tb_key_rotation_jobs`)).not.toContain(newRoot)
  })

  it('signing rotation preserves old upload tokens/replay and independently revokes old shares', async () => {
    const old = await store.beginUpload({ contentType: 'text/plain', size: 3, idempotencyKey: 'old-signing' }, { owner: 'agent:owner' })
    const rotated = new StoreService(storeRepository, resolver, { tokenKeyring: {
      activeKeyId: 'k2', keys: { k1: tokenSecret, k2: 'new-independent-signing-root' },
    }, now: () => now })
    expect((await rotated.beginUpload({ contentType: 'text/plain', size: 3, idempotencyKey: 'old-signing' }, { owner: 'agent:owner' })).uploadToken).toBe(old.uploadToken)
    await rotated.commitRelayUpload({ uploadToken: old.uploadToken, body: 'abc' })
    const share = await store.share(old.objectUri, 'agent:owner')
    expect((await rotated.verifyShareToken(share.token)).signingKeyId).toBe('k1')
    await rotated.revokeShare(share.shareId, 'agent:owner')
    await expect(rotated.verifyShareToken(share.token)).rejects.toMatchObject({ code: 'permission_denied' })
    const fresh = await rotated.beginUpload({ contentType: 'text/plain' }, { owner: 'agent:owner' })
    expect((await rotated.verifyUploadToken(fresh.uploadToken)).signingKeyId).toBe('k2')
  })

  it('S3 I/O holds no database transaction or active-backend lock', async () => {
    let release!: () => void
    const paused = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered!: () => void
    const reached = new Promise<void>((resolve) => {
      entered = resolve
    })
    const put = objectsA.put.bind(objectsA)
    objectsA.put = async (...args) => {
      entered()
      await paused
      return put(...args)
    }
    const start = await store.beginUpload({ contentType: 'text/plain', size: 3 }, { owner: 'agent:owner' })
    const pending = store.commitRelayUpload({ uploadToken: start.uploadToken, body: 'abc' })
    const settled = pending.catch(() => {})
    await reached
    try {
      const locks = await sql<{ count: number }[]>`SELECT count(*)::integer AS count FROM pg_stat_activity
        WHERE datname = current_database() AND application_name = ${schema} AND state = 'idle in transaction'`
      expect(locks[0]?.count).toBe(0)
      await sql`UPDATE tb_storage_active SET backend_id = 'B', revision = 2 WHERE id = 1`
    } finally {
      release()
      await settled
    }
    await expect(pending).resolves.toMatchObject({ status: 'ready' })
  })
})
