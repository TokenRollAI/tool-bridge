import type { Sql } from 'postgres'
import { type DeploymentManagement, type DeploymentSettings, deploymentSettingsSchema, type DeploymentStatus, TBError } from '@tool-bridge/core'
import { createHash, randomBytes, randomUUID } from 'node:crypto'

interface StateRow { applied_revision: number, desired: DeploymentSettings | null, effective: DeploymentSettings | null, last_seen: string | null, revision: number }
interface JobRow { created_at: string, desired: DeploymentSettings, error: string | null, id: string, lease_until: string | null, previous: DeploymentSettings, revision: number, state: 'queued' | 'claimed' | 'succeeded' | 'failed', token_hash: string | null }
const hash = (token: string) => createHash('sha256').update(token).digest('hex')

/** PostgreSQL serializes configuration changes and agent claims; leases are never blindly replayed. */
export class DeploymentManager implements DeploymentManagement {
  constructor(private readonly sql: Sql, private readonly instanceId: string) {}
  async ensureSchema(): Promise<void> {
    await this.sql`CREATE TABLE IF NOT EXISTS tb_deployment (
      id integer PRIMARY KEY CHECK(id=1), revision bigint NOT NULL DEFAULT 0,
      applied_revision bigint NOT NULL DEFAULT 0, desired jsonb, effective jsonb, last_seen timestamptz
    )`
    await this.sql`INSERT INTO tb_deployment(id) VALUES(1) ON CONFLICT DO NOTHING`
    await this.sql`CREATE TABLE IF NOT EXISTS tb_deployment_jobs (
      id text PRIMARY KEY, revision bigint NOT NULL UNIQUE, desired jsonb NOT NULL, previous jsonb NOT NULL,
      state text NOT NULL CHECK(state IN ('queued','claimed','succeeded','failed')), agent_id text,
      token_hash text, lease_until timestamptz, error text, created_at timestamptz NOT NULL DEFAULT now()
    )`
  }

  async get(): Promise<DeploymentStatus> {
    const [row] = await this.sql<StateRow[]>`SELECT * FROM tb_deployment WHERE id=1`
    if (!row) throw new TBError('unavailable', 'deployment management is not initialized')
    const [job] = await this.sql<JobRow[]>`SELECT * FROM tb_deployment_jobs ORDER BY revision DESC LIMIT 1`
    const connected = row.last_seen !== null && Date.now() - new Date(row.last_seen).getTime() < 30000
    return {
      instanceId: this.instanceId, revision: Number(row.revision), appliedRevision: Number(row.applied_revision),
      desired: row.desired, effective: row.effective, agentConnected: connected,
      state: !row.effective ? 'unmanaged' : job?.state === 'failed' ? 'failed' : !connected ? 'disconnected' : job?.state === 'queued' ? 'pending' : job?.state === 'claimed' ? 'applying' : JSON.stringify(row.desired && deploymentSettingsSchema.parse(row.desired)) !== JSON.stringify(row.effective && deploymentSettingsSchema.parse(row.effective)) ? 'drifted' : 'applied',
      ...(job ? { job: { id: job.id, revision: Number(job.revision), state: job.state, createdAt: new Date(job.created_at).toISOString(), ...(job.error ? { error: job.error } : {}) } } : {}),
    }
  }

  async update(input: Parameters<DeploymentManagement['update']>[0]): Promise<DeploymentStatus> {
    const settings = deploymentSettingsSchema.parse(input.settings)
    await this.sql.begin(async (sql) => {
      const [row] = await sql<StateRow[]>`SELECT * FROM tb_deployment WHERE id=1 FOR UPDATE`
      if (!row || Number(row.revision) !== input.expectedRevision) throw new TBError('conflict', 'deployment revision changed; reload first')
      if (!row.effective) throw new TBError('unavailable', 'connect the local deployment agent before configuring deployment')
      const pending = await sql`SELECT id FROM tb_deployment_jobs WHERE state IN ('queued','claimed') LIMIT 1`
      if (pending.length) throw new TBError('conflict', 'a deployment operation is already pending')
      const next = Number(row.revision) + 1
      await sql`UPDATE tb_deployment SET revision=${next},desired=${sql.json(settings as never)} WHERE id=1`
      await sql`INSERT INTO tb_deployment_jobs(id,revision,desired,previous,state)
        VALUES(${randomUUID()},${next},${sql.json(settings as never)},${sql.json(row.effective as never)},'queued')`
    })
    return this.get()
  }

  async claim(input: Parameters<DeploymentManagement['claim']>[0]): ReturnType<DeploymentManagement['claim']> {
    if (input.instanceId !== this.instanceId) throw new TBError('conflict', 'deployment instance identity mismatch')
    const observed = deploymentSettingsSchema.parse(input.observed)
    return await this.sql.begin(async (sql) => {
      await sql`SELECT id FROM tb_deployment WHERE id=1 FOR UPDATE`
      const active = await sql`SELECT id FROM tb_deployment_jobs WHERE state='claimed' AND lease_until>=now() LIMIT 1`
      if (active.length === 0) {
        await sql`UPDATE tb_deployment SET last_seen=now(),effective=${sql.json(observed as never)},desired=COALESCE(desired,${sql.json(observed as never)}) WHERE id=1`
      } else {
        await sql`UPDATE tb_deployment SET last_seen=now() WHERE id=1`
      }
      await sql`UPDATE tb_deployment_jobs SET state='failed',error='lease_expired' WHERE state='claimed' AND lease_until<now()`
      const [job] = await sql<JobRow[]>`SELECT * FROM tb_deployment_jobs WHERE state='queued' ORDER BY revision LIMIT 1 FOR UPDATE`
      if (!job) return { job: null }
      if (JSON.stringify(deploymentSettingsSchema.parse(job.previous)) !== JSON.stringify(observed)) {
        await sql`UPDATE tb_deployment_jobs SET state='failed',error='observed_changed' WHERE id=${job.id}`
        return { job: null }
      }
      const token = randomBytes(32).toString('base64url')
      const leaseExpiresAt = new Date(Date.now() + 600000).toISOString()
      await sql`UPDATE tb_deployment_jobs SET state='claimed',agent_id=${input.agentId},token_hash=${hash(token)},lease_until=${leaseExpiresAt} WHERE id=${job.id}`
      return { job: { jobId: job.id, instanceId: this.instanceId, revision: Number(job.revision), leaseToken: token, leaseExpiresAt, desired: job.desired, previous: job.previous } }
    }) as Awaited<ReturnType<DeploymentManagement['claim']>>
  }

  async complete(input: Parameters<DeploymentManagement['complete']>[0]): Promise<DeploymentStatus> {
    await this.sql.begin(async (sql) => {
      await sql`SELECT id FROM tb_deployment WHERE id=1 FOR UPDATE`
      const [job] = await sql<JobRow[]>`SELECT * FROM tb_deployment_jobs WHERE id=${input.jobId} FOR UPDATE`
      if (!job || job.token_hash !== hash(input.leaseToken)) throw new TBError('permission_denied', 'invalid deployment lease')
      if (job.state === 'succeeded' || job.state === 'failed') {
        if ((job.state === 'succeeded') !== input.ok) throw new TBError('conflict', 'deployment already completed with a different result')
        return
      }
      if (job.state !== 'claimed' || !job.lease_until || new Date(job.lease_until).getTime() < Date.now()) throw new TBError('conflict', 'deployment lease expired; inspect the running service')
      await sql`UPDATE tb_deployment_jobs SET state=${input.ok ? 'succeeded' : 'failed'},error=${input.ok ? null : input.error ?? 'apply_failed'} WHERE id=${job.id}`
      if (input.ok) await sql`UPDATE tb_deployment SET effective=${sql.json(job.desired as never)},applied_revision=${job.revision},last_seen=now() WHERE id=1`
    })
    return this.get()
  }
}
