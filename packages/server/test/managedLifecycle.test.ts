import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postgres from 'postgres'
import { testS3Config, testServerConfig } from './helpers/server'
import { BootstrapStateStore } from '../src/bootstrapState'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function executable() {
  const directory = await mkdtemp(join(tmpdir(), 'tb-lifecycle-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const bootstrap = new BootstrapStateStore(directory)
  await bootstrap.initialize()
  const config = await testServerConfig({ dataDir: directory })
  await bootstrap.write('install-defaults.json', {
    databaseUrl: config.databaseUrl,
    storage: testS3Config(),
  })
  const socket = createServer()
  const port = await new Promise<number>((resolve) => {
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address()
      if (!address || typeof address === 'string') throw new Error('no test port')
      resolve(address.port)
    })
  })
  await new Promise<void>(resolve => socket.close(() => resolve()))
  const child = spawn(process.execPath, [
    '--import', 'tsx', fileURLToPath(new URL('../src/main.ts', import.meta.url)),
    '--directory', directory, '--port', String(port),
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let beganDraining!: () => void
  const draining = new Promise<void>((resolve) => {
    beganDraining = resolve
  })
  child.stdout.on('data', (chunk: Buffer) => {
    if (chunk.toString().includes('tool_bridge_draining')) beganDraining()
  })
  let exited = false
  const exit = new Promise<{ code: number | null, signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => {
      exited = true
      resolve({ code, signal })
    })
  })
  cleanup.push(async () => {
    if (!exited) child.kill('SIGKILL')
    await exit
  })
  const base = `http://127.0.0.1:${port}`
  await vi.waitFor(async () => {
    expect(exited).toBe(false)
    expect((await fetch(base + '/livez')).status).toBe(200)
  }, { timeout: 15000, interval: 50 })
  const token = (await readFile(join(directory, 'pairing-token'), 'utf8')).trim()
  const installed = await fetch(base + '/~setup/configure', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tb-setup-token': token },
    body: JSON.stringify({ settings: { shutdownDrainSec: 0 } }),
  })
  expect(installed.status).toBe(200)
  const { adminSk } = await installed.json() as { adminSk: string }
  const post = async (path: string, body: unknown = {}) => fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept': 'application/json', 'authorization': `Bearer ${adminSk}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(3000),
  })
  return { base, child, databaseUrl: config.databaseUrl, draining, exit, post }
}

describe('managed executable lifecycle', () => {
  it('encoded, case-normalized and aliased key commands never wait on their own HTTP request', async () => {
    const f = await executable()
    const alias = await f.post('/system/registry/write', {
      path: 'ops/vault', kind: 'builtin', description: 'maintenance alias regression',
      config: { kind: 'builtin', module: 'keys' },
    })
    expect(alias.status).toBe(200)
    for (const path of ['/system/%6beys/rotate', '/SYSTEM/KEYS/rotate', '/ops/vault/rotate']) {
      const status = await (await f.post('/system/keys/status')).json() as { revision: number }
      const response = await f.post(path, { expectedRevision: status.revision, target: 'signing' })
      expect(response.status, path).toBe(200)
      expect((await f.post('/system/config/get')).status).toBe(200)
      expect((await fetch(f.base + '/readyz')).status).toBe(200)
    }
  })

  it('SIGTERM uses the applied drain interval, keeps serving during it, and ignores pending settings', async () => {
    const f = await executable()
    const initial = await (await f.post('/system/config/get')).json()
    const update = await (await f.post('/system/config/update', {
      expectedRevision: initial.revision,
      settings: { ...initial.desired, shutdownDrainSec: 2 },
    })).json()
    const applied = await f.post('/system/config/apply', { expectedRevision: update.revision })
    expect(applied.status).toBe(200)
    expect((await applied.json()).effective.shutdownDrainSec).toBe(2)
    expect((await f.post('/system/config/update', {
      expectedRevision: update.revision,
      settings: { ...initial.desired, shutdownDrainSec: 10 },
    })).status).toBe(200)
    const started = Date.now()
    f.child.kill('SIGTERM')
    await vi.waitFor(async () => {
      expect((await fetch(f.base + '/readyz')).status).toBe(503)
    }, { timeout: 1000, interval: 20 })
    expect((await fetch(f.base + '/livez')).status).toBe(200)
    expect((await f.post('/system/config/get')).status).toBe(200)
    f.child.kill('SIGTERM')
    expect(await f.exit).toEqual({ code: 0, signal: null })
    expect(Date.now() - started).toBeGreaterThanOrEqual(1800)
    expect(Date.now() - started).toBeLessThan(8000)
  })

  it('maintenance waits for other writes and a concurrent SIGTERM closes the reloaded runtime', async () => {
    const f = await executable()
    expect((await f.post('/system/annotation/set', { path: '', text: 'before' })).status).toBe(200)
    const status = await (await f.post('/system/keys/status')).json() as { revision: number }
    const sql = postgres(f.databaseUrl!, { max: 2, onnotice: () => {} })
    cleanup.push(() => sql.end({ timeout: 2 }))
    let unlock!: () => void
    let entered!: (pid: number) => void
    const barrier = new Promise<void>((resolve) => {
      unlock = resolve
    })
    const locked = new Promise<number>((resolve) => {
      entered = resolve
    })
    const holding = sql.begin(async (tx) => {
      await tx`SELECT key FROM tb_kv WHERE key='annotation:' FOR UPDATE`
      const [row] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
      entered(row!.pid)
      await barrier
    })
    const pid = await locked
    const writing = f.post('/system/annotation/set', { path: '', text: 'after drain' })
    let rotationFinished = false
    let rotating: Promise<Response> | undefined
    try {
      await vi.waitFor(async () => {
        const [row] = await sql<{ blocked: boolean }[]>`SELECT EXISTS(
          SELECT 1 FROM pg_stat_activity WHERE ${pid}=ANY(pg_blocking_pids(pid))) AS blocked`
        expect(row?.blocked).toBe(true)
      }, { timeout: 1000, interval: 20 })
      rotating = f.post('/system/%6beys/rotate', { expectedRevision: status.revision, target: 'signing' })
        .finally(() => { rotationFinished = true })
      await vi.waitFor(async () => {
        expect((await fetch(f.base + '/readyz')).status).toBe(503)
      }, { timeout: 1000, interval: 20 })
      expect(rotationFinished).toBe(false)
      f.child.kill('SIGTERM')
      await f.draining
    } finally {
      unlock()
      await holding
    }
    expect((await writing).status).toBe(200)
    expect((await rotating!).status).toBe(200)
    expect(await f.exit).toEqual({ code: 0, signal: null })
    const [note] = await sql<{ text: string }[]>`SELECT value->>'text' AS text FROM tb_kv WHERE key='annotation:'`
    expect(note?.text).toBe('after drain')
    const replicas = await sql`SELECT replica_id FROM tb_runtime_replicas`
    expect(replicas).toHaveLength(0)
  })
})
