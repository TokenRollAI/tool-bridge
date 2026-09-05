import type { MaintenanceJournal } from '@tool-bridge/core'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { basename } from 'node:path'
import postgres from 'postgres'
import {
  type MaintenanceHooks,
  MaintenanceManager,
  type MaintenanceSnapshot,
} from '../src/maintenanceManager'
import {
  acquireRuntimeLease,
  assertRuntimeAuthority,
  type RuntimeLease,
} from '../src/pgMaintenanceFence'

const exec = promisify(execFile)
const database = process.env.TB_TEST_DATABASE_URL
const container = process.env.TB_TEST_PG_CONTAINER
if (!database || !container)
  throw new Error('Maintenance tests require the isolated PG Docker fixture')
const admin = postgres(database, { max: 2, onnotice: () => {} })
const databases: string[] = []
const roles: string[] = []
afterEach(async () => {
  for (const name of databases.splice(0))
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
  for (const name of roles.splice(0))
    await admin.unsafe(`DROP ROLE IF EXISTS ${name}`)
})
afterAll(async () => {
  await admin.end({ timeout: 3 })
})
async function freshDatabase(): Promise<string> {
  const name = `tb_maint_${randomUUID().replaceAll('-', '')}`
  await admin.unsafe(`CREATE DATABASE ${name}`)
  databases.push(name)
  const url = new URL(database!)
  url.pathname = `/${name}`
  return url.toString()
}
async function sourceDatabase() {
  const url = await freshDatabase()
  const id = randomUUID()
  const sql = postgres(url, { max: 1 })
  try {
    await sql`CREATE TABLE tb_instance(id integer PRIMARY KEY,instance_id text NOT NULL)`
    await sql`INSERT INTO tb_instance VALUES(1,${id})`
    await sql`CREATE TABLE tb_values(id integer PRIMARY KEY,value text NOT NULL)`
    await sql`INSERT INTO tb_values VALUES(1,'保留密文和内容'),(2,'second record')`
  } finally {
    await sql.end({ timeout: 1 })
  }
  return { id, url }
}
function hooks(initial: Omit<MaintenanceSnapshot, 'replicaId'> & { replicaId?: string }) {
  let current = { ...initial, replicaId: initial.replicaId ?? randomUUID() }
  let journal: MaintenanceJournal | undefined
  const phases: string[] = []
  let locked = false
  const value: MaintenanceHooks = {
    readSnapshot: async () => ({ ...current }),
    readJournal: async () => journal,
    writeJournal: async (next) => {
      journal = next
    },
    exclusive: async (run) => {
      if (locked) throw new Error('already maintaining')
      locked = true
      try {
        return await run()
      } finally {
        locked = false
      }
    },
    quiesce: async () => {
      phases.push('stopped')
      return {
        resume: async () => {
          phases.push('resumed')
        },
      }
    },
    commit: async (next) => {
      if (next.expectedRevision !== current.revision)
        throw new Error('stale revision')
      current = {
        ...current,
        ...(next.databaseUrl ? { databaseUrl: next.databaseUrl } : {}),
        ...(next.redisUrl !== undefined
          ? { redisUrl: next.redisUrl ?? undefined }
          : {}),
        revision: current.revision + 1,
      }
      phases.push('committed')
      return { revision: current.revision }
    },
  }
  return { value, phases }
}
/** Execute the fixture's official PostgreSQL 18 binaries with credentials only in env. */
async function pgCommand(
  program: 'pg_dump' | 'pg_restore',
  args: string[],
  env: NodeJS.ProcessEnv,
) {
  const index
    = program === 'pg_dump' ? args.indexOf('--file') + 1 : args.length - 1
  const hostPath = args[index]!
  const path = `/tmp/${basename(hostPath)}-${randomUUID()}`
  const commandArgs = [...args]
  commandArgs[index] = path
  if (program === 'pg_restore')
    await exec('docker', ['cp', hostPath, `${container}:${path}`])
  try {
    await exec(
      'docker',
      [
        'exec',
        '-e',
        'PGHOST',
        '-e',
        'PGPORT',
        '-e',
        'PGUSER',
        '-e',
        'PGPASSWORD',
        '-e',
        'PGDATABASE',
        container!,
        program,
        ...commandArgs,
      ],
      { env: { ...env, PGHOST: '127.0.0.1', PGPORT: '5432' }, timeout: 60_000 },
    )
    if (program === 'pg_dump')
      await exec('docker', ['cp', `${container}:${path}`, hostPath])
  } finally {
    await exec('docker', ['exec', container!, 'rm', '-f', path])
  }
}

describe('database and Redis maintenance with real services', () => {
  it('refuses migration while another replica can still write the source', async () => {
    const source = await sourceDatabase()
    const target = await freshDatabase()
    const sql = postgres(source.url, { max: 1 })
    try {
      await sql`CREATE TABLE tb_runtime_replicas(replica_id text PRIMARY KEY,instance_id text NOT NULL,expires_at timestamptz NOT NULL)`
      await sql`INSERT INTO tb_runtime_replicas VALUES('other-live-replica',${source.id},now()+interval '60 seconds')`
      const control = hooks({ databaseUrl: source.url, instanceId: source.id, revision: 1 })
      let dumped = false
      const operation = new MaintenanceManager(control.value, {
        runCommand: async (program, args, env) => {
          await pgCommand(program, args, env)
          if (program === 'pg_dump') {
            dumped = true
            // A same-row update keeps table counts equal while splitting authority.
            await sql`UPDATE tb_values SET value='acknowledged after the snapshot' WHERE id=1`
          }
        },
      }).database({ databaseUrl: target, expectedInstanceId: source.id, expectedRevision: 1 })
      await expect(operation).rejects.toMatchObject({ code: 'conflict' })
      expect(dumped).toBe(false)
      expect(control.phases).toEqual([])
      expect((await control.value.readSnapshot()).databaseUrl).toBe(source.url)
    } finally {
      await sql.end({ timeout: 1 })
    }
  })
  it('real pg_dump/restore preserves rows and changes the pointer only after verification', async () => {
    const source = await sourceDatabase()
    const target = await freshDatabase()
    const control = hooks({
      databaseUrl: source.url,
      instanceId: source.id,
      revision: 1,
    })
    const result = await new MaintenanceManager(control.value, {
      runCommand: pgCommand,
    }).database({
      databaseUrl: target,
      expectedInstanceId: source.id,
      expectedRevision: 1,
    })
    expect(result.revision).toBe(2)
    expect(result.journal?.phase).toBe('complete')
    expect(control.phases).toEqual(['stopped', 'committed'])
    expect(JSON.stringify(result)).not.toContain(new URL(source.url).password)
    for (const url of [source.url, target]) {
      const sql = postgres(url, { max: 1 })
      try {
        expect(
          (await sql`SELECT value FROM tb_values ORDER BY id`).map(
            row => row.value,
          ),
        ).toEqual(['保留密文和内容', 'second record'])
      } finally {
        await sql.end({ timeout: 1 })
      }
    }
  })
  it('blocks new replicas during copying, retires the source, and activates only the committed target', async () => {
    const source = await sourceDatabase()
    const target = await freshDatabase()
    const replicaId = randomUUID()
    const control = hooks({ databaseUrl: source.url, instanceId: source.id, replicaId, revision: 1 })
    const sourceSql = postgres(source.url, { max: 3, onnotice: () => {} })
    const targetSql = postgres(target, { max: 3, onnotice: () => {} })
    let oldRuntime: RuntimeLease | undefined
    let nextRuntime: RuntimeLease | undefined
    try {
      oldRuntime = await acquireRuntimeLease(sourceSql, { instanceId: source.id, replicaId, redisConfigured: true })
      const quiet = control.value.quiesce
      control.value.quiesce = async () => {
        await oldRuntime!.release()
        return quiet()
      }
      const commit = control.value.commit
      control.value.commit = async (input) => {
        // Real target prepare must be allowed while the copied fence still exists.
        nextRuntime = await acquireRuntimeLease(targetSql, { instanceId: source.id, replicaId, redisConfigured: true })
        await expect(assertRuntimeAuthority(sourceSql, replicaId)).rejects.toMatchObject({ code: 'unavailable' })
        await expect(acquireRuntimeLease(sourceSql, { instanceId: source.id, replicaId: 'source-restarted', redisConfigured: true }))
          .rejects.toMatchObject({ code: 'unavailable' })
        return commit(input)
      }
      let attemptedStartup = false
      const result = await new MaintenanceManager(control.value, {
        runCommand: async (program, args, env) => {
          if (program === 'pg_dump') {
            attemptedStartup = true
            await expect(acquireRuntimeLease(sourceSql, { instanceId: source.id, replicaId: 'racing-startup', redisConfigured: true }))
              .rejects.toMatchObject({ code: 'unavailable' })
            await expect(assertRuntimeAuthority(sourceSql, 'racing-startup')).rejects.toMatchObject({ code: 'unavailable' })
            expect((await sourceSql`SELECT expires_at::text AS expiry FROM tb_runtime_maintenance`)[0]?.expiry).toBe('infinity')
          }
          await pgCommand(program, args, env)
        },
      }).database({ databaseUrl: target, expectedInstanceId: source.id, expectedRevision: 1 })
      expect(result.journal?.phase).toBe('complete')
      expect(attemptedStartup).toBe(true)
      await expect(assertRuntimeAuthority(sourceSql, replicaId)).rejects.toMatchObject({ code: 'unavailable' })
      expect((await sourceSql`SELECT phase,expires_at::text AS expiry FROM tb_runtime_maintenance`)[0])
        .toMatchObject({ phase: 'retired', expiry: 'infinity' })
      expect(await targetSql`SELECT 1 FROM tb_runtime_maintenance`).toHaveLength(0)
      const newReplica = await acquireRuntimeLease(targetSql, { instanceId: source.id, replicaId: 'target-next-replica', redisConfigured: true })
      await newReplica.release()
      await targetSql`UPDATE tb_values SET value='new authority write' WHERE id=1`
      expect((await sourceSql`SELECT value FROM tb_values WHERE id=1`)[0]?.value).toBe('保留密文和内容')
    } finally {
      await oldRuntime?.release()
      await nextRuntime?.release()
      await sourceSql.end({ timeout: 1 })
      await targetSql.end({ timeout: 1 })
    }
  })
  it('an expired heartbeat cannot conceal a runtime holding a source session lock', async () => {
    const source = await sourceDatabase()
    const target = await freshDatabase()
    const sql = postgres(source.url, { max: 3, onnotice: () => {} })
    let other: RuntimeLease | undefined
    try {
      other = await acquireRuntimeLease(sql, { instanceId: source.id, replicaId: 'silent-but-live', redisConfigured: true })
      await sql`UPDATE tb_runtime_replicas SET expires_at=now()-interval '1 second' WHERE replica_id='silent-but-live'`
      const control = hooks({ databaseUrl: source.url, instanceId: source.id, revision: 1 })
      let commandCalled = false
      await expect(new MaintenanceManager(control.value, {
        runCommand: async () => { commandCalled = true },
      }).database({ databaseUrl: target, expectedInstanceId: source.id, expectedRevision: 1 }))
        .rejects.toMatchObject({ code: 'conflict' })
      expect(commandCalled).toBe(false)
      expect(control.phases).toEqual([])
      await other.heartbeat()
      await assertRuntimeAuthority(sql, 'silent-but-live')
      await sql`UPDATE tb_values SET value='source safely resumed' WHERE id=1`
    } finally {
      await other?.release()
      await sql.end({ timeout: 1 })
    }
  })
  it('wrong identity and nonempty target are rejected without stopping service', async () => {
    const source = await sourceDatabase()
    const target = await sourceDatabase()
    const control = hooks({
      databaseUrl: source.url,
      instanceId: source.id,
      revision: 1,
    })
    const manager = new MaintenanceManager(control.value, {
      runCommand: pgCommand,
    })
    await expect(
      manager.database({
        databaseUrl: target.url,
        expectedInstanceId: randomUUID(),
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: 'invalid_argument' })
    await expect(
      manager.database({
        databaseUrl: target.url,
        expectedInstanceId: source.id,
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(control.phases).toEqual([])
    expect((await control.value.readSnapshot()).databaseUrl).toBe(source.url)
  })
  it('failed pointer commit resumes the old authority', async () => {
    const source = await sourceDatabase()
    const target = await freshDatabase()
    const control = hooks({
      databaseUrl: source.url,
      instanceId: source.id,
      revision: 1,
    })
    control.value.commit = async () => {
      throw new Error('simulated bootstrap fsync failure')
    }
    const manager = new MaintenanceManager(control.value, {
      runCommand: pgCommand,
    })
    await expect(
      manager.database({
        databaseUrl: target,
        expectedInstanceId: source.id,
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: 'unavailable' })
    expect(control.phases).toEqual(['stopped', 'resumed'])
    expect((await control.value.readSnapshot()).databaseUrl).toBe(source.url)
    expect((await manager.status()).journal?.phase).toBe('failed')
    const oldSql = postgres(source.url, { max: 3, onnotice: () => {} })
    const copiedSql = postgres(target, { max: 3, onnotice: () => {} })
    try {
      const oldRuntime = await acquireRuntimeLease(oldSql, { instanceId: source.id, replicaId: 'source-recovery', redisConfigured: true })
      await oldRuntime.release()
      expect((await copiedSql`SELECT phase FROM tb_runtime_maintenance`)[0]?.phase).toBe('discarded')
      await expect(acquireRuntimeLease(copiedSql, { instanceId: source.id, replicaId: 'uncommitted-clone', redisConfigured: true }))
        .rejects.toMatchObject({ code: 'unavailable' })
    } finally {
      await oldSql.end({ timeout: 1 })
      await copiedSql.end({ timeout: 1 })
    }
  })
  it('a committed pg_restore with a lost acknowledgement fences the clone before resuming the source', async () => {
    const source = await sourceDatabase()
    const target = await freshDatabase()
    const control = hooks({ databaseUrl: source.url, instanceId: source.id, revision: 1 })
    await expect(new MaintenanceManager(control.value, {
      runCommand: async (program, args, env) => {
        await pgCommand(program, args, env)
        if (program === 'pg_restore') throw new Error('restore committed but acknowledgement lost')
      },
    }).database({ databaseUrl: target, expectedInstanceId: source.id, expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'unavailable' })
    expect(control.phases).toEqual(['stopped', 'resumed'])
    const oldSql = postgres(source.url, { max: 2 })
    const copiedSql = postgres(target, { max: 2 })
    try {
      expect((await copiedSql`SELECT count(*)::int AS count FROM tb_values`)[0]?.count).toBe(2)
      expect((await copiedSql`SELECT phase FROM tb_runtime_maintenance`)[0]?.phase).toBe('discarded')
      await expect(assertRuntimeAuthority(copiedSql, (await control.value.readSnapshot()).replicaId))
        .rejects.toMatchObject({ code: 'unavailable' })
      await assertRuntimeAuthority(oldSql, 'fresh-source-runtime')
    } finally {
      await oldSql.end({ timeout: 1 })
      await copiedSql.end({ timeout: 1 })
    }
  })
  it('a bootstrap commit with a lost acknowledgement never restores the retired source', async () => {
    const source = await sourceDatabase()
    const target = await freshDatabase()
    const control = hooks({ databaseUrl: source.url, instanceId: source.id, revision: 1 })
    const commit = control.value.commit
    control.value.commit = async (input) => {
      await commit(input)
      throw new Error('bootstrap renamed but acknowledgement lost')
    }
    await expect(new MaintenanceManager(control.value, { runCommand: pgCommand })
      .database({ databaseUrl: target, expectedInstanceId: source.id, expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'unavailable' })
    expect(control.phases).toEqual(['stopped', 'committed'])
    expect((await control.value.readSnapshot()).databaseUrl).toBe(target)
    const oldSql = postgres(source.url, { max: 2 })
    const copiedSql = postgres(target, { max: 2 })
    try {
      expect((await oldSql`SELECT phase,expires_at::text AS expiry FROM tb_runtime_maintenance`)[0])
        .toMatchObject({ phase: 'retired', expiry: 'infinity' })
      expect((await copiedSql`SELECT phase FROM tb_runtime_maintenance`)[0]?.phase).toBe('copying')
      await expect(assertRuntimeAuthority(oldSql, (await control.value.readSnapshot()).replicaId))
        .rejects.toMatchObject({ code: 'unavailable' })
      await expect(assertRuntimeAuthority(copiedSql, 'new-process-after-unknown-commit'))
        .rejects.toMatchObject({ code: 'unavailable' })
    } finally {
      await oldSql.end({ timeout: 1 })
      await copiedSql.end({ timeout: 1 })
    }
  })
  it('real Redis read/write and pubsub are checked before connection changes', async () => {
    const source = await sourceDatabase()
    const control = hooks({
      databaseUrl: source.url,
      instanceId: source.id,
      revision: 1,
    })
    const manager = new MaintenanceManager(control.value)
    expect(
      (
        await manager.redis({
          expectedRevision: 1,
          redisUrl: process.env.TB_TEST_REDIS_URL!,
        })
      ).redisConfigured,
    ).toBe(true)
    expect(
      (await manager.redis({ expectedRevision: 2, redisUrl: null }))
        .redisConfigured,
    ).toBe(false)
  })
  it('a shared superuser login is never auto-retired', async () => {
    const source = await sourceDatabase()
    const control = hooks({
      databaseUrl: source.url,
      instanceId: source.id,
      revision: 1,
    })
    control.value.readDatabaseAdminUrl = async () => source.url
    await expect(
      new MaintenanceManager(control.value).rotate_database_credentials({
        expectedRevision: 1,
        expectedInstanceId: source.id,
        password: 'replacement-secret-password-long',
      }),
    ).rejects.toMatchObject({ code: 'permission_denied' })
    expect(control.phases).toEqual([])
  })
  it('dedicated role rotation verifies a new login then retires the old login', async () => {
    const source = await sourceDatabase()
    const name = `tb_app_${randomUUID().replaceAll('-', '')}`
    const password = 'old-password-test-123456789'
    await admin.unsafe(`CREATE ROLE ${name} LOGIN PASSWORD '${password}'`)
    roles.push(name)
    const sourceAdmin = postgres(source.url, { max: 1 })
    try {
      await sourceAdmin.unsafe(`GRANT USAGE ON SCHEMA public TO ${name}`)
      await sourceAdmin.unsafe(
        `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${name}`,
      )
    } finally {
      await sourceAdmin.end({ timeout: 1 })
    }
    const oldUrl = new URL(source.url)
    oldUrl.username = name
    oldUrl.password = password
    const control = hooks({
      databaseUrl: oldUrl.toString(),
      instanceId: source.id,
      revision: 1,
    })
    const result = await new MaintenanceManager(
      control.value,
    ).rotate_database_credentials({
      databaseAdminUrl: source.url,
      expectedRevision: 1,
      expectedInstanceId: source.id,
      password: 'replacement-secret-password-long',
    })
    const newUrl = (await control.value.readSnapshot()).databaseUrl
    roles.unshift(new URL(newUrl).username)
    expect(result.journal?.phase).toBe('complete')
    const replacement = postgres(newUrl, { max: 1 })
    try {
      expect(
        (await replacement`SELECT count(*)::int AS count FROM tb_values`)[0]
          ?.count,
      ).toBe(2)
    } finally {
      await replacement.end({ timeout: 1 })
    }
    const retired = postgres(oldUrl.toString(), { max: 1, connect_timeout: 1 })
    try {
      await expect(retired`SELECT 1`).rejects.toBeDefined()
    } finally {
      await retired.end({ timeout: 1 })
    }
  })
})
