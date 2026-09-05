import type { ISql, ReservedSql, Sql } from 'postgres'
import { TBError } from '@tool-bridge/core'

const COORDINATION_LOCK = 7283022
const RUNTIME_LOCK = 7283023

export async function ensureRuntimeCoordinationSchema(sql: Sql): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${COORDINATION_LOCK})`
    await tx`CREATE TABLE IF NOT EXISTS tb_runtime_replicas (
      replica_id text PRIMARY KEY, instance_id text NOT NULL, expires_at timestamptz NOT NULL)`
    await tx`CREATE TABLE IF NOT EXISTS tb_runtime_maintenance (
      id integer PRIMARY KEY CHECK(id=1), owner_replica_id text NOT NULL, expires_at timestamptz NOT NULL,
      purpose text NOT NULL DEFAULT 'keys', phase text NOT NULL DEFAULT 'active', operation_id text)`
    await tx`ALTER TABLE tb_runtime_maintenance ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'keys'`
    await tx`ALTER TABLE tb_runtime_maintenance ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'active'`
    await tx`ALTER TABLE tb_runtime_maintenance ADD COLUMN IF NOT EXISTS operation_id text`
  })
}

/** A retired source/failed clone remains fenced even for the operation's original owner. */
export async function assertRuntimeAuthority(sql: ISql, replicaId: string): Promise<void> {
  const rows = await sql`SELECT 1 FROM tb_runtime_maintenance
    WHERE id=1 AND expires_at>now()
      AND (owner_replica_id<>${replicaId} OR (purpose='database' AND phase<>'copying'))`
  if (rows.length) throw new TBError('unavailable', 'database authority is fenced for protected maintenance')
}

export interface RuntimeLease {
  heartbeat(): Promise<void>
  release(): Promise<void>
}

async function runtimeLockHeld(sql: ISql, backendPid: number | undefined, mode = 'ShareLock'): Promise<boolean> {
  if (backendPid === undefined) return false
  const [row] = await sql<{ held: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_locks
    WHERE pid=${backendPid} AND locktype='advisory' AND mode=${mode} AND granted) AS held`
  return row?.held === true
}

/**
 * A live runtime holds a shared session lock until its requests/background work drain.
 * Migration also requires all foreign registry rows to have been explicitly removed
 * by graceful shutdown: a broken/reconnected session is not proof of stopped work.
 * The reserved connection is never used for business transactions or network I/O.
 */
export async function acquireRuntimeLease(
  sql: Sql,
  input: { instanceId: string, redisConfigured: boolean, replicaId: string },
): Promise<RuntimeLease> {
  await ensureRuntimeCoordinationSchema(sql)
  const session = await sql.reserve()
  let released = false
  let held = false
  let backendPid: number | undefined
  let lost = false
  const heartbeat = async () => {
    if (released) throw new TBError('unavailable', 'runtime lease has been released')
    if (lost) throw new TBError('unavailable', 'runtime database session was lost; drain and restart this replica')
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(${COORDINATION_LOCK})`
      await assertRuntimeAuthority(tx, input.replicaId)
      if (!held) {
        const [row] = await session<{ acquired: boolean, pid: number }[]>`SELECT pg_backend_pid() AS pid,
          pg_try_advisory_lock_shared(hashtextextended(current_schema() || ':tool-bridge-runtime',${RUNTIME_LOCK})) AS acquired`
        if (!row?.acquired) throw new TBError('unavailable', 'database migration is draining its previous authority')
        held = true
        backendPid = row.pid
      } else {
        // Do not execute through a disconnected reserved wrapper: postgres.js may
        // reconnect it without its lock, or leave a query waiting on a closed socket.
        if (!await runtimeLockHeld(tx, backendPid)) {
          lost = true
          throw new TBError('unavailable', 'runtime database session was lost; drain and restart this replica')
        }
      }
      const others = await tx`SELECT 1 FROM tb_runtime_replicas
        WHERE instance_id=${input.instanceId} AND replica_id<>${input.replicaId} AND expires_at>now()`
      if (others.length && !input.redisConfigured) throw new TBError('unavailable', 'multiple replicas require a configured Redis device router')
      await tx`INSERT INTO tb_runtime_replicas(replica_id,instance_id,expires_at)
        VALUES(${input.replicaId},${input.instanceId},now()+interval '60 seconds')
        ON CONFLICT(replica_id) DO UPDATE SET expires_at=excluded.expires_at`
    })
  }
  const release = async () => {
    if (released) return
    released = true
    try {
      await sql`DELETE FROM tb_runtime_replicas WHERE replica_id=${input.replicaId}`
    } finally {
      try {
        if (held && await runtimeLockHeld(sql, backendPid)) await session`SELECT pg_advisory_unlock_shared(hashtextextended(current_schema() || ':tool-bridge-runtime',${RUNTIME_LOCK}))`
      } finally {
        session.release()
      }
    }
  }
  try {
    await heartbeat()
    return { heartbeat, release }
  } catch (error) {
    await release().catch(() => {})
    throw error
  }
}

export interface DatabaseMigrationFence {
  /** Must follow local runtime quiescence; a stale registry entry cannot bypass live locks. */
  drain(): Promise<void>
  releaseLock(): Promise<void>
  /** Never expires: success must not permit a source bootstrap to restart against old data. */
  retire(): Promise<void>
  /** Only safe when the bootstrap still identifies the source and a restored clone is fenced. */
  rollback(): Promise<void>
}

export async function acquireDatabaseMigrationFence(
  sql: Sql,
  input: { instanceId: string, operationId: string, replicaId: string },
): Promise<DatabaseMigrationFence> {
  await ensureRuntimeCoordinationSchema(sql)
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${COORDINATION_LOCK})`
    // A TTL can expire while an admitted request is still running. PostgreSQL.js can
    // reconnect a reserved wrapper after its session lock was lost, too. Only normal
    // drain/release proves a foreign runtime stopped; crashes require offline recovery.
    const others = await tx`SELECT 1 FROM tb_runtime_replicas
      WHERE instance_id=${input.instanceId} AND replica_id<>${input.replicaId}`
    if (others.length) throw new TBError('conflict', 'database migration requires gracefully stopping all other replicas; stale registrations require offline recovery')
    const existing = await tx`SELECT 1 FROM tb_runtime_maintenance WHERE id=1 AND expires_at>now()`
    if (existing.length) throw new TBError('conflict', 'another protected maintenance operation requires recovery or completion')
    await tx`INSERT INTO tb_runtime_maintenance(id,owner_replica_id,expires_at,purpose,phase,operation_id)
      VALUES(1,${input.replicaId},'infinity','database','copying',${input.operationId})
      ON CONFLICT(id) DO UPDATE SET owner_replica_id=excluded.owner_replica_id,expires_at=excluded.expires_at,
        purpose=excluded.purpose,phase=excluded.phase,operation_id=excluded.operation_id`
  })
  let session: ReservedSql | undefined
  let locked = false
  let backendPid: number | undefined
  const releaseLock = async () => {
    const previous = session
    session = undefined
    if (!previous) return
    try {
      if (locked && await runtimeLockHeld(sql, backendPid, 'ExclusiveLock')) await previous`SELECT pg_advisory_unlock(hashtextextended(current_schema() || ':tool-bridge-runtime',${RUNTIME_LOCK}))`
    } finally {
      locked = false
      previous.release()
    }
  }
  return {
    drain: async () => {
      session = await sql.reserve()
      const [row] = await session<{ acquired: boolean, pid: number }[]>`SELECT pg_backend_pid() AS pid,
        pg_try_advisory_lock(hashtextextended(current_schema() || ':tool-bridge-runtime',${RUNTIME_LOCK})) AS acquired`
      if (!row?.acquired) throw new TBError('conflict', 'another runtime still holds this database; stop it before migration')
      locked = true
      backendPid = row.pid
    },
    retire: async () => {
      const rows = await sql`UPDATE tb_runtime_maintenance SET phase='retired'
        WHERE id=1 AND purpose='database' AND operation_id=${input.operationId} AND phase='copying' RETURNING id`
      if (rows.length !== 1) throw new TBError('unavailable', 'database migration fence was lost; local recovery is required')
    },
    rollback: async () => {
      await sql`DELETE FROM tb_runtime_maintenance WHERE id=1 AND purpose='database' AND operation_id=${input.operationId}`
    },
    releaseLock,
  }
}

/** The dump copies its durable fence, but deliberately omits transient runtime registry rows. */
export async function finishMigrationTarget(sql: Sql, operationId: string, activate: boolean): Promise<void> {
  if (!activate) {
    // pg_restore can commit before its process/transport reports failure. A failed
    // restore is safe to abandon only when it left an empty DB or our fenced clone.
    const [inventory] = await sql<{ count: string }[]>`SELECT count(*)::text AS count
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
        AND c.relkind IN ('r','p','v','m','S','f')`
    if (inventory?.count === '0') return
  }
  const rows = activate
    ? await sql`DELETE FROM tb_runtime_maintenance
      WHERE id=1 AND purpose='database' AND operation_id=${operationId} AND phase='copying' RETURNING id`
    : await sql`UPDATE tb_runtime_maintenance SET phase='discarded'
      WHERE id=1 AND purpose='database' AND operation_id=${operationId} RETURNING id`
  if (rows.length !== 1) throw new TBError('unavailable', 'restored database fence is unavailable; local recovery is required')
}
