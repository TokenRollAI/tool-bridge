import type { ISql, ReservedSql, Sql } from 'postgres'
import { TBError } from '@tool-bridge/core'
import { createHash } from 'node:crypto'

function routerIdentity(url?: string | null): string {
  // No connection strings or credential material are stored in the runtime registry.
  return createHash('sha256').update(url ? new URL(url).href : 'local-only').digest('hex')
}

const COORDINATION_LOCK = 7283022
const RUNTIME_LOCK = 7283023

export async function ensureRuntimeCoordinationSchema(sql: Sql): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${COORDINATION_LOCK})`
    await tx`CREATE TABLE IF NOT EXISTS tb_runtime_replicas (
      replica_id text PRIMARY KEY, instance_id text NOT NULL, expires_at timestamptz NOT NULL)`
    await tx`CREATE TABLE IF NOT EXISTS tb_runtime_router (
      instance_id text PRIMARY KEY, identity text NOT NULL, enforce_identity boolean NOT NULL DEFAULT false)`
    await tx`ALTER TABLE tb_runtime_replicas ADD COLUMN IF NOT EXISTS router_identity text`
    // A pre-upgrade binary does not supply a router identity. After a switch it must
    // not admit itself with an outdated local bootstrap, even after the fence is lifted.
    await tx`CREATE OR REPLACE FUNCTION tb_check_runtime_router() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM tb_runtime_router WHERE instance_id=NEW.instance_id AND enforce_identity
          AND identity IS DISTINCT FROM NEW.router_identity) THEN
          RAISE EXCEPTION 'runtime router configuration does not match active router';
        END IF;
        RETURN NEW;
      END $$`
    await tx`CREATE OR REPLACE TRIGGER tb_runtime_router_admission BEFORE INSERT OR UPDATE ON tb_runtime_replicas
      FOR EACH ROW EXECUTE FUNCTION tb_check_runtime_router()`
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
  input: { instanceId: string, redisUrl?: string, replicaId: string },
): Promise<RuntimeLease> {
  await ensureRuntimeCoordinationSchema(sql)
  const session = await sql.reserve()
  let released = false
  let admitted = false
  const router = routerIdentity(input.redisUrl)
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
      if (!admitted) {
        await tx`INSERT INTO tb_runtime_router(instance_id,identity) VALUES(${input.instanceId},${router}) ON CONFLICT DO NOTHING`
        const [current] = await tx`SELECT identity FROM tb_runtime_router WHERE instance_id=${input.instanceId}`
        if (current?.identity !== router) throw new TBError('conflict', 'Redis configuration differs from the active router; update this replica before joining')
        const duplicate = await tx`SELECT 1 FROM tb_runtime_replicas WHERE replica_id=${input.replicaId}`
        if (duplicate.length) throw new TBError('conflict', 'runtime replica ID is already registered; drain the previous runtime')
      }
      const others = await tx`SELECT 1 FROM tb_runtime_replicas
        WHERE instance_id=${input.instanceId} AND replica_id<>${input.replicaId} AND expires_at>now()`
      if (others.length && !input.redisUrl) throw new TBError('unavailable', 'multiple replicas require a configured Redis device router')
      await tx`INSERT INTO tb_runtime_replicas(replica_id,instance_id,expires_at,router_identity)
        VALUES(${input.replicaId},${input.instanceId},now()+interval '60 seconds',${router})
        ON CONFLICT(replica_id) DO UPDATE SET expires_at=excluded.expires_at`
    })
  }
  const release = async () => {
    if (released) return
    released = true
    try {
      if (admitted) await sql`DELETE FROM tb_runtime_replicas WHERE replica_id=${input.replicaId}`
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
    admitted = true
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

async function acquireMaintenanceFence(
  sql: Sql,
  input: { instanceId: string, operationId: string, replicaId: string },
  purpose: 'database' | 'redis',
): Promise<DatabaseMigrationFence> {
  await ensureRuntimeCoordinationSchema(sql)
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${COORDINATION_LOCK})`
    // A TTL can expire while an admitted request is still running. PostgreSQL.js can
    // reconnect a reserved wrapper after its session lock was lost, too. Only normal
    // drain/release proves a foreign runtime stopped; crashes require offline recovery.
    const others = await tx`SELECT 1 FROM tb_runtime_replicas
      WHERE instance_id=${input.instanceId} AND replica_id<>${input.replicaId}`
    if (others.length) throw new TBError('conflict', `${purpose} maintenance requires gracefully stopping all other replicas; stale registrations require offline recovery`)
    const existing = await tx`SELECT 1 FROM tb_runtime_maintenance WHERE id=1 AND expires_at>now()`
    if (existing.length) throw new TBError('conflict', 'another protected maintenance operation requires recovery or completion')
    await tx`INSERT INTO tb_runtime_maintenance(id,owner_replica_id,expires_at,purpose,phase,operation_id)
      VALUES(1,${input.replicaId},'infinity',${purpose},'copying',${input.operationId})
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
      await sql`DELETE FROM tb_runtime_maintenance WHERE id=1 AND purpose=${purpose} AND operation_id=${input.operationId}`
    },
    releaseLock,
  }
}

export async function acquireDatabaseMigrationFence(
  sql: Sql,
  input: { instanceId: string, operationId: string, replicaId: string },
): Promise<DatabaseMigrationFence> {
  return acquireMaintenanceFence(sql, input, 'database')
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

/** Keep foreign admissions fenced while the owner starts a replacement runtime. */
export async function acquireRedisSwitchFence(sql: Sql, input: { instanceId: string, operationId: string, redisUrl?: string, replicaId: string }) {
  const fence = await acquireMaintenanceFence(sql, input, 'redis')
  let previousEnforcement = false
  const setRouter = async (from: string | undefined | null, to: string | undefined | null, restore = false) => {
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(${COORDINATION_LOCK})`
      const owned = await tx`SELECT 1 FROM tb_runtime_maintenance WHERE id=1 AND purpose='redis'
        AND operation_id=${input.operationId} AND owner_replica_id=${input.replicaId}`
      if (!owned.length) throw new TBError('unavailable', 'Redis maintenance fence was lost')
      if (!restore) {
        const [current] = await tx`SELECT enforce_identity FROM tb_runtime_router WHERE instance_id=${input.instanceId}`
        previousEnforcement = current?.enforce_identity === true
      }
      const enforce = restore ? previousEnforcement : true
      const changed = await tx`INSERT INTO tb_runtime_router(instance_id,identity,enforce_identity)
        VALUES(${input.instanceId},${routerIdentity(to)},${enforce}) ON CONFLICT(instance_id) DO UPDATE SET identity=excluded.identity,enforce_identity=excluded.enforce_identity
        WHERE tb_runtime_router.identity=${routerIdentity(from)} RETURNING instance_id`
      if (!changed.length) throw new TBError('conflict', 'active Redis router differs from bootstrap; local recovery is required')
    })
  }
  return { drain: fence.drain, releaseLock: fence.releaseLock, finish: fence.rollback, setRouter }
}
