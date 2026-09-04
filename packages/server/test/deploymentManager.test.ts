import type { DeploymentSettings } from '@tool-bridge/core'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import postgres, { type Sql } from 'postgres'
import { DeploymentManager } from '../src/deploymentManager'

let admin: Sql
let sql: Sql
let manager: DeploymentManager
const schema = `tb_deployment_${process.pid}_${Date.now()}`
const observed: DeploymentSettings = { image: 'tool-bridge:local', hostPort: 8787, bindAddress: '127.0.0.1' }
const desired: DeploymentSettings = { ...observed, hostPort: 8788 }
const claim = { agentId: 'agent-a', instanceId: 'instance-a', observed }

beforeAll(async () => {
  if (!process.env.TB_TEST_DATABASE_URL) throw new Error('PG test fixture is required')
  admin = postgres(process.env.TB_TEST_DATABASE_URL, { onnotice: () => {} })
  await admin`CREATE SCHEMA ${admin(schema)}`
  sql = postgres(process.env.TB_TEST_DATABASE_URL, { max: 10, onnotice: () => {}, connection: { search_path: schema } })
  manager = new DeploymentManager(sql, 'instance-a')
  await manager.ensureSchema()
})
afterAll(async () => {
  await sql?.end({ timeout: 2 })
  if (admin) {
    await admin`DROP SCHEMA ${admin(schema)} CASCADE`
    await admin.end({ timeout: 2 })
  }
})
beforeEach(async () => {
  await sql`TRUNCATE tb_deployment, tb_deployment_jobs`
  await manager.ensureSchema()
})

describe('deployment job database authority', () => {
  it('starts unmanaged and learns effective settings only from the local agent', async () => {
    expect(await manager.get()).toMatchObject({ state: 'unmanaged', desired: null, effective: null })
    await expect(manager.update({ expectedRevision: 0, settings: desired })).rejects.toMatchObject({ code: 'unavailable' })
    await manager.claim(claim)
    expect(await manager.get()).toMatchObject({ state: 'applied', desired: observed, effective: observed })
  })
  it('competing updates and claims have exactly one winner', async () => {
    await manager.claim(claim)
    const updates = await Promise.allSettled(Array.from({ length: 5 }, () => manager.update({ expectedRevision: 0, settings: desired })))
    expect(updates.filter(value => value.status === 'fulfilled')).toHaveLength(1)
    const claims = await Promise.all(Array.from({ length: 8 }, (_, index) => manager.claim({ ...claim, agentId: `agent-${index}` })))
    expect(claims.filter(value => value.job !== null)).toHaveLength(1)
    expect(await manager.get()).toMatchObject({ effective: observed, desired, state: 'applying' })
  })
  it('rejects wrong identities and tokens, and completes successfully once', async () => {
    await expect(manager.claim({ ...claim, instanceId: 'wrong' })).rejects.toMatchObject({ code: 'conflict' })
    await manager.claim(claim)
    await manager.update({ expectedRevision: 0, settings: desired })
    const job = (await manager.claim(claim)).job!
    await expect(manager.complete({ jobId: job.jobId, leaseToken: 'wrong', ok: true })).rejects.toMatchObject({ code: 'permission_denied' })
    const complete = { jobId: job.jobId, leaseToken: job.leaseToken, ok: true }
    await manager.complete(complete)
    expect(await manager.complete(complete)).toMatchObject({ appliedRevision: 1, effective: desired, state: 'applied' })
    await expect(manager.complete({ ...complete, ok: false })).rejects.toMatchObject({ code: 'conflict' })
    const stored = await sql`SELECT token_hash FROM tb_deployment_jobs`
    expect(stored[0]?.token_hash).not.toBe(job.leaseToken)
  })
  it('failed application preserves effective state and cannot claim expiry as safe to replay', async () => {
    await manager.claim(claim)
    await manager.update({ expectedRevision: 0, settings: desired })
    const job = (await manager.claim(claim)).job!
    await sql`UPDATE tb_deployment_jobs SET lease_until=now()-interval '1 second'`
    expect(await manager.claim({ ...claim, agentId: 'agent-b' })).toEqual({ job: null })
    expect(await manager.get()).toMatchObject({ state: 'failed', effective: observed, job: { error: 'lease_expired' } })
    await expect(manager.complete({ jobId: job.jobId, leaseToken: job.leaseToken, ok: true })).rejects.toMatchObject({ code: 'conflict' })
  })
  it('rejects a queued operation if the actual running configuration changed after it was created', async () => {
    await manager.claim(claim)
    await manager.update({ expectedRevision: 0, settings: desired })
    const externallyChanged = { ...observed, hostPort: 9000 }
    expect(await manager.claim({ ...claim, observed: externallyChanged })).toEqual({ job: null })
    expect(await manager.get()).toMatchObject({ effective: externallyChanged, state: 'failed', job: { error: 'observed_changed' } })
  })
})
