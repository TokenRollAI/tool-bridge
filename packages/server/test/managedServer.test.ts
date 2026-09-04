import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testS3Config, testServerConfig } from './helpers/server'
import { createManagedServer } from '../src/managedServer'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})
async function fresh() {
  const directory = await mkdtemp(join(tmpdir(), 'tb-managed-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
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

describe('paired installation independently from PG', () => {
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
