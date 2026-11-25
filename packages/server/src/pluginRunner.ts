import { httpsReleaseUrl, pluginImageSchema } from '@tool-bridge/core'
import { getRequestListener } from '@hono/node-server'
import { chmod, readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { bodyLimit } from 'hono/body-limit'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import pRetry from 'p-retry'
import { Hono } from 'hono'
import { z } from 'zod/v4'

// The business server can request an approved release over the Unix socket. Only this host process invokes Docker.
const identity = z.strictObject({
  id: z.string().max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  image: pluginImageSchema,
})
const policySchema = z.strictObject({
  // A dedicated bridge with operator-managed egress rules. Reject Docker's special network modes.
  network: z.string().regex(/^tb-plugins-[a-z0-9-]+$/),
  releases: z.array(identity.extend({
    endpoint: z.string().transform(value => httpsReleaseUrl(value).replace(/\/+$/, '')),
    port: z.int().min(1024).max(65535),
    tokenFile: z.string().startsWith('/'),
  })).min(1),
})
const exec = promisify(execFile)
async function docker(args: string[], pluginToken?: string): Promise<string> {
  const host = process.env.DOCKER_HOST ?? 'unix:///var/run/docker.sock'
  if (!host.startsWith('unix:///')) throw new Error('plugin runner requires a local Docker socket')
  const { stdout } = await exec('docker', ['--host', host, ...args], {
    timeout: args[0] === 'image' && args[1] === 'pull' ? 300_000 : 15_000, maxBuffer: 32 * 1024,
    env: pluginToken === undefined ? process.env : { ...process.env, PLUGIN_TOKEN: pluginToken },
  })
  return stdout.trim()
}

async function checkEndpoint(port: number): Promise<void> {
  // A forwarded Docker port can accept TCP before the plugin can respond.
  const response = await fetch(`http://127.0.0.1:${port}/~auth`, {
    method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(1000),
  })
  if (response.status >= 500) throw new Error('plugin is starting')
}

export function createPluginRunner(policy: unknown, run = docker, ready = checkEndpoint) {
  const { releases, network } = policySchema.parse(policy)
  // Two releases must never point at the same running service or published port.
  for (const values of [releases.map(r => r.endpoint), releases.map(r => r.port), releases.map(r => r.id + ':' + r.image)]) {
    if (new Set<string | number>(values).size !== releases.length) throw new Error('duplicate plugin release identity, endpoint or port')
  }
  const pending = new Map<string, Promise<void>>()
  async function prepare(entry: typeof releases[number], name: string) {
    const listing = await run(['container', 'ls', '--all', '--filter', 'name=^/' + name + '$', '--format', '{{.Names}}'])
    if (listing !== name) {
      const inspectVolumes = () => run(['image', 'inspect', '--format', '{{json .Config.Volumes}}', entry.image])
      let volumes: string
      try {
        volumes = await inspectVolumes()
      } catch (error) {
        // Only a local cache miss authorizes a pull. Other daemon errors fail closed.
        const stderr = (error as { stderr?: unknown })?.stderr
        if (typeof stderr !== 'string' || !/no such (?:image|object)\s*:/i.test(stderr)) throw error
        await run(['image', 'pull', '--quiet', entry.image])
        volumes = await inspectVolumes()
      }
      if (volumes !== 'null' && volumes !== '{}') throw new Error('plugin images must not declare writable volumes')
      const token = (await readFile(entry.tokenFile, 'utf8')).trim()
      if (!token) throw new Error('missing plugin credential')
      // Create only from the digest whose image configuration was checked above.
      await run(['container', 'create', '--name', name, '--pull', 'never', '--read-only',
        '--user', '65532:65532', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--pids-limit', '64', '--memory', '128m', '--cpus', '0.5',
        '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m', '--network', network,
        '--restart', 'unless-stopped', '--log-opt', 'max-size=4m', '--log-opt', 'max-file=2',
        '--publish', '127.0.0.1:' + entry.port + ':8080', '--env', 'PLUGIN_TOKEN',
        '--env', 'PORT=8080', entry.image], token)
    }
    const image = await run(['container', 'inspect', '--format', '{{.Config.Image}}', name])
    if (image !== entry.image) throw new Error('existing container image mismatch')
    await run(['container', 'start', name])
    await pRetry(() => ready(entry.port), { retries: 7, minTimeout: 100, maxTimeout: 1000 })
  }

  const app = new Hono()
  app.post('/prepare', bodyLimit({ maxSize: 1024 }), async (c) => {
    const request = identity.safeParse(await c.req.json().catch(() => null))
    if (!request.success) return c.body(null, 400)
    const entry = releases.find(r => r.id === request.data.id && r.image === request.data.image)
    if (!entry) return c.body(null, 403)
    const name = 'tb-plugin-' + createHash('sha256').update(JSON.stringify([network, entry])).digest('hex').slice(0, 24)
    try {
      let work = pending.get(name)
      if (!work) {
        work = prepare(entry, name).finally(() => pending.delete(name))
        pending.set(name, work)
      }
      await work
      return c.body(null, 204, { 'X-TB-Plugin-Endpoint': entry.endpoint })
    } catch {
      // execFile errors include Docker arguments; avoid propagating driver or upstream details.
      return c.body(null, 503)
    }
  })
  return app
}

export async function servePluginRunner(policyFile: string, socketPath: string) {
  const app = createPluginRunner(JSON.parse(await readFile(policyFile, 'utf8')))
  const server = createServer(getRequestListener(app.fetch))
  server.requestTimeout = 30_000
  // The operator owns the socket directory and grants its group to the gateway.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
  try {
    await chmod(socketPath, 0o660)
  } catch (error) {
    server.close()
    throw error
  }
  return server
}
