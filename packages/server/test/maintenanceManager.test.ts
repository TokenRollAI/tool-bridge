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
function hooks(initial: MaintenanceSnapshot) {
  let current = { ...initial }
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
