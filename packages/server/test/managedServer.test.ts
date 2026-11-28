import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTimeout as delay } from 'node:timers/promises'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postgres from 'postgres'
import { WebSocket } from 'ws'
import { BootstrapLockBusyError, BootstrapStateStore } from '../src/bootstrapState'
import { testS3Config, testServerConfig } from './helpers/server'
import { createManagedServer } from '../src/managedServer'
import * as fence from '../src/pgMaintenanceFence'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  try {
    for (const fn of cleanup.splice(0).reverse()) await fn()
  } finally {
    vi.restoreAllMocks()
  }
})
async function fresh(existingDirectory?: string) {
  const directory = existingDirectory ?? await mkdtemp(join(tmpdir(), 'tb-managed-'))
  if (!existingDirectory) cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const server = await createManagedServer({
    directory,
    host: '127.0.0.1',
    port: 0,
  })
  cleanup.push(() => server.close())
  const { port } = await server.start()
  return { server, directory, base: `http://127.0.0.1:${port}` }
}
async function post(
  base: string,
  path: string,
  body: unknown,
  token?: string,
  admin?: string,
) {
  return fetch(base + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
      ...(token ? { 'x-tb-setup-token': token } : {}),
      ...(admin ? { authorization: `Bearer ${admin}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

async function installedOwner() {
  const owner = await fresh()
  const config = await testServerConfig({ dataDir: owner.directory })
  await owner.server.store.write('install-defaults.json', {
    databaseUrl: config.databaseUrl, storage: testS3Config(),
  })
  const token = (await readFile(join(owner.directory, 'pairing-token'), 'utf8')).trim()
  const setup = await post(owner.base, '/~setup/configure', {}, token)
  expect(setup.status).toBe(200)
  const { adminSk } = await setup.json() as { adminSk: string }
  return { ...owner, adminSk, databaseUrl: config.databaseUrl! }
}

describe('single-instance gateway handoff', () => {
  it('keeps a live owner serving, refuses paired writes on the waiter, then comes online automatically', async () => {
    const owner = await installedOwner()
    const previous = await owner.server.store.state()
    const token = await owner.server.store.createLocalPairing('recovery')
    const acquire = fence.acquireRuntimeLease
    const attempts = vi.spyOn(fence, 'acquireRuntimeLease').mockImplementation(async (...args) => {
      // No maintenance writer can enter between reading keys and PG admission,
      // including on the very first call and on the successful takeover.
      await expect(owner.server.store.exclusive(async () => {})).rejects.toBeInstanceOf(BootstrapLockBusyError)
      return acquire(...args)
    })
    const started = Date.now()
    const standby = await fresh(owner.directory)
    await expect.poll(() => attempts.mock.calls.length, { timeout: 10000 }).toBeGreaterThanOrEqual(2)
    expect(Date.now() - started).toBeGreaterThanOrEqual(1000)
    expect((await fetch(owner.base + '/readyz')).status).toBe(200)
    const ready = await fetch(standby.base + '/readyz')
    expect(ready.status).toBe(503)
    expect(await ready.json()).toEqual({ state: 'starting', ready: false })
    expect(await (await fetch(standby.base + '/~setup/status')).json()).toMatchObject({
      pairingRequired: false, instanceId: previous!.instanceId,
    })
    expect((await post(standby.base, '/~setup/recover', { databaseUrl: owner.databaseUrl }, token)).status).toBe(503)
    expect((await post(standby.base, '/~setup/configure', {}, token)).status).toBe(503)
    expect((await fetch(standby.base + '/~setup/defaults', { headers: { 'x-tb-setup-token': token } })).status).toBe(503)
    expect(await standby.server.store.read('bootstrap-pending.json')).toBeUndefined()
    expect(await standby.server.store.state()).toEqual(previous)
    expect((await post(standby.base, '/system/config/get', {}, undefined, owner.adminSk)).status).toBe(503)
    const replacement = new URL(owner.databaseUrl)
    replacement.searchParams.set('application_name', 'handoff_after_maintenance')
    await owner.server.store.exclusive(async () => {
      await owner.server.close()
      await owner.server.store.write('bootstrap.json', {
        ...previous, databaseUrl: replacement.href, revision: previous!.revision + 1,
      })
    }, 5)
    expect(owner.server.ownershipLost.aborted).toBe(false)
    await expect.poll(async () => (await fetch(standby.base + '/readyz')).status, { timeout: 15000 }).toBe(200)
    expect(attempts.mock.lastCall?.[0].options.connection.application_name).toBe('handoff_after_maintenance')
    expect((await post(standby.base, '/system/config/get', {}, undefined, owner.adminSk)).status).toBe(200)
  })

  it('keeps both a new standby and a retrying standby out of a quiesced key rotation', async () => {
    const owner = await installedOwner()
    const { revision } = (await owner.server.store.state())!
    const waiting = await fresh(owner.directory)
    const retries = vi.spyOn(waiting.server.store, 'exclusive')
    const write = owner.server.store.write.bind(owner.server.store)
    let quiesced!: () => void
    const idle = new Promise<void>((resolve) => {
      quiesced = resolve
    })
    let resume!: () => void
    const resumeRotation = new Promise<void>((resolve) => {
      resume = resolve
    })
    vi.spyOn(owner.server.store, 'write').mockImplementation(async (name, value) => {
      if (name === 'keys.json') {
        quiesced()
        await resumeRotation
      }
      await write(name, value)
    })
    const rotating = post(owner.base, '/system/keys/rotate', {
      target: 'signing', expectedRevision: revision,
    }, undefined, owner.adminSk)
    try {
      await Promise.race([idle, rotating.then((response) => {
        throw new Error(`rotation ended early (${response.status})`)
      })])
      const attempts = vi.spyOn(fence, 'acquireRuntimeLease')
      const cold = await fresh(owner.directory)
      await expect.poll(() => retries.mock.settledResults.some(
        result => result.type === 'rejected' && result.value instanceof BootstrapLockBusyError,
      ), { timeout: 10000 }).toBe(true)
      for (const standby of [cold, waiting]) {
        expect(await (await fetch(standby.base + '/readyz')).json()).toEqual({ ready: false, state: 'starting' })
        await standby.server.close()
      }
      expect(attempts).not.toHaveBeenCalled()
    } finally {
      resume()
      await rotating
    }
    expect((await rotating).status).toBe(200)
    expect(owner.server.ownershipLost.aborted).toBe(false)
    expect((await fetch(owner.base + '/readyz')).status).toBe(200)
  })

  it('cancels an initialized waiter on shutdown even when the owner subsequently exits', async () => {
    const owner = await installedOwner()
    const attempts = vi.spyOn(fence, 'acquireRuntimeLease')
    const standby = await fresh(owner.directory)
    expect(attempts).toHaveBeenCalledTimes(1)
    await expect(attempts.mock.results[0]!.value).rejects.toBeInstanceOf(fence.RuntimeHandoffPendingError)
    expect((await fetch(standby.base + '/readyz')).status).toBe(503)
    await Promise.all([standby.server.shutdown(), standby.server.close(), standby.server.close()])
    expect(standby.server.ownershipLost.aborted).toBe(false)
    await owner.server.close()
    await delay(1200)
    expect(attempts).toHaveBeenCalledTimes(1)
    const sql = postgres(owner.databaseUrl, { max: 1, onnotice: () => {} })
    try {
      expect(await sql`SELECT replica_id FROM tb_runtime_replicas`).toHaveLength(0)
      expect((await standby.server.app.request('/readyz')).status).toBe(503)
    } finally {
      await sql.end({ timeout: 1 })
    }
  })

  it('releases a lease acquired by a retry while close and shutdown are pending', async () => {
    const owner = await installedOwner()
    const standby = await fresh(owner.directory)
    const acquire = fence.acquireRuntimeLease
    let resume!: () => void
    const resumeAdmission = new Promise<void>((resolve) => {
      resume = resolve
    })
    const admission = vi.spyOn(fence, 'acquireRuntimeLease').mockImplementationOnce(async (...args) => {
      await resumeAdmission
      return acquire(...args)
    })
    try {
      await owner.server.close()
      await expect.poll(() => admission.mock.calls.length, { timeout: 5000 }).toBe(1)
      const closing = standby.server.close()
      const shutdown = standby.server.shutdown()
      resume()
      await Promise.all([closing, shutdown])
    } finally {
      resume()
    }
    expect(standby.server.ownershipLost.aborted).toBe(false)
    const sql = postgres(owner.databaseUrl, { max: 1, onnotice: () => {} })
    cleanup.push(() => sql.end({ timeout: 1 }))
    expect(await sql`SELECT replica_id FROM tb_runtime_replicas`).toHaveLength(0)
  })

  it('seals HTTP and device sockets on lease disconnect and leaves the successor as the sole serving runtime', async () => {
    const owner = await installedOwner()
    const sql = postgres(owner.databaseUrl, { max: 1, onnotice: () => {} })
    cleanup.push(() => sql.end({ timeout: 1 }))
    const wsUrl = owner.base.replace('http:', 'ws:') + '/system/device/ws?deviceId=handoff-test'
    const connect = () => new WebSocket(wsUrl, { headers: { authorization: `Bearer ${owner.adminSk}` } })
    const ws = connect()
    cleanup.push(async () => {
      ws.terminate()
    })
    await once(ws, 'open')
    const standby = await fresh(owner.directory)
    // A slow response consumer must not keep the lost lease registered forever.
    const slow = await owner.server.app.request('/~help', { headers: { authorization: `Bearer ${owner.adminSk}` } })
    cleanup.push(async () => slow.body?.cancel())
    expect(slow.status).toBe(200)
    const disconnected = once(ws, 'close', { signal: AbortSignal.timeout(5000) })
    // Kill only the backend holding this test schema's lifetime lock.
    const stopped = await sql`SELECT pg_terminate_backend(pid) AS stopped FROM pg_locks
      WHERE locktype='advisory' AND granted AND mode='ExclusiveLock' AND objsubid=1
        AND objid=(hashtextextended(current_schema() || ':tool-bridge-runtime',7283023) & 4294967295)::oid
        AND classid=((hashtextextended(current_schema() || ':tool-bridge-runtime',7283023) >> 32) & 4294967295)::oid
        AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`
    expect(stopped.map(row => row.stopped)).toEqual([true])
    await disconnected
    expect(owner.server.ownershipLost.aborted).toBe(true)
    expect((await fetch(owner.base + '/livez')).status).toBe(200)
    expect((await fetch(owner.base + '/readyz')).status).toBe(503)
    await expect(once(connect(), 'open')).rejects.toThrow()
    expect((await post(owner.base, '/system/annotation/set', { path: '', text: 'stale' }, undefined, owner.adminSk)).status).toBe(503)
    await expect.poll(async () => (await fetch(standby.base + '/readyz')).status, { timeout: 15000 }).toBe(200)
    await expect.poll(async () => (await sql`SELECT replica_id FROM tb_runtime_replicas`).length).toBe(1)
    expect((await post(standby.base, '/system/config/get', {}, undefined, owner.adminSk)).status).toBe(200)
    expect(await sql`SELECT 1 FROM tb_kv WHERE key='annotation:' AND value->>'text'='stale'`).toHaveLength(0)
    expect((await post(owner.base, '/system/config/get', {}, undefined, owner.adminSk)).status).toBe(503)
  })
})

describe('paired installation independently from PG', () => {
  it('classifies a genuine launch failure and keeps the bootstrap secret out of recovery logs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tb-managed-'))
    cleanup.push(() => rm(directory, { recursive: true, force: true }))
    const store = new BootstrapStateStore(directory)
    await store.finish({ ...await store.initialize(), databaseUrl: 'postgres://127.0.0.1:1/test' })
    await writeFile(store.path('keys.json'), 'test-credential-must-stay-private')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const server = await createManagedServer({ directory })
    cleanup.push(() => server.close())
    expect((await (await server.app.request('/~setup/status')).json()).state).toBe('recovery')
    expect(await (await server.app.request('/readyz')).json()).toEqual({ state: 'recovery', ready: false })
    expect(log.mock.calls).toEqual([[JSON.stringify({
      event: 'tool_bridge_recovery_required', stage: 'launch', reason: 'invalid_json',
    })]])
    expect(await store.read('bootstrap-pending.json')).toBeUndefined()
  })

  it('starts a restricted listener without PG, persists identity/root, and never reveals pairing material', async () => {
    const { server, directory, base } = await fresh()
    const status = await (await fetch(base + '/~setup/status')).json()
    expect(status.state).toBe('setup')
    expect((await fetch(base + '/readyz')).status).toBe(503)
    expect((await post(base, '/system/sk/write', {})).status).toBe(503)
    expect((await post(base, '/~setup/configure', {})).status).toBe(403)
    const keys = await readFile(join(directory, 'keys.json'), 'utf8')
    const identity = await server.store.initialize()
    expect(identity.instanceId).toBe(status.instanceId)
    expect(await readFile(join(directory, 'keys.json'), 'utf8')).toBe(keys)
    expect(JSON.stringify(status)).not.toContain(keys)
    expect((await stat(join(directory, 'keys.json'))).mode & 0o777).toBe(0o600)
    await expect(server.store.createLocalPairing('setup')).resolves.toMatch(
      /^[A-Za-z0-9_-]+$/,
    )
  })

  it('enforces pairing expiry and rejects overlapping installation writers', async () => {
    const { server, directory, base } = await fresh()
    const token = (
      await readFile(join(directory, 'pairing-token'), 'utf8')
    ).trim()
    const pair
      = await server.store.read<Record<string, unknown>>('pairing.json')
    await server.store.write('pairing.json', {
      ...pair,
      expiresAt: Date.now() - 1,
    })
    expect((await post(base, '/~setup/configure', {}, token)).status).toBe(403)
    const next = await server.store.createLocalPairing('setup')
    await server.store.exclusive(async () => {
      expect((await post(base, '/~setup/configure', {}, next)).status).toBe(
        409,
      )
    })
  })

  it('installs from protected defaults, closes pairing, applies revisions, and recovers after restart', async () => {
    const { server, directory, base } = await fresh()
    const config = await testServerConfig({ dataDir: directory })
    await server.store.write('install-defaults.json', {
      databaseUrl: config.databaseUrl,
      storage: testS3Config(),
    })
    const token = (
      await readFile(join(directory, 'pairing-token'), 'utf8')
    ).trim()
    const defaults = await (
      await fetch(base + '/~setup/defaults', {
        headers: { 'x-tb-setup-token': token },
      })
    ).json()
    expect(defaults.databaseConfigured).toBe(true)
    expect(JSON.stringify(defaults)).not.toContain(
      testS3Config().secretAccessKey,
    )
    const response = await post(base, '/~setup/configure', {}, token)
    expect(response.status).toBe(200)
    const installed = await response.json()
    const admin = installed.adminSk as string
    expect(admin).toMatch(/^tb_sk_/)
    expect((await post(base, '/~setup/configure', {}, token)).status).toBe(403)
    await expect(
      server.store.createLocalPairing('setup'),
    ).rejects.toMatchObject({ code: 'permission_denied' })
    const before = await (
      await post(base, '/system/config/get', {}, undefined, admin)
    ).json()
    const changed = { ...before.desired, toolCacheTtlSec: 432 }
    const update = await post(
      base,
      '/system/config/update',
      { expectedRevision: before.revision, settings: changed },
      undefined,
      admin,
    )
    expect(update.status).toBe(200)
    const pending = await update.json()
    expect(pending.state).toBe('pending')
    expect(pending.effective.toolCacheTtlSec).toBe(
      before.effective.toolCacheTtlSec,
    )
    expect(
      (
        await post(
          base,
          '/system/config/update',
          { expectedRevision: before.revision, settings: changed },
          undefined,
          admin,
        )
      ).status,
    ).toBe(409)
    const applied = await post(
      base,
      '/system/config/apply',
      { expectedRevision: pending.revision },
      undefined,
      admin,
    )
    expect((await applied.json()).effective.toolCacheTtlSec).toBe(432)
    const narrow = await (
      await post(
        base,
        '/system/sk/write',
        {
          owner: 'test:ordinary',
          scopes: [{ pattern: '**', actions: ['read', 'call'] }],
        },
        undefined,
        admin,
      )
    ).json()
    expect(
      (await post(base, '/system/config/get', {}, undefined, narrow.secret))
        .status,
    ).toBe(403)
    expect(
      (await post(base, '/system/storage/list', {}, undefined, narrow.secret))
        .status,
    ).toBe(403)
    const identity = (await server.store.state())!.instanceId
    await server.close()
    cleanup.pop()
    const second = await createManagedServer({
      directory,
      host: '127.0.0.1',
      port: 0,
    })
    cleanup.push(() => second.close())
    expect(await (await second.app.request('/readyz')).json()).toMatchObject({ ready: true })
    const port = (await second.start()).port
    expect(
      await (await fetch(`http://127.0.0.1:${port}/~setup/status`)).json(),
    ).toEqual({ state: 'ready', instanceId: identity, pairingRequired: false })
    expect(
      (
        await (
          await post(
            `http://127.0.0.1:${port}`,
            '/system/config/get',
            {},
            undefined,
            admin,
          )
        ).json()
      ).effective.toolCacheTtlSec,
    ).toBe(432)
  }, 30000)

  it('never reopens first-install authorization after an initialized database fails', async () => {
    const { server, directory } = await fresh()
    const state = (await server.store.state())!
    await server.store.write('bootstrap.json', {
      ...state,
      phase: 'initialized',
      databaseUrl: 'postgres://x:x@127.0.0.1:1/x',
    })
    await server.close()
    cleanup.pop()
    const restarted = await createManagedServer({
      directory,
      host: '127.0.0.1',
      port: 0,
    })
    cleanup.push(() => restarted.close())
    const base = `http://127.0.0.1:${(await restarted.start()).port}`
    expect((await (await fetch(base + '/~setup/status')).json()).state).toBe(
      'recovery',
    )
    const token = (
      await readFile(join(directory, 'pairing-token'), 'utf8')
    ).trim()
    expect((await post(base, '/~setup/configure', {}, token)).status).toBe(403)
    await expect(
      restarted.store.createLocalPairing('setup'),
    ).rejects.toMatchObject({ code: 'permission_denied' })
    expect(await restarted.store.createLocalPairing('recovery')).toMatch(
      /^[A-Za-z0-9_-]+$/,
    )
  }, 15000)
})
