import {
  isTBError,
  type MaintenanceJournal,
  type MaintenanceManagement,
  type MaintenanceStatus,
  TBError,
} from '@tool-bridge/core'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import postgres, { type Sql } from 'postgres'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Redis } from 'ioredis'

export interface MaintenanceSnapshot {
  databaseUrl: string
  instanceId: string
  redisUrl?: string
  revision: number
}
export interface MaintenanceHooks {
  commit(next: {
    databaseUrl?: string
    expectedRevision: number
    redisUrl?: string | null
  }): Promise<{ revision: number }>
  exclusive<T>(run: () => Promise<T>): Promise<T>
  quiesce(): Promise<{ resume(): Promise<void> }>
  readDatabaseAdminUrl?(): Promise<string | undefined>
  readJournal(): Promise<MaintenanceJournal | undefined>
  readSnapshot(): Promise<MaintenanceSnapshot>
  writeJournal(journal: MaintenanceJournal): Promise<void>
}
export interface PgCommandOptions {
  /** Explicit executable paths; command strings are never evaluated by a shell. */
  pgDump?: string
  pgRestore?: string
  /** Local container integration tests may inject the same official binaries via docker exec. */
  runCommand?: (
    program: 'pg_dump' | 'pg_restore',
    args: string[],
    env: NodeJS.ProcessEnv,
  ) => Promise<void>
}

function connection(value: string): URL {
  let result: URL
  try {
    result = new URL(value)
  } catch {
    throw new TBError('invalid_argument', 'PostgreSQL URL is invalid')
  }
  if (
    !['postgres:', 'postgresql:'].includes(result.protocol)
    || !result.hostname
    || !result.pathname.slice(1)
    || result.hash
  ) {
    throw new TBError(
      'invalid_argument',
      'PostgreSQL connection must name a host and database',
    )
  }
  // Maintenance copies a complete database. Schema-scoped/session-options URLs
  // cannot prove that the copied authority is the one serving this instance.
  for (const key of result.searchParams.keys()) {
    if (
      ![
        'sslmode',
        'sslrootcert',
        'sslcert',
        'sslkey',
        'connect_timeout',
        'application_name',
      ].includes(key)
    ) {
      throw new TBError(
        'invalid_argument',
        'PostgreSQL maintenance URL has unsupported connection parameters',
      )
    }
  }
  return result
}
function sqlClient(url: string): Sql {
  return postgres(url, {
    max: 2,
    connect_timeout: 5,
    idle_timeout: 5,
    onnotice: () => {},
  })
}
function commandEnv(url: URL): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  // Caller-controlled PG* inherited settings must not redirect a maintenance command.
  for (const key of Object.keys(env)) if (key.startsWith('PG')) delete env[key]
  Object.assign(env, {
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGCONNECT_TIMEOUT: '5',
  })
  for (const [key, target] of [
    ['sslmode', 'PGSSLMODE'],
    ['sslrootcert', 'PGSSLROOTCERT'],
    ['sslcert', 'PGSSLCERT'],
    ['sslkey', 'PGSSLKEY'],
  ] as const) {
    const value = url.searchParams.get(key)
    if (value) env[target] = value
  }
  return env
}
async function identity(sql: Sql, expected: string): Promise<void> {
  const rows = await sql<
    { instance_id: string }[]
  >`SELECT instance_id FROM public.tb_instance WHERE id=1`
  if (rows.length !== 1 || rows[0]!.instance_id !== expected)
    throw new TBError(
      'invalid_argument',
      'PostgreSQL instance identity does not match',
    )
}
async function tableCounts(sql: Sql): Promise<Record<string, string>> {
  const tables = await sql<
    { tablename: string }[]
  >`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' AND left(tablename,3)='tb_' ORDER BY tablename`
  const counts: Record<string, string> = {}
  for (const table of tables) {
    const rows = await sql<
      { count: string }[]
    >`SELECT count(*)::text AS count FROM ${sql(`public.${table.tablename}`)}`
    counts[table.tablename] = rows[0]!.count
  }
  return counts
}

export class MaintenanceManager implements MaintenanceManagement {
  constructor(
    private readonly hooks: MaintenanceHooks,
    private readonly commands: PgCommandOptions = {},
  ) {}

  async status(): Promise<MaintenanceStatus> {
    const snapshot = await this.hooks.readSnapshot()
    const url = connection(snapshot.databaseUrl)
    return {
      revision: snapshot.revision,
      redisConfigured: Boolean(snapshot.redisUrl),
      database: {
        host: url.hostname,
        port: Number(url.port || 5432),
        name: decodeURIComponent(url.pathname.slice(1)),
        user: decodeURIComponent(url.username),
      },
      journal: await this.hooks.readJournal(),
    }
  }

  private async execute(
    operation: MaintenanceJournal['operation'],
    expectedRevision: number,
    run: (
      snapshot: MaintenanceSnapshot,
      step: (value: string) => Promise<void>,
    ) => Promise<void>,
  ): Promise<MaintenanceStatus> {
    return this.hooks.exclusive(async () => {
      const snapshot = await this.hooks.readSnapshot()
      if (snapshot.revision !== expectedRevision)
        throw new TBError(
          'conflict',
          'Bootstrap revision changed; reload before maintenance',
        )
      const journal: MaintenanceJournal = {
        operation,
        phase: 'running',
        step: 'preflight',
        startedAt: new Date().toISOString(),
      }
      const step = async (value: string) => {
        journal.step = value
        await this.hooks.writeJournal({ ...journal })
      }
      await step('preflight')
      try {
        await run(snapshot, step)
        await this.hooks.writeJournal({
          ...journal,
          phase: 'complete',
          step: 'complete',
        })
      } catch (error) {
        const message = isTBError(error)
          ? error.message
          : `${operation} maintenance failed; inspect the protected local recovery state`
        await this.hooks.writeJournal({
          ...journal,
          phase: 'failed',
          lastError: message,
        })
        if (isTBError(error)) throw error
        throw new TBError('unavailable', message, { retryable: false })
      }
      return this.status()
    })
  }

  private async command(
    program: 'pg_dump' | 'pg_restore',
    args: string[],
    env: NodeJS.ProcessEnv,
  ): Promise<void> {
    if (this.commands.runCommand)
      return this.commands.runCommand(program, args, env)
    const executable
      = program === 'pg_dump'
        ? (this.commands.pgDump ?? program)
        : (this.commands.pgRestore ?? program)
    try {
      await promisify(execFile)(executable, args, {
        env,
        timeout: 10 * 60_000,
        maxBuffer: 1024 * 1024,
      })
    } catch {
      // execFile errors include command arguments/stderr; never let these reach wire or logs.
      throw new TBError(
        'unavailable',
        `PostgreSQL ${program} failed; the original database remains authoritative`,
      )
    }
  }

  async database(
    input: Parameters<MaintenanceManagement['database']>[0],
  ): Promise<MaintenanceStatus> {
    return this.execute(
      'database',
      input.expectedRevision,
      async (snapshot, step) => {
        if (snapshot.instanceId !== input.expectedInstanceId)
          throw new TBError(
            'invalid_argument',
            'Instance identity does not match',
          )
        const from = connection(snapshot.databaseUrl)
        const to = connection(input.databaseUrl)
        if (
          from.hostname === to.hostname
          && (from.port || '5432') === (to.port || '5432')
          && from.pathname === to.pathname
        ) {
          throw new TBError(
            'invalid_argument',
            'Database migration requires a different empty database',
          )
        }
        const source = sqlClient(snapshot.databaseUrl)
        const target = sqlClient(input.databaseUrl)
        let resume: (() => Promise<void>) | undefined
        let directory: string | undefined
        try {
          await identity(source, snapshot.instanceId)
          const [targetInventory] = await target<
            { count: string }[]
          >`SELECT count(*)::text AS count FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f')`
          if (!targetInventory || targetInventory.count !== '0')
            throw new TBError(
              'invalid_argument',
              'Target database must be empty; existing data is never replaced',
            )
          await step('quiescing')
          resume = (await this.hooks.quiesce()).resume
          await identity(source, snapshot.instanceId)
          const counts = await tableCounts(source)
          directory = await mkdtemp(join(tmpdir(), 'tb-db-migration-'))
          await chmod(directory, 0o700)
          const archive = join(directory, 'database.dump')
          await writeFile(archive, '', { mode: 0o600 })
          await step('dumping')
          await this.command(
            'pg_dump',
            [
              '--format=custom',
              '--no-owner',
              '--no-privileges',
              '--file',
              archive,
            ],
            commandEnv(from),
          )
          await chmod(archive, 0o600)
          await step('restoring')
          await this.command(
            'pg_restore',
            [
              '--dbname',
              decodeURIComponent(to.pathname.slice(1)),
              '--single-transaction',
              '--exit-on-error',
              '--no-owner',
              '--no-privileges',
              archive,
            ],
            commandEnv(to),
          )
          await step('verifying')
          await identity(target, snapshot.instanceId)
          const restored = await tableCounts(target)
          if (JSON.stringify(counts) !== JSON.stringify(restored))
            throw new TBError(
              'unavailable',
              'Restored database table counts do not match; original database retained',
            )
          await step('committing')
          await this.hooks.commit({
            expectedRevision: snapshot.revision,
            databaseUrl: input.databaseUrl,
          })
          resume = undefined
        } finally {
          await source.end({ timeout: 5 })
          await target.end({ timeout: 5 })
          if (directory) await rm(directory, { recursive: true, force: true })
          await resume?.()
        }
      },
    )
  }

  async redis(
    input: Parameters<MaintenanceManagement['redis']>[0],
  ): Promise<MaintenanceStatus> {
    return this.execute(
      'redis',
      input.expectedRevision,
      async (snapshot, step) => {
        if (input.redisUrl) {
          let url: URL
          try {
            url = new URL(input.redisUrl)
          } catch {
            throw new TBError('invalid_argument', 'Redis URL is invalid')
          }
          if (!['redis:', 'rediss:'].includes(url.protocol))
            throw new TBError(
              'invalid_argument',
              'Redis URL must use redis or rediss',
            )
          const options = {
            connectTimeout: 5000,
            commandTimeout: 5000,
            retryStrategy: () => null,
            lazyConnect: true,
          }
          const publisher = new Redis(input.redisUrl, options)
          const subscriber = new Redis(input.redisUrl, options)
          publisher.on('error', () => {})
          subscriber.on('error', () => {})
          const key = `tb:maintenance:${randomUUID()}`
          try {
            await Promise.all([publisher.connect(), subscriber.connect()])
            await publisher.ping()
            await publisher.set(key, 'probe', 'EX', 30, 'NX')
            if ((await publisher.get(key)) !== 'probe')
              throw new TBError(
                'unavailable',
                'Redis read/write validation failed',
              )
            await subscriber.subscribe(key)
            const notified = new Promise<void>((resolve, reject) => {
              const timer = setTimeout(
                () => reject(new Error('Redis pubsub deadline exceeded')),
                5000,
              )
              subscriber.once('message', (channel, value) => {
                clearTimeout(timer)
                if (channel === key && value === 'probe') resolve()
                else reject(new Error('Redis notification mismatch'))
              })
            })
            await Promise.all([publisher.publish(key, 'probe'), notified])
          } finally {
            await publisher.del(key).catch(() => {})
            subscriber.disconnect()
            publisher.disconnect()
          }
        }
        await step('quiescing')
        const lease = await this.hooks.quiesce()
        let committed = false
        try {
          await step('committing')
          await this.hooks.commit({
            expectedRevision: snapshot.revision,
            redisUrl: input.redisUrl,
          })
          committed = true
        } finally {
          if (!committed) await lease.resume()
        }
      },
    )
  }

  async rotate_database_credentials(
    input: Parameters<MaintenanceManagement['rotate_database_credentials']>[0],
  ): Promise<MaintenanceStatus> {
    return this.execute(
      'database_credentials',
      input.expectedRevision,
      async (snapshot, step) => {
        if (snapshot.instanceId !== input.expectedInstanceId)
          throw new TBError(
            'invalid_argument',
            'Instance identity does not match',
          )
        if (input.password.length < 24)
          throw new TBError(
            'invalid_argument',
            'Database credential must contain at least 24 characters',
          )
        const url = connection(snapshot.databaseUrl)
        const adminUrl
          = input.databaseAdminUrl ?? (await this.hooks.readDatabaseAdminUrl?.())
        if (!adminUrl)
          throw new TBError(
            'permission_denied',
            'Database administrator credentials are required to safely rotate the application login',
          )
        const adminLocation = connection(adminUrl)
        if (
          adminLocation.hostname !== url.hostname
          || (adminLocation.port || '5432') !== (url.port || '5432')
          || adminLocation.pathname !== url.pathname
        ) {
          throw new TBError(
            'invalid_argument',
            'Database administrator connection must target the current instance database',
          )
        }
        const source = sqlClient(snapshot.databaseUrl)
        const administrator = sqlClient(adminUrl)
        const role = `tb_login_${randomUUID().replaceAll('-', '')}`
        let created = false
        let committed = false
        let resume: (() => Promise<void>) | undefined
        try {
          await identity(source, snapshot.instanceId)
          await identity(administrator, snapshot.instanceId)
          const [current] = await source<
            {
              rolbypassrls: boolean
              rolconnlimit: number
              rolcreatedb: boolean
              rolcreaterole: boolean
              rolname: string
              rolreplication: boolean
              rolsuper: boolean
              rolvaliduntil: Date | null
            }[]
          >`SELECT rolname,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil FROM pg_roles WHERE rolname=current_user`
          if (
            !current
            || current.rolsuper
            || current.rolreplication
            || current.rolbypassrls
          ) {
            throw new TBError(
              'permission_denied',
              'Automatic rotation requires a dedicated non-superuser login without replication or BYPASSRLS; ask the database administrator to provision one',
            )
          }
          await step('creating_login')
          await administrator.begin(async (tx) => {
            const [quoted] = await tx<
              { expiry: string, password: string }[]
            >`SELECT quote_literal(${input.password}) AS password, quote_literal(${current.rolvaliduntil?.toISOString() ?? 'infinity'}) AS expiry`
            await tx.unsafe(
              `CREATE ROLE ${role} LOGIN INHERIT ${current.rolcreaterole ? 'CREATEROLE' : 'NOCREATEROLE'} ${current.rolcreatedb ? 'CREATEDB' : 'NOCREATEDB'} CONNECTION LIMIT ${current.rolconnlimit} VALID UNTIL ${quoted!.expiry} PASSWORD ${quoted!.password}`,
            )
            await tx.unsafe(
              `GRANT "${current.rolname.replaceAll('"', '""')}" TO ${role}`,
            )
            const settings = await tx<
              { datname: string | null, setconfig: string[] }[]
            >`SELECT d.datname,s.setconfig FROM pg_db_role_setting s LEFT JOIN pg_database d ON d.oid=s.setdatabase WHERE s.setrole=(SELECT oid FROM pg_roles WHERE rolname=${current.rolname})`
            for (const setting of settings) {
              for (const item of setting.setconfig) {
                const separator = item.indexOf('=')
                const name = item.slice(0, separator)
                const value = item.slice(separator + 1)
                const [literal] = await tx<
                  { value: string }[]
                >`SELECT quote_literal(${value}) AS value`
                const databaseClause = setting.datname
                  ? ` IN DATABASE "${setting.datname.replaceAll('"', '""')}"`
                  : ''
                await tx.unsafe(
                  `ALTER ROLE ${role}${databaseClause} SET "${name.replaceAll('"', '""')}" TO ${literal!.value}`,
                )
              }
            }
          })
          created = true
          url.username = role
          url.password = input.password
          const replacement = sqlClient(url.toString())
          try {
            await identity(replacement, snapshot.instanceId)
            const differences = await administrator<
              { count: string }[]
            >`SELECT count(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p(privilege) WHERE n.nspname='public' AND left(c.relname,3)='tb_' AND c.relkind IN ('r','p') AND has_table_privilege(${current.rolname},c.oid,p.privilege) <> has_table_privilege(${role},c.oid,p.privilege)`
            if (differences[0]?.count !== '0')
              throw new TBError(
                'unavailable',
                'Replacement login does not preserve database privileges',
              )
          } finally {
            await replacement.end({ timeout: 5 })
          }
          await step('quiescing')
          resume = (await this.hooks.quiesce()).resume
          await step('committing')
          await this.hooks.commit({
            expectedRevision: snapshot.revision,
            databaseUrl: url.toString(),
          })
          committed = true
          resume = undefined
          await step('retiring_previous_login')
          await administrator
            .unsafe(
              `ALTER ROLE "${current.rolname.replaceAll('"', '""')}" NOLOGIN`,
            )
            .catch(() => {
              throw new TBError(
                'unavailable',
                'The new login is active, but the previous login could not be retired; database administrator action is required',
              )
            })
        } finally {
          if (created && !committed)
            await administrator
              .unsafe(`DROP ROLE IF EXISTS ${role}`)
              .catch(() => {})
          await source.end({ timeout: 5 })
          await administrator.end({ timeout: 5 })
          await resume?.()
        }
      },
    )
  }
}
