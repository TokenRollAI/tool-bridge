import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import postgres, { type ISql, type Sql } from 'postgres'
import { randomUUID } from 'node:crypto'
import {
  acquireDatabaseMigrationFence,
  acquireRedisSwitchFence,
  acquireRuntimeLease,
  assertRuntimeAuthority,
  ensureRuntimeCoordinationSchema,
  RuntimeHandoffPendingError,
} from '../src/pgMaintenanceFence'

const database = process.env.TB_TEST_DATABASE_URL
if (!database) throw new Error('Maintenance fence tests require the isolated PG fixture')
const administrator = postgres(database, { max: 2, onnotice: () => {} })
const fixtures: Array<{ schema: string, sql: Sql }> = []

async function fixture() {
  const schema = `fence_${randomUUID().replaceAll('-', '')}`
  await administrator`CREATE SCHEMA ${administrator(schema)}`
  const sql = postgres(database!, { max: 4, connection: { search_path: schema }, onnotice: () => {} })
  fixtures.push({ schema, sql })
  await ensureRuntimeCoordinationSchema(sql)
  return { sql, instanceId: randomUUID() }
}

function runtimeLocks(sql: Sql) {
  return sql<{ mode: string, pid: number }[]>`SELECT pid, mode FROM pg_catalog.pg_locks,
    (SELECT hashtextextended(current_schema() || ':tool-bridge-runtime',7283023) AS key) AS runtime
    WHERE locktype='advisory' AND granted AND objsubid=1
      AND database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
      AND classid=((key >> 32) & 4294967295)::oid AND objid=(key & 4294967295)::oid`
}

// The session-level admission query shipped by server v0.24.
async function tryLegacyLock(session: ISql) {
  const [result] = await session`SELECT pg_try_advisory_lock_shared(
    hashtextextended(current_schema() || ':tool-bridge-runtime',7283023)) AS acquired`
  return result!.acquired
}

afterEach(async () => {
  for (const entry of fixtures.splice(0)) {
    await entry.sql.end({ timeout: 1 })
    await administrator`DROP SCHEMA ${administrator(entry.schema)} CASCADE`
  }
})
afterAll(async () => {
  await administrator.end({ timeout: 1 })
})

describe('PostgreSQL runtime and migration fencing', () => {
  it('notifies on session death before a heartbeat and admits exactly one successor with the old row still fresh', async () => {
    const { sql, instanceId } = await fixture()
    const onLost = vi.fn()
    const owner = await acquireRuntimeLease(sql, { instanceId, replicaId: 'previous', onLost })
    try {
      const [lock] = await runtimeLocks(sql)
      expect(lock?.mode).toBe('ExclusiveLock')
      await administrator`SELECT pg_terminate_backend(${lock!.pid}, 5000)`
      await vi.waitFor(() => expect(onLost).toHaveBeenCalledOnce(), { timeout: 5000 })
      const results = await Promise.allSettled(['next-a', 'next-b'].map(replicaId =>
        acquireRuntimeLease(sql, { instanceId, replicaId }).then(lease => ({ lease, replicaId })),
      ))
      try {
        expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected'])
        const winner = results.find(result => result.status === 'fulfilled')!.value
        expect(results.find(result => result.status === 'rejected')!.reason).toBeInstanceOf(RuntimeHandoffPendingError)
        const successors = await runtimeLocks(sql)
        expect(successors).toEqual([{ pid: expect.any(Number), mode: 'ExclusiveLock' }])
        expect(successors[0]!.pid).not.toBe(lock!.pid)
        await winner.lease.heartbeat()
        await expect(owner.heartbeat()).rejects.toMatchObject({ code: 'unavailable' })
        const [previous] = await sql`SELECT expires_at > now() AS fresh FROM tb_runtime_replicas WHERE replica_id='previous'`
        expect(previous?.fresh).toBe(true)

        const maintenance = { instanceId, replicaId: winner.replicaId, operationId: randomUUID() }
        await expect(acquireDatabaseMigrationFence(sql, maintenance)).rejects.toThrow('offline recovery')
        await expect(acquireRedisSwitchFence(sql, maintenance)).rejects.toThrow('offline recovery')
        await Promise.all([owner.release(), owner.release()])
        await winner.lease.heartbeat()
        expect(await sql`SELECT replica_id FROM tb_runtime_replicas`).toEqual([{ replica_id: winner.replicaId }])
        expect(onLost).toHaveBeenCalledOnce()
      } finally {
        for (const result of results) if (result.status === 'fulfilled') await result.value.lease.release()
      }
    } finally {
      await owner.release()
    }
    expect(await runtimeLocks(sql)).toHaveLength(0)
  })

  it('excludes v0.24 in both rolling upgrade directions and retries without stacking locks', async () => {
    const { sql, instanceId } = await fixture()
    const legacy = await sql.reserve()
    const input = { instanceId, replicaId: 'new', onLost: vi.fn() }
    try {
      expect(await tryLegacyLock(legacy)).toBe(true)
      for (let attempt = 0; attempt < 3; attempt++)
        await expect(acquireRuntimeLease(sql, input)).rejects.toBeInstanceOf(RuntimeHandoffPendingError)
      expect(await sql`SELECT 1 FROM tb_runtime_replicas`).toHaveLength(0)
      await legacy`INSERT INTO tb_runtime_replicas(replica_id,instance_id,expires_at)
        VALUES('legacy',${instanceId},now()+interval '60 seconds')`
      await legacy`SELECT pg_advisory_unlock_all()`
      await expect(acquireRuntimeLease(sql, input)).rejects.toBeInstanceOf(RuntimeHandoffPendingError)
      expect(await runtimeLocks(sql)).toHaveLength(0)
      await legacy`UPDATE tb_runtime_replicas SET expires_at=now()-interval '1 second' WHERE replica_id='legacy'`
      const runtime = await acquireRuntimeLease(sql, input)
      try {
        expect(await sql`SELECT 1 FROM tb_runtime_replicas WHERE replica_id='legacy' AND NOT session_fenced`).toHaveLength(1)
        await sql`UPDATE tb_runtime_replicas SET expires_at=now()-interval '1 day' WHERE replica_id=${input.replicaId}`
        await expect(acquireRuntimeLease(sql, { instanceId, replicaId: 'contender' }))
          .rejects.toMatchObject({ name: 'RuntimeHandoffPendingError', retryable: true })
        expect(await tryLegacyLock(legacy)).toBe(false)
        await expect(acquireRuntimeLease(sql, { instanceId, replicaId: 'redis', redisUrl: 'redis://fixture' }))
          .rejects.toMatchObject({ code: 'conflict' })
        // A different bootstrap ID in this schema passes the router check, but
        // its shared lock must still conflict with the single-instance owner.
        await expect(acquireRuntimeLease(sql, { instanceId: randomUUID(), replicaId: 'redis', redisUrl: 'redis://fixture' }))
          .rejects.toMatchObject({ code: 'unavailable' })
        await runtime.heartbeat()
        await runtime.heartbeat()
        expect(await runtimeLocks(sql)).toEqual([{ pid: expect.any(Number), mode: 'ExclusiveLock' }])
      } finally {
        await runtime.release()
      }
      expect(await tryLegacyLock(legacy)).toBe(true)
      expect(input.onLost).not.toHaveBeenCalled()
    } finally {
      await legacy`SELECT pg_advisory_unlock_all()`
      legacy.release()
    }
  })

  it('keeps Redis peers shared and releases the lock of a failed registration', async () => {
    const { sql, instanceId } = await fixture()
    const input = { instanceId, replicaId: 'redis-a', redisUrl: 'redis://fixture' }
    const a = await acquireRuntimeLease(sql, input)
    try {
      await expect(acquireRuntimeLease(sql, input)).rejects.toThrow('already registered')
      const b = await acquireRuntimeLease(sql, { ...input, replicaId: 'redis-b' })
      try {
        expect((await runtimeLocks(sql)).map(row => row.mode)).toEqual(['ShareLock', 'ShareLock'])
        await expect(acquireRuntimeLease(sql, { instanceId: randomUUID(), replicaId: 'exclusive-contender' }))
          .rejects.toBeInstanceOf(RuntimeHandoffPendingError)
        await Promise.all([a.heartbeat(), b.heartbeat()])
        await expect(acquireRuntimeLease(sql, { ...input, replicaId: 'wrong-router', redisUrl: 'redis://other' }))
          .rejects.toMatchObject({ code: 'conflict' })
      } finally {
        await b.release()
      }
    } finally {
      await a.release()
    }
    expect(await runtimeLocks(sql)).toHaveLength(0)
  })

  it('rejects other advisory locks on the original live backend and rolls back its heartbeat', async () => {
    const { sql, instanceId } = await fixture()
    const onLost = vi.fn()
    const runtime = await acquireRuntimeLease(sql, { instanceId, replicaId: 'wrong-lock', onLost })
    try {
      await sql`UPDATE tb_runtime_replicas SET expires_at='epoch'`
      // Keep the TCP session alive while replacing its real lock with near misses,
      // including the two-int key that has exactly the same pg_locks classid/objid.
      await sql`CREATE FUNCTION swap_runtime_lock() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE k bigint := hashtextextended(current_schema() || ':tool-bridge-runtime',7283023);
        BEGIN
          PERFORM pg_advisory_unlock(k);
          PERFORM pg_advisory_lock(k # 1::bigint);
          PERFORM pg_advisory_lock(k # (1::bigint << 32));
          PERFORM pg_advisory_lock((k >> 32)::integer, k::bit(32)::integer);
          RETURN NEW;
        END $$`
      await sql`CREATE TRIGGER swap_lock AFTER UPDATE ON tb_runtime_replicas FOR EACH ROW EXECUTE FUNCTION swap_runtime_lock()`
      await expect(runtime.heartbeat()).rejects.toMatchObject({ code: 'unavailable' })
      await expect(runtime.heartbeat()).rejects.toMatchObject({ code: 'unavailable' })
      expect(onLost).toHaveBeenCalledOnce()
      expect(await sql`SELECT 1 FROM tb_runtime_replicas WHERE expires_at='epoch'`).toHaveLength(1)
      expect(await runtimeLocks(sql)).toHaveLength(0)
    } finally {
      await runtime.release()
    }
  })

  it('keeps maintenance contention distinct from handoff and lets a failed drain retry', async () => {
    const { sql, instanceId } = await fixture()
    const input = { instanceId, replicaId: 'maintenance-owner' }
    const runtime = await acquireRuntimeLease(sql, input)
    const migration = await acquireDatabaseMigrationFence(sql, { ...input, operationId: randomUUID() })
    try {
      await expect(migration.drain()).rejects.toMatchObject({ code: 'conflict' })
      await expect(migration.drain()).rejects.toMatchObject({ code: 'conflict' })
      await runtime.release()
      await migration.drain()
      for (const replicaId of [input.replicaId, 'standby'])
        await expect(acquireRuntimeLease(sql, { instanceId, replicaId })).rejects.toMatchObject({ code: 'unavailable', retryable: false })
      expect(await runtimeLocks(sql)).toEqual([{ pid: expect.any(Number), mode: 'ExclusiveLock' }])
    } finally {
      await runtime.release()
      await migration.releaseLock()
      await migration.rollback()
    }
    expect(await runtimeLocks(sql)).toHaveLength(0)
  })

  it('serializes replica admission and migration acquisition so both cannot succeed', async () => {
    const { sql, instanceId } = await fixture()
    const [runtime, migration] = await Promise.allSettled([
      acquireRuntimeLease(sql, { instanceId, replicaId: 'joining-replica', redisUrl: 'redis://fixture' }),
      acquireDatabaseMigrationFence(sql, { instanceId, replicaId: 'maintenance-owner', operationId: randomUUID() }),
    ])
    try {
      expect([runtime.status, migration.status].sort()).toEqual(['fulfilled', 'rejected'])
      if (runtime.status === 'fulfilled') {
        expect(migration.status === 'rejected' && migration.reason.code).toBe('conflict')
        await runtime.value.heartbeat()
      }
      if (migration.status === 'fulfilled') {
        expect(runtime.status === 'rejected' && runtime.reason.code).toBe('unavailable')
        await migration.value.drain()
        await expect(assertRuntimeAuthority(sql, 'joining-replica')).rejects.toMatchObject({ code: 'unavailable' })
      }
    } finally {
      if (runtime.status === 'fulfilled') await runtime.value.release()
      if (migration.status === 'fulfilled') {
        await migration.value.rollback()
        await migration.value.releaseLock()
      }
    }
  })

  it('namespaces lifetime locks by schema and releases the runtime registry idempotently', async () => {
    const first = await fixture()
    const second = await fixture()
    const runtime = await acquireRuntimeLease(first.sql, { instanceId: first.instanceId, replicaId: 'first-schema', redisUrl: 'redis://fixture' })
    const migration = await acquireDatabaseMigrationFence(second.sql, {
      instanceId: second.instanceId, replicaId: 'second-schema', operationId: randomUUID(),
    })
    try {
      await migration.drain()
      await runtime.heartbeat()
      expect(await first.sql`SELECT 1 FROM tb_runtime_replicas`).toHaveLength(1)
      await runtime.release()
      await runtime.release()
      expect(await first.sql`SELECT 1 FROM tb_runtime_replicas`).toHaveLength(0)
      await expect(runtime.heartbeat()).rejects.toMatchObject({ code: 'unavailable' })
    } finally {
      await runtime.release()
      await migration.rollback()
      await migration.releaseLock()
    }
  })

  it('a copying fence survives the coordinator connection ending without a TTL reopening', async () => {
    const { sql, instanceId } = await fixture()
    const fence = await acquireDatabaseMigrationFence(sql, {
      instanceId, replicaId: 'previous-process', operationId: randomUUID(),
    })
    await fence.drain()
    await fence.releaseLock()
    expect((await sql`SELECT expires_at::text AS expiry FROM tb_runtime_maintenance`)[0]?.expiry).toBe('infinity')
    await expect(acquireRuntimeLease(sql, { instanceId, replicaId: 'restarted-process', redisUrl: 'redis://fixture' }))
      .rejects.toMatchObject({ code: 'unavailable' })
    await expect(acquireDatabaseMigrationFence(sql, { instanceId, replicaId: 'new-maintenance', operationId: randomUUID() }))
      .rejects.toMatchObject({ code: 'conflict' })
  })

  it('losing the reserved backend and expiring its registration does not authorize migration', async () => {
    const { sql, instanceId } = await fixture()
    const runtime = await acquireRuntimeLease(sql, { instanceId, replicaId: 'lost-session', redisUrl: 'redis://fixture' })
    try {
      const [held] = await runtimeLocks(sql)
      expect(held?.mode).toBe('ShareLock')
      await administrator`SELECT pg_terminate_backend(${held!.pid})`
      await sql`UPDATE tb_runtime_replicas SET expires_at=now()-interval '1 minute' WHERE replica_id='lost-session'`
      // The ordinary pool still performs writes after the reserved session was killed.
      await sql`CREATE TABLE live_writer(value text)`
      await sql`INSERT INTO live_writer VALUES('still running after lock loss')`
      await expect(runtime.heartbeat()).rejects.toMatchObject({ code: 'unavailable' })
      await expect(acquireDatabaseMigrationFence(sql, { instanceId, replicaId: 'migration-requester', operationId: randomUUID() }))
        .rejects.toMatchObject({ code: 'conflict' })
      expect(await sql`SELECT 1 FROM tb_runtime_maintenance`).toHaveLength(0)
      expect(await sql`SELECT 1 FROM tb_runtime_replicas WHERE replica_id='lost-session'`).toHaveLength(1)
    } finally {
      await runtime.release()
    }
  })
})
