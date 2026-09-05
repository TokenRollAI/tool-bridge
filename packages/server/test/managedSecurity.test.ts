import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { runtimeConfigSchema, SecretStoreImpl } from '@tool-bridge/core'
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises'
import postgres, { type Sql } from 'postgres'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testS3Config, testServerConfig } from './helpers/server'
import { PgStoreRepository } from '../src/pgStoreRepository'
import { BootstrapStateStore } from '../src/bootstrapState'
import { createManagedServer } from '../src/managedServer'
import { StorageManager } from '../src/storageManager'
import { ConfigManager } from '../src/configManager'
import { PgStateStore } from '../src/pgStateStore'

const databaseUrl = process.env.TB_TEST_DATABASE_URL
const suite = databaseUrl === undefined ? describe.skip : describe
const schema = `tb_managed_security_${process.pid}_${Date.now()}`
let admin: Sql
let sql: Sql

suite('managed configuration concurrency and failure truth (real PG)', () => {
  beforeAll(async () => {
    admin = postgres(databaseUrl as string, { onnotice: () => {} })
    await admin`CREATE SCHEMA ${admin(schema)}`
    sql = postgres(databaseUrl as string, { max: 8, onnotice: () => {}, connection: { search_path: schema, application_name: schema } })
    await new ConfigManager(sql, async () => {}).ensureSchema()
  })
  beforeEach(async () => {
    await sql`TRUNCATE tb_runtime_config`
  })
  afterAll(async () => {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  })

  it('failed runtime reconstruction restores the previous effective value and reports failed', async () => {
    let live = 0
    const manager = new ConfigManager(sql, async (settings) => {
      live = settings.maxHops
      if (settings.maxHops === 8) throw new Error('private connection value must not be exposed')
    })
    await manager.ensureSchema()
    await manager.sync()
    await manager.update({ expectedRevision: 1, settings: runtimeConfigSchema.parse({ maxHops: 8 }) })
    await expect(manager.apply({ expectedRevision: 2 })).rejects.toMatchObject({ code: 'unavailable' })
    expect(live).toBe(4)
    const status = await manager.get()
    expect(status).toMatchObject({ state: 'failed', appliedRevision: 1, revision: 2, effective: { maxHops: 4 }, desired: { maxHops: 8 } })
    expect(JSON.stringify(status)).not.toContain('private connection value')
    const [row] = await sql<{ applied_revision: string, effective: { maxHops: number } }[]>`SELECT applied_revision, effective FROM tb_runtime_config`
    expect(Number(row?.applied_revision)).toBe(1)
    expect(row?.effective.maxHops).toBe(4)
  })

  it('concurrent administrators cannot overwrite the same expected revision', async () => {
    const manager = new ConfigManager(sql, async () => {})
    await manager.ensureSchema()
    await manager.sync()
    const results = await Promise.allSettled([6, 8].map(maxHops => manager.update({ expectedRevision: 1, settings: runtimeConfigSchema.parse({ maxHops }) })))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect((await manager.get()).revision).toBe(2)
  })

  it('replicas serialize apply without holding a database transaction while callbacks wait', async () => {
    let enter!: () => void
    let release!: () => void
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = new ConfigManager(sql, async (settings) => {
      if (settings.maxHops === 8) {
        enter()
        await barrier
      }
    })
    let secondLive = 0
    const second = new ConfigManager(sql, async (settings) => {
      secondLive = settings.maxHops
    })
    await first.ensureSchema()
    await Promise.all([first.sync(), second.sync()])
    await first.update({ expectedRevision: 1, settings: runtimeConfigSchema.parse({ maxHops: 8 }) })
    const applying = first.apply({ expectedRevision: 2 })
    await entered
    try {
      expect((await second.get()).state).toBe('applying')
      await expect(second.apply({ expectedRevision: 2 })).rejects.toMatchObject({ code: 'conflict' })
      const [row] = await sql<{ count: number }[]>`SELECT count(*)::integer AS count FROM pg_stat_activity
        WHERE datname=current_database() AND application_name=${schema} AND state='idle in transaction'`
      expect(row?.count).toBe(0)
    } finally {
      release()
      await applying.catch(() => {})
    }
    await applying
    expect((await second.get()).state).toBe('pending')
    await second.sync()
    expect(secondLive).toBe(8)
    expect((await second.get()).state).toBe('applied')
  })

  it('a delayed old sync cannot overwrite a newer configuration on the same replica', async () => {
    let enter!: () => void
    let release!: () => void
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    let slowLive = 0
    const slow = new ConfigManager(sql, async (settings) => {
      if (settings.maxHops === 4) {
        enter()
        await barrier
      }
      slowLive = settings.maxHops
    })
    const publisher = new ConfigManager(sql, async () => {})
    await publisher.ensureSchema()
    await publisher.sync()
    const oldSync = slow.sync()
    await entered
    await publisher.update({ expectedRevision: 1, settings: runtimeConfigSchema.parse({ maxHops: 8 }) })
    await publisher.apply({ expectedRevision: 2 })
    const newSync = slow.sync()
    release()
    await Promise.all([oldSync, newSync])
    expect(slowLive).toBe(8)
    expect(await slow.get()).toMatchObject({ appliedRevision: 2, effective: { maxHops: 8 }, state: 'applied' })
  })

  it('a Context reference atomically prevents deleting its backend, including concurrent registration', async () => {
    const state = new PgStateStore(sql)
    await state.ensureSchema()
    await new PgStoreRepository(sql).ensureSchema()
    await state.ensureContextReferencesSchema()
    const storage = new StorageManager(sql, new SecretStoreImpl(state, undefined))
    const context = (id: string) => ({ config: { kind: 'context', provider: 'storage', providerConfig: { backendId: id } } })
    const insertBackend = async (id: string) => {
      await sql`INSERT INTO tb_storage_backends(id,record) VALUES(${id},${sql.json({ id, revision: 1 } as never)})`
    }
    await insertBackend('pinned')
    await state.put('node:context/pinned', context('pinned'))
    await expect(storage.delete({ id: 'pinned', expectedRevision: 1 })).rejects.toMatchObject({ code: 'conflict' })
    await state.delete('node:context/pinned')
    await expect(storage.delete({ id: 'pinned', expectedRevision: 1 })).resolves.toEqual({ ok: true })
    for (let i = 0; i < 8; i++) {
      const id = `concurrent-${i}`
      const key = `node:context/${id}`
      await insertBackend(id)
      await Promise.allSettled([state.put(key, context(id)), storage.delete({ id, expectedRevision: 1 })])
      const persisted = await state.get(key)
      const backend = await sql`SELECT id FROM tb_storage_backends WHERE id=${id}`
      expect(persisted !== null && backend.length === 0).toBe(false)
    }
    storage.close()
  })
})

describe('bootstrap interrupted-write safety', () => {
  it('reports local lock contention as a domain conflict without entering the operation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tb-bootstrap-lock-'))
    try {
      const holder = new BootstrapStateStore(directory)
      const contender = new BootstrapStateStore(directory)
      let entered = false
      await holder.exclusive(async () => {
        await expect(contender.exclusive(async () => {
          entered = true
        })).rejects.toMatchObject({ code: 'conflict', message: 'another local maintenance operation is running' })
      })
      expect(entered).toBe(false)
      await expect(contender.exclusive(async () => 'acquired')).resolves.toBe('acquired')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it.each(['identity.json', 'keys.json'])('local recovery preserves identity and existing keys after %s acknowledgement is lost', async (failedFile) => {
    const directory = await mkdtemp(join(tmpdir(), 'tb-bootstrap-crash-'))
    class FailAfterWrite extends BootstrapStateStore {
      override async write(name: string, value: unknown): Promise<void> {
        await super.write(name, value)
        if (name === failedFile) throw new Error('injected crash')
      }
    }
    try {
      await expect(new FailAfterWrite(directory).initialize()).rejects.toThrow('injected crash')
      const recovery = new BootstrapStateStore(directory)
      const identity = await recovery.read<{ instanceId: string }>('identity.json')
      const previousKeys = await recovery.read('keys.json')
      await expect(recovery.initialize()).rejects.toMatchObject({ code: 'unavailable' })
      const token = await recovery.createLocalPairing('recovery')
      expect((await recovery.authorize(token, 'recovery')).instanceId).toBe(identity?.instanceId)
      if (previousKeys !== undefined) expect(await recovery.read('keys.json')).toEqual(previousKeys)
      else expect(await recovery.read('keys.json')).toBeDefined()
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('initialized marker closes setup even when the final bootstrap write fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tb-bootstrap-marker-'))
    class FailFinalState extends BootstrapStateStore {
      override async write(name: string, value: unknown): Promise<void> {
        if (name === 'bootstrap.json' && (value as { phase?: string }).phase === 'initialized') throw new Error('injected final write crash')
        await super.write(name, value)
      }
    }
    try {
      const store = new FailFinalState(directory)
      const state = await store.initialize()
      const oldToken = (await readFile(join(directory, 'pairing-token'), 'utf8')).trim()
      await expect(store.finish(state)).rejects.toThrow('injected final write crash')
      const recovery = new BootstrapStateStore(directory)
      expect((await recovery.initialize()).phase).toBe('initialized')
      await expect(recovery.authorize(oldToken, 'setup')).rejects.toMatchObject({ code: 'permission_denied' })
      await expect(recovery.createLocalPairing('setup')).rejects.toMatchObject({ code: 'permission_denied' })
      const recoveryToken = await recovery.createLocalPairing('recovery')
      expect((await recovery.authorize(recoveryToken, 'recovery')).phase).toBe('initialized')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('recovery refuses an empty database after initialized marker persistence interrupts installing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tb-bootstrap-recovery-empty-'))
    let server: Awaited<ReturnType<typeof createManagedServer>> | undefined
    let target: Sql | undefined
    try {
      const store = new BootstrapStateStore(directory)
      const initial = await store.initialize()
      const config = await testServerConfig({ dataDir: directory })
      await store.write('bootstrap.json', { ...initial, phase: 'installing' })
      await store.write('initialized.json', { instanceId: initial.instanceId })
      await store.write('install-defaults.json', { storage: testS3Config() })
      const keysBefore = await store.read('keys.json')
      const token = await store.createLocalPairing('recovery')
      server = await createManagedServer({ directory, host: '127.0.0.1', port: 0 })
      const base = `http://127.0.0.1:${(await server.start()).port}`
      const response = await fetch(base + '/~setup/recover', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tb-setup-token': token },
        body: JSON.stringify({ databaseUrl: config.databaseUrl }),
      })
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ code: 'conflict', message: 'initialized instance cannot attach an empty database' })
      target = postgres(config.databaseUrl, { max: 1, onnotice: () => {} })
      const [identity] = await target<{ table_name: string | null }[]>`SELECT to_regclass('tb_instance')::text AS table_name`
      expect(identity?.table_name).toBeNull()
      expect(await store.read('keys.json')).toEqual(keysBefore)
      expect(await store.state()).toEqual({ ...initial, phase: 'installing' })
      expect((await fetch(base + '/readyz')).status).toBe(503)
    } finally {
      await server?.close()
      await target?.end({ timeout: 1 })
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('initialized recovery never manufactures replacement roots after key/state loss', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tb-bootstrap-key-loss-'))
    try {
      const store = new BootstrapStateStore(directory)
      const state = await store.initialize()
      await store.finish(state)
      await unlink(join(directory, 'bootstrap.json'))
      await unlink(join(directory, 'keys.json'))
      const token = await store.createLocalPairing('recovery')
      expect((await store.authorize(token, 'recovery')).phase).toBe('initialized')
      expect(await store.read('keys.json')).toBeUndefined()
      await expect(store.createLocalPairing('setup')).rejects.toMatchObject({ code: 'permission_denied' })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
