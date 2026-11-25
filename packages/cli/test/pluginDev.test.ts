import { access, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { type ChildProcess, fork } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initPlugin } from '../src/commands/pluginAuthor'
import { runPluginDev } from '../src/plugin-dev/session'

const host = vi.hoisted(() => ({
  fetch: undefined as ((request: Request) => Promise<Response>) | undefined,
  closed: false,
  children: [] as ChildProcess[],
}))

// Only the TCP listen is replaced. Real FS events drive the live session, the
// CLI worker subprocess loads the SDK, and HTBP requests go to the actual app.
vi.mock('@hono/node-server', () => ({
  createAdaptorServer({ fetch }: { fetch: NonNullable<typeof host.fetch> }) {
    host.fetch = fetch
    const server = new EventEmitter()
    return Object.assign(server, {
      listen() { queueMicrotask(() => server.emit('listening')) },
      address() { return { port: 12345 } },
      close() { host.closed = true },
    })
  },
}))

vi.mock(import('../src/plugin-dev/worker'), async (original) => {
  const worker = await original()
  const cli = fileURLToPath(new URL('../src/index.ts', import.meta.url))
  const tsx = fileURLToPath(import.meta.resolve('tsx'))
  return {
    ...worker,
    startPluginWorker(directory: string) {
      const child = fork(cli, ['plugin', '_dev-worker'], {
        cwd: directory,
        execArgv: ['--import', tsx],
        env: { ...process.env, TSX_TSCONFIG_PATH: fileURLToPath(new URL('../tsconfig.json', import.meta.url)) },
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      })
      child.stderr?.on('data', data => process.stderr.write(data))
      host.children.push(child)
      return child
    },
  }
})

const directories: string[] = []

async function tempDirectory(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'tb-plugin-test-')))
  directories.push(dir)
  return dir
}

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true })
})

it('creates a plugin with an explicit install step and refuses to replace an existing directory', async () => {
  const dir = join(await tempDirectory(), 'Demo Plugin')
  await expect(initPlugin(dir)).resolves.toBe(dir)
  const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  expect(manifest).toMatchObject({
    name: 'demo-plugin',
    main: './src/index.js',
    dependencies: { '@tool-bridge/plugin-sdk': expect.stringMatching(/^\d+\.\d+\.\d+$/) },
  })
  const release = JSON.parse(await readFile(join(dir, 'tool-bridge-plugin.json'), 'utf8'))
  expect(release).toEqual(manifest.toolBridgePlugin)
  expect(release).toEqual({
    schemaVersion: 'tb-plugin-release/v1',
    id: 'demo-plugin',
    version: manifest.version,
    endpoint: 'https://plugins.example.com/demo-plugin/0.1.0',
    healthPath: '/healthz',
  })
  expect(manifest.scripts.start).toBe('node src/server.js')
  expect(await readFile(join(dir, 'README.md'), 'utf8')).toContain('npm install --ignore-scripts')
  await expect(access(join(dir, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(initPlugin(dir)).rejects.toThrow('already exists')
  expect(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))).toEqual(manifest)
})

it('serves SDK calls, keeps the live revision on failure, and reloads tools and contexts with the same key', async () => {
  const root = await tempDirectory()
  const dir = await initPlugin(join(root, 'demo'))
  const profileDir = join(root, 'tool-bridge')
  const profilePath = join(profileDir, 'config.json')
  const profile = JSON.stringify({ current: 'fixture', profiles: { fixture: { baseUrl: 'https://profile.test', sk: 'profile-fixture' } } })
  await mkdir(profileDir)
  await writeFile(profilePath, profile)
  vi.stubEnv('XDG_CONFIG_HOME', root)
  const entry = join(dir, 'src/index.js')
  const helper = join(dir, 'src/message.js')
  const sdk = new URL('../../plugin-sdk/src/index.ts', import.meta.url).href
  const zod = import.meta.resolve('zod/v4')
  const source = (exportId: string) => `
import { createPlugin } from ${JSON.stringify(sdk)}
import { z } from ${JSON.stringify(zod)}
import { greeting } from './message.js'
const plugin = createPlugin({ token: env => env.PLUGIN_TOKEN })
plugin.tools(${JSON.stringify(exportId)}).auth({ kind: 'none' }).register('greet', {
  effect: 'read',
  inputSchema: z.object({ name: z.string() }),
}, ({ name }) => ({ message: greeting + name }))
plugin.context('notes', { auth: { kind: 'none' }, get: ({ path }) => ({ path, content: greeting }) })
plugin.tools('manual').auth({ kind: 'single', required: true })
export default plugin
`
  await writeFile(helper, 'export const greeting = \'Hello, \'')
  await writeFile(entry, source('actions'))

  const events: Array<{ envFile?: string, event: string, mounts: string[], source?: string }> = []
  const output: string[] = []
  const diagnostics: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output.push(String(chunk))
    if (typeof chunk === 'string' && chunk.startsWith('{"event":')) events.push(JSON.parse(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    diagnostics.push(String(chunk))
    return true
  })
  const abort = new AbortController()
  const session = runPluginDev(dir, true, abort.signal)
  // Attach immediately so a startup regression fails the test, never the runner.
  void session.catch(() => {})
  let sessionKey: string | undefined
  const call = async (path: string, body?: unknown, key = sessionKey) => {
    const headers = new Headers({ 'accept': 'application/json', 'content-type': 'application/json' })
    if (key !== undefined) headers.set('authorization', `Bearer ${key}`)
    return await host.fetch!(new Request(`http://127.0.0.1/${path}`, body === undefined
      ? { headers }
      : { headers, method: 'POST', body: JSON.stringify(body) }))
  }

  try {
    await Promise.race([
      session.catch((error) => {
        throw new Error(`${error.message}\n${diagnostics.join('')}`, { cause: error })
      }),
      vi.waitFor(() => {
        expect(events[0]).toMatchObject({
          event: 'ready',
          mounts: ['dev/actions', 'dev/notes'],
          manualExports: ['manual'],
          source: expect.stringMatching(/^source /),
        })
      }, { timeout: 5000 }),
    ])
    const envFile = events[0]!.envFile!
    expect((await stat(envFile)).mode & 0o777).toBe(0o600)
    const credentials = await readFile(envFile, 'utf8')
    expect(credentials).toContain('export TB_BASE_URL=\'http://127.0.0.1:12345\'')
    sessionKey = /^export TB_SK='(tbk_[^']+)'$/m.exec(credentials)?.[1]
    expect(typeof sessionKey).toBe('string')
    expect(output.join('').includes(sessionKey!)).toBe(false)
    expect((await call('dev/~tree', undefined, 'wrong-key')).status).toBe(401)
    expect(await (await call('dev/actions/~help')).json()).toMatchObject({ cmds: [{ name: 'greet' }] })
    expect(await (await call('dev/actions/greet', { name: 'Ada' })).json()).toEqual({ message: 'Hello, Ada' })
    expect(await (await call('dev/notes/get', { path: 'item' })).json()).toMatchObject({ content: 'Hello, ' })

    const keyResult = await (await call('system/sk/write', { owner: 'local test', scopes: [{ pattern: '**', actions: ['read', 'call'] }] })).json()
    expect(keyResult).toMatchObject({ secret: expect.stringMatching(/^tbk_/) })

    await writeFile(entry, 'export default {')
    await vi.waitFor(() => {
      expect(diagnostics.join('')).toContain('Still serving the previous version')
    }, { timeout: 5000 })
    expect(events).toHaveLength(1)
    expect(await (await call('dev/actions/greet', { name: 'Ada' })).json()).toEqual({ message: 'Hello, Ada' })

    await writeFile(entry, source('invalid export id'))
    await vi.waitFor(() => {
      expect(diagnostics.join('')).toContain('~describe')
    }, { timeout: 5000 })
    expect(events).toHaveLength(1)
    expect(await (await call('dev/actions/greet', { name: 'Ada' })).json()).toEqual({ message: 'Hello, Ada' })

    await writeFile(helper, 'export const greeting = \'Hi, \'')
    await writeFile(entry, source('new-actions'))
    await vi.waitFor(() => {
      expect(events.at(-1)).toMatchObject({ event: 'reloaded', mounts: ['dev/new-actions', 'dev/notes'] })
    }, { timeout: 5000 })
    expect((await call('dev/actions/~help')).status).toBe(404)
    expect(await (await call('dev/new-actions/greet', { name: 'Ada' }, keyResult.secret)).json()).toEqual({ message: 'Hi, Ada' })
    expect(await readFile(envFile, 'utf8')).toBe(credentials)
    expect(diagnostics.join('').includes(sessionKey!)).toBe(false)
  } finally {
    abort.abort()
    await session.catch(() => {})
  }
  await vi.waitFor(() => {
    expect(host.closed).toBe(true)
    for (const child of host.children) expect(child.connected).toBe(false)
  })
  await expect(access(events[0]!.envFile!)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(profilePath, 'utf8')).toBe(profile)
}, 15000)
