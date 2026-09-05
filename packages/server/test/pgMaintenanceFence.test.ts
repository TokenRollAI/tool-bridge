import { afterAll, afterEach, describe, expect, it } from 'vitest'
import postgres, { type Sql } from 'postgres'
import { randomUUID } from 'node:crypto'
import {
  acquireDatabaseMigrationFence,
  acquireRuntimeLease,
  assertRuntimeAuthority,
  ensureRuntimeCoordinationSchema,
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
  it('serializes replica admission and migration acquisition so both cannot succeed', async () => {
    const { sql, instanceId } = await fixture()
    const [runtime, migration] = await Promise.allSettled([
      acquireRuntimeLease(sql, { instanceId, replicaId: 'joining-replica', redisConfigured: true }),
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
    const runtime = await acquireRuntimeLease(first.sql, { instanceId: first.instanceId, replicaId: 'first-schema', redisConfigured: true })
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
    await expect(acquireRuntimeLease(sql, { instanceId, replicaId: 'restarted-process', redisConfigured: true }))
      .rejects.toMatchObject({ code: 'unavailable' })
    await expect(acquireDatabaseMigrationFence(sql, { instanceId, replicaId: 'new-maintenance', operationId: randomUUID() }))
      .rejects.toMatchObject({ code: 'conflict' })
  })

  it('losing the reserved backend and expiring its registration does not authorize migration', async () => {
    const { sql, instanceId } = await fixture()
    const runtime = await acquireRuntimeLease(sql, { instanceId, replicaId: 'lost-session', redisConfigured: true })
    try {
      const [held] = await sql<{ pid: number }[]>`SELECT pid FROM pg_locks
        WHERE locktype='advisory' AND mode='ShareLock' AND granted
          AND objid=(hashtextextended(current_schema() || ':tool-bridge-runtime',7283023) & 4294967295)::oid
          AND classid=((hashtextextended(current_schema() || ':tool-bridge-runtime',7283023) >> 32) & 4294967295)::oid
          AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`
      expect(held?.pid).toBeTypeOf('number')
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
