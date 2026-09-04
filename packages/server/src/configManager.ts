import type { Sql } from 'postgres'
import { type ConfigManagement, type ConfigStatus, type RuntimeConfig, runtimeConfigSchema, TBError } from '@tool-bridge/core'
import { randomUUID } from 'node:crypto'

interface ConfigRow {
  applied_revision: number
  apply_token: string | null
  applying_revision: number | null
  effective: RuntimeConfig
  last_error: string | null
  lease_until: Date | null
  revision: number
  settings: RuntimeConfig
}

/** PG holds the requested/applied snapshots. A replica reports only successful local application. */
export class ConfigManager implements ConfigManagement {
  private localRevision = 0
  private localEffective: RuntimeConfig | undefined
  private localError: string | undefined
  private serial: Promise<unknown> = Promise.resolve()
  constructor(private readonly sql: Sql, private readonly onApply: (settings: RuntimeConfig) => Promise<void>) {}

  async ensureSchema(defaults = runtimeConfigSchema.parse({})): Promise<void> {
    await this.sql.begin(async (sql) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended('tb:runtime-config:schema:v1', 0))`
      await sql`CREATE TABLE IF NOT EXISTS tb_runtime_config (
      id integer PRIMARY KEY CHECK(id=1), revision bigint NOT NULL,
      settings jsonb NOT NULL, applied_revision bigint NOT NULL, effective jsonb NOT NULL,
      apply_token text, applying_revision bigint, lease_until timestamptz, last_error text
    )`
      await sql`ALTER TABLE tb_runtime_config ADD COLUMN IF NOT EXISTS apply_token text,
      ADD COLUMN IF NOT EXISTS applying_revision bigint, ADD COLUMN IF NOT EXISTS lease_until timestamptz,
      ADD COLUMN IF NOT EXISTS last_error text`
      await sql`INSERT INTO tb_runtime_config(id,revision,settings,applied_revision,effective)
      VALUES(1,1,${sql.json(defaults)},1,${sql.json(defaults)}) ON CONFLICT DO NOTHING`
    })
  }

  private async row(): Promise<ConfigRow> {
    const [row] = await this.sql<ConfigRow[]>`SELECT * FROM tb_runtime_config WHERE id=1`
    if (!row) throw new TBError('unavailable', 'runtime configuration has not been initialized')
    return row
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.serial.then(operation)
    this.serial = result.catch(() => {})
    return result
  }

  private async install(settings: RuntimeConfig, revision: number): Promise<void> {
    const previous = this.localEffective
    try {
      await this.onApply(settings)
      this.localEffective = settings
      this.localRevision = revision
      this.localError = undefined
    } catch {
      this.localError = 'runtime configuration could not be applied'
      if (previous !== undefined) {
        try {
          await this.onApply(previous)
        } catch {
          this.localRevision = 0
          this.localError = 'runtime configuration failed and requires recovery'
        }
      }
      throw new TBError('unavailable', this.localError)
    }
  }

  async sync(): Promise<void> {
    return this.exclusive(async () => {
      const row = await this.row()
      const revision = Number(row.applied_revision)
      if (this.localRevision !== revision || this.localError !== undefined) {
        await this.install(runtimeConfigSchema.parse(row.effective), revision)
      }
    })
  }

  async get(): Promise<ConfigStatus> {
    const row = await this.row()
    const error = this.localError ?? row.last_error ?? undefined
    const applying = row.apply_token !== null && row.lease_until !== null && new Date(row.lease_until).getTime() > Date.now()
    return {
      appliedRevision: this.localRevision, revision: Number(row.revision),
      desired: runtimeConfigSchema.parse(row.settings),
      effective: this.localEffective ?? runtimeConfigSchema.parse(row.effective),
      state: error !== undefined
        ? 'failed'
        : applying
          ? 'applying'
          : this.localRevision === Number(row.revision) ? 'applied' : 'pending',
      ...(error === undefined ? {} : { lastError: error }),
    }
  }

  async update(input: Parameters<ConfigManagement['update']>[0]): Promise<ConfigStatus> {
    const settings = runtimeConfigSchema.parse(input.settings)
    const rows = await this.sql`UPDATE tb_runtime_config SET settings=${this.sql.json(settings)},revision=revision+1
      WHERE id=1 AND revision=${input.expectedRevision}`
    if (!rows.count) throw new TBError('conflict', 'configuration revision changed; reload first')
    return this.get()
  }

  async apply(input: Parameters<ConfigManagement['apply']>[0]): Promise<ConfigStatus> {
    return this.exclusive(async () => {
      const token = randomUUID()
      // The lease fences simultaneous administrators without keeping any DB transaction open
      // during scheduler/connection reconstruction or device authority sweeps.
      const [row] = await this.sql<ConfigRow[]>`UPDATE tb_runtime_config
        SET apply_token=${token},applying_revision=revision,lease_until=now()+interval '60 seconds',last_error=NULL
        WHERE id=1 AND revision=${input.expectedRevision} AND (apply_token IS NULL OR lease_until <= now()) RETURNING *`
      if (!row) throw new TBError('conflict', 'configuration changed or another application is running')
      let leaseLost = false
      let renewal: Promise<void> = Promise.resolve()
      const heartbeat = setInterval(() => {
        renewal = renewal.then(async () => {
          const result = await this.sql`UPDATE tb_runtime_config SET lease_until=now()+interval '60 seconds'
            WHERE id=1 AND apply_token=${token}`
          if (result.count === 0) leaseLost = true
        }).catch(() => { leaseLost = true })
      }, 20000)
      heartbeat.unref()
      try {
        await this.install(runtimeConfigSchema.parse(row.settings), Number(row.revision))
        await renewal
        if (leaseLost) throw new TBError('conflict', 'configuration application lease changed')
        const published = await this.sql`UPDATE tb_runtime_config SET effective=${this.sql.json(row.settings)},
          applied_revision=${row.revision},apply_token=NULL,applying_revision=NULL,lease_until=NULL,last_error=NULL
          WHERE id=1 AND apply_token=${token}`
        if (published.count === 0) throw new TBError('conflict', 'configuration application lease changed')
        return this.get()
      } catch (error) {
        await this.sql`UPDATE tb_runtime_config SET apply_token=NULL,applying_revision=NULL,lease_until=NULL,
          last_error='runtime configuration could not be applied' WHERE id=1 AND apply_token=${token}`
        // A lost lease/failed publication must restore the authoritative successful snapshot.
        const authority = await this.row()
        if (this.localRevision !== Number(authority.applied_revision)) {
          await this.install(runtimeConfigSchema.parse(authority.effective), Number(authority.applied_revision))
        }
        throw error
      } finally {
        clearInterval(heartbeat)
        await renewal
      }
    })
  }
}
