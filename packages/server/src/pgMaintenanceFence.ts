import postgres, { type ISql, type Sql } from 'postgres'
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
    await tx`ALTER TABLE tb_runtime_replicas ADD COLUMN IF NOT EXISTS session_fenced boolean NOT NULL DEFAULT false`
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

export class RuntimeHandoffPendingError extends TBError {
  constructor(message = 'another runtime still holds the database session lock') {
    super('unavailable', message, { retryable: true })
    this.name = 'RuntimeHandoffPendingError'
  }
}

// postgres.js exposes onclose on a client, not on a reserve() handle. Give the
// lock its own physical connection: closing it also drops locks after an unknown
// query outcome, without returning a possibly locked session to the business pool.
function lockConnection(sql: Sql, onclose?: () => void): Sql {
  const options = { ...sql.options, max: 1, idle_timeout: 0, max_lifetime: null, onclose }
  // postgres.js also clones parsed options for its LISTEN and subscription clients.
  // @ts-expect-error The constructor types only describe unparsed hosts and ports.
  return postgres(options)
}

interface SessionLock {
  key: string
  pid: number
}

async function tryRuntimeLock(sql: ISql, shared: boolean): Promise<SessionLock | undefined> {
  const [row] = await sql<(SessionLock & { acquired: boolean })[]>`SELECT pg_backend_pid() AS pid, key::text,
    CASE WHEN ${shared}::boolean THEN pg_try_advisory_lock_shared(key) ELSE pg_try_advisory_lock(key) END AS acquired
    FROM (SELECT hashtextextended(current_schema() || ':tool-bridge-runtime',${RUNTIME_LOCK}) AS key) AS runtime`
  return row?.acquired ? row : undefined
}

async function runtimeLockHeld(sql: ISql, lock: SessionLock, shared: boolean): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM pg_catalog.pg_locks
    WHERE locktype='advisory' AND granted AND pid=pg_backend_pid() AND pid=${lock.pid}
      AND database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
      AND mode=${shared ? 'ShareLock' : 'ExclusiveLock'} AND objsubid=1
      AND classid=((${lock.key}::bigint >> 32) & 4294967295)::oid
      AND objid=(${lock.key}::bigint & 4294967295)::oid`
  return rows.length === 1
}

/**
 * Session locks arbitrate admission. A foreign row survives takeover so maintenance
 * still requires proof of graceful drain. A lost lease calls onLost once, even
 * between heartbeats, and can never regain authority by reconnecting.
 */
export async function acquireRuntimeLease(
  sql: Sql,
  input: { instanceId: string, onLost?: () => void, redisUrl?: string, replicaId: string },
): Promise<RuntimeLease> {
  const router = routerIdentity(input.redisUrl)
  const shared = Boolean(input.redisUrl)
  await ensureRuntimeCoordinationSchema(sql)
  let registered = false
  let lost: TBError | undefined
  let releasing: Promise<void> | undefined
  const markLost = () => {
    if (!lost) {
      lost = new TBError('unavailable', 'runtime database session was lost; drain and restart this replica')
      if (registered && !releasing) input.onLost?.()
    }
    return lost
  }
  const session = lockConnection(sql, markLost)
  const checkSession = () => {
    if (releasing) throw new TBError('unavailable', 'runtime lease has been released')
    if (lost) throw lost
  }
  const release = () => releasing ??= (async () => {
    try {
      if (registered) await sql`DELETE FROM tb_runtime_replicas WHERE replica_id=${input.replicaId}`
    } finally {
      await session.end({ timeout: 5 })
    }
  })()

  try {
    const lock = await session.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(${COORDINATION_LOCK})`
      await assertRuntimeAuthority(tx, input.replicaId)
      await tx`INSERT INTO tb_runtime_router(instance_id,identity) VALUES(${input.instanceId},${router}) ON CONFLICT DO NOTHING`
      const [current] = await tx`SELECT identity FROM tb_runtime_router WHERE instance_id=${input.instanceId}`
      if (current?.identity !== router) throw new TBError('conflict', 'Redis configuration differs from the active router; update this replica before joining')

      const lock = await tryRuntimeLock(tx, shared)
      if (!lock) {
        // Even the maintenance owner cannot start a replacement during its own drain.
        const maintenance = await tx`SELECT 1 FROM tb_runtime_maintenance WHERE id=1 AND expires_at>now()`
        if (shared || maintenance.length) throw new TBError('unavailable', 'database authority is held by another runtime or maintenance')
        throw new RuntimeHandoffPendingError()
      }
      if (!shared) {
        // Older servers cannot seal their business pool when their lock session dies.
        // Keep their original admission window during the initial stop-first upgrade.
        const legacy = await tx`SELECT 1 FROM tb_runtime_replicas WHERE instance_id=${input.instanceId}
          AND session_fenced=false AND expires_at>now() LIMIT 1`
        if (legacy.length) throw new RuntimeHandoffPendingError('waiting for the previous gateway version to drain')
      }
      const inserted = await tx`INSERT INTO tb_runtime_replicas(replica_id,instance_id,expires_at,router_identity,session_fenced)
        VALUES(${input.replicaId},${input.instanceId},now()+interval '60 seconds',${router},true)
        ON CONFLICT(replica_id) DO NOTHING RETURNING replica_id`
      if (!inserted.length) throw new TBError('conflict', 'runtime replica ID is already registered; drain the previous runtime')
      return lock
    })
    registered = true
    checkSession()
    return {
      heartbeat: async () => {
        checkSession()
        await session.begin(async (tx) => {
          await tx`SELECT pg_advisory_xact_lock(${COORDINATION_LOCK})`
          checkSession()
          await assertRuntimeAuthority(tx, input.replicaId)
          const updated = await tx`UPDATE tb_runtime_replicas SET expires_at=now()+interval '60 seconds'
            WHERE replica_id=${input.replicaId} RETURNING replica_id`
          if (!updated.length || !await runtimeLockHeld(tx, lock, shared)) throw markLost()
        })
        checkSession()
      },
      release,
    }
  } catch (error) {
    await release()
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
  let session: Sql | undefined
  const releaseLock = async () => {
    const previous = session
    session = undefined
    await previous?.end()
  }
  return {
    drain: async () => {
      if (session) throw new TBError('conflict', 'maintenance already has a drain in progress')
      const attempt = lockConnection(sql)
      session = attempt
      try {
        if (!await tryRuntimeLock(attempt, false))
          throw new TBError('conflict', 'another runtime still holds this database; stop it before migration')
      } catch (error) {
        if (session === attempt) session = undefined
        await attempt.end()
        throw error
      }
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
