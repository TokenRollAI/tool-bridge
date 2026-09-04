import { createSetupClient, type DeploymentClaim, type DeploymentSettings, type DeploymentStatus } from '@tool-bridge/sdk/client'
import { chmod, lstat, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { parseDocument } from 'yaml'
import pRetry from 'p-retry'
import { callDirect, CliError, getFetch, type Target } from './http'
import { printLine } from './output'

interface Volume { read_only?: boolean, source?: string, target: string, type: string }
interface ComposeService { image?: string, ports?: Array<{ host_ip?: string, published: string, target: number }>, volumes?: Volume[] }
interface ComposeConfig { services?: { app?: ComposeService } }
interface AgentOptions { compose: string, once?: boolean, target: Target }

async function docker(args: string[], cwd: string, timeout = 180000): Promise<string> {
  return await new Promise((resolveResult, reject) => {
    execFile('docker', args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(new CliError('Docker operation failed; inspect the deployment host logs'))
      else resolveResult(stdout)
    })
  })
}
function observedSettings(service: ComposeService): DeploymentSettings {
  const port = service.ports?.find(value => Number(value.target) === 8787)
  if (!service.image || !port || !Number.isInteger(Number(port.published))) throw new CliError('Compose app must declare its image and published port for container port 8787')
  if (service.volumes?.some(volume => /docker\.sock/.test(`${volume.source ?? ''} ${volume.target}`))) throw new CliError('the app service must not mount the Docker socket')
  const state = service.volumes?.find(value => value.target === '/data' && value.type === 'bind')
  const ui = service.volumes?.find(value => value.target === '/app/dashboard' && value.type === 'bind')
  return {
    image: service.image, hostPort: Number(port.published), bindAddress: port.host_ip === '127.0.0.1' ? '127.0.0.1' : '0.0.0.0',
    ...(state?.source ? { stateDirectory: state.source } : {}), ...(ui?.source ? { uiDirectory: ui.source } : {}),
  }
}
async function runningSettings(compose: string, cwd: string): Promise<DeploymentSettings> {
  const id = (await docker(['compose', '-f', compose, 'ps', '-q', 'app'], cwd)).trim()
  if (!/^[a-f0-9]{12,64}$/.test(id)) throw new CliError('the deployment agent requires exactly one running app container')
  const containers = JSON.parse(await docker(['inspect', '--type', 'container', id], cwd)) as Array<{
    Config: { Image: string }
    Mounts: Array<{ Destination: string, Source: string, Type: string }>
    NetworkSettings: { Ports: Record<string, Array<{ HostIp: string, HostPort: string }> | null> }
  }>
  const container = containers[0]
  const binding = container?.NetworkSettings.Ports['8787/tcp']?.[0]
  if (!container || !binding) throw new CliError('running app does not publish container port 8787')
  return observedSettings({
    image: container.Config.Image,
    ports: [{ target: 8787, published: binding.HostPort, host_ip: binding.HostIp }],
    volumes: container.Mounts.map(mount => ({ type: mount.Type, source: mount.Source, target: mount.Destination })),
  })
}
export async function approvedDirectory(value: string, root: string): Promise<string> {
  const approvedRoot = await realpath(root)
  const path = await realpath(value)
  const part = relative(approvedRoot, path)
  if (!isAbsolute(value) || part === '' || part === '..' || part.startsWith('../') || isAbsolute(part)) throw new CliError('mount directories must be inside the selected Compose directory')
  return path
}
export async function updatedCompose(source: string, settings: DeploymentSettings, service: ComposeService, root: string): Promise<string> {
  const document = parseDocument(source)
  if (document.errors.length || !document.hasIn(['services', 'app'])) throw new CliError('invalid Compose document or missing app service')
  document.setIn(['services', 'app', 'image'], settings.image)
  document.setIn(['services', 'app', 'ports'], [{ target: 8787, published: String(settings.hostPort), host_ip: settings.bindAddress, protocol: 'tcp' }])
  if (settings.stateDirectory || settings.uiDirectory) {
    const volumes = [...service.volumes ?? []]
    for (const [directory, target] of [[settings.stateDirectory, '/data'], [settings.uiDirectory, '/app/dashboard']] as const) {
      if (!directory) continue
      const sourcePath = await approvedDirectory(directory, root)
      const volume: Volume = { type: 'bind', source: sourcePath, target, ...(target === '/app/dashboard' ? { read_only: true } : {}) }
      const index = volumes.findIndex(value => value.target === target)
      if (index === -1) volumes.push(volume)
      else volumes[index] = volume
    }
    document.setIn(['services', 'app', 'volumes'], volumes)
  }
  return document.toString()
}
async function health(baseUrl: string, instanceId: string): Promise<void> {
  await pRetry(async () => {
    try {
      const status = await createSetupClient({ baseUrl, fetcher: getFetch(), timeoutMs: 2000 }).status()
      const response = await getFetch()(`${baseUrl}/healthz`, { redirect: 'error', signal: AbortSignal.timeout(2000) })
      const value = await response.json() as { healthy?: boolean, instanceId?: string }
      if (response.ok && value.healthy && value.instanceId === instanceId && status.state === 'ready') return
    } catch { /* restart failures are retried below without exposing network details */ }
    throw new CliError('deployment health or instance identity check failed')
  }, { retries: 39, factor: 1, minTimeout: 1000, maxTimeout: 1000 })
}
async function secureDirectory(directory: string): Promise<void> {
  await chmod(directory, 0o700)
  for (const entry of await readdir(directory)) {
    const path = join(directory, entry)
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new CliError('bootstrap migration does not accept symlinks')
    if (info.isDirectory()) await secureDirectory(path)
    else if (info.isFile()) await chmod(path, 0o600)
    else throw new CliError('bootstrap migration only accepts files and directories')
  }
}
async function applyJob(job: DeploymentClaim, source: string, config: ComposeService, compose: string, target: Target): Promise<Target> {
  const cwd = dirname(compose)
  const composeArgs = ['compose', '-f', compose]
  let changed = false
  let stoppedForCopy = false
  let failure: 'preflight_failed' | 'apply_failed' | 'health_failed' | 'rollback_failed' = 'preflight_failed'
  const nextBaseUrl = `http://127.0.0.1:${job.desired.hostPort}`
  const previousBaseUrl = `http://127.0.0.1:${job.previous.hostPort}`
  try {
    if (Date.parse(job.leaseExpiresAt) <= Date.now() + 300000) throw new CliError('insufficient deployment lease')
    const next = await updatedCompose(source, job.desired, config, cwd)
    if (job.desired.uiDirectory) {
      const ui = await approvedDirectory(job.desired.uiDirectory, cwd)
      if (!(await stat(join(ui, 'index.html'))).isFile() || !(await stat(join(ui, 'assets'))).isDirectory()) throw new CliError('UI directory must contain index.html and assets')
    }
    try {
      await docker(['image', 'inspect', job.desired.image], cwd)
    } catch {
      await docker(['pull', job.desired.image], cwd)
    }
    if (job.desired.stateDirectory && job.desired.stateDirectory !== job.previous.stateDirectory) {
      const data = await approvedDirectory(job.desired.stateDirectory, cwd)
      if ((await readdir(data)).length !== 0) throw new CliError('new data directory must be empty before migration')
      await docker([...composeArgs, 'stop', 'app'], cwd)
      stoppedForCopy = true
      await docker([...composeArgs, 'cp', 'app:/data/bootstrap', data], cwd)
      await secureDirectory(data)
    }
    await writeFile(compose, next)
    changed = true
    failure = 'apply_failed'
    await docker([...composeArgs, 'config', '--quiet'], cwd)
    if (stoppedForCopy) {
      await docker([...composeArgs, 'run', '--rm', '--no-deps', '--user', '0', '--entrypoint', 'chown', 'app', '1000:1000', '/data'], cwd)
      await docker([...composeArgs, 'run', '--rm', '--no-deps', '--user', '0', '--entrypoint', 'chown', 'app', '-R', '1000:1000', '/data/bootstrap'], cwd)
    }
    await docker([...composeArgs, 'up', '-d', '--no-deps', '--no-build', 'app'], cwd)
    failure = 'health_failed'
    await health(nextBaseUrl, job.instanceId)
    const ui = await getFetch()(`${nextBaseUrl}/ui/`, { redirect: 'error', signal: AbortSignal.timeout(5000) })
    if (!ui.ok || !ui.headers.get('content-type')?.includes('text/html')) throw new CliError('Dashboard failed after deployment')
    await ui.body?.cancel()
  } catch {
    if (changed || stoppedForCopy) {
      try {
        await writeFile(compose, source)
        await docker([...composeArgs, 'up', '-d', '--no-deps', '--no-build', 'app'], cwd)
        await health(previousBaseUrl, job.instanceId)
      } catch { failure = 'rollback_failed' }
    }
    const previousTarget = { ...target, baseUrl: previousBaseUrl }
    try {
      await callDirect(previousTarget, '/system/deployment/complete', { jobId: job.jobId, leaseToken: job.leaseToken, ok: false, error: failure })
    } catch {
      throw new CliError('deployment failed and completion could not be recorded; inspect the host before retrying')
    }
    throw new CliError(`deployment failed: ${failure}`)
  }
  const nextTarget = { ...target, baseUrl: nextBaseUrl }
  try {
    await callDirect(nextTarget, '/system/deployment/complete', { jobId: job.jobId, leaseToken: job.leaseToken, ok: true })
  } catch {
    throw new CliError('deployment is healthy but its receipt could not be confirmed; inspect status before another change')
  }
  printLine(`deployment ${job.revision} applied and instance identity verified`)
  return nextTarget
}

/** Runs only fixed Docker subcommands for one explicitly selected Compose app service. */
export async function runDeploymentAgent(options: AgentOptions): Promise<void> {
  const compose = await realpath(resolve(options.compose))
  const cwd = dirname(compose)
  const agentId = randomUUID()
  let target = options.target
  const status = await callDirect<DeploymentStatus>(target, '/system/deployment/get')
  let stopped = false
  const stop = () => {
    stopped = true
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    do {
      const raw = await docker(['compose', '-f', compose, 'config', '--format', 'json'], cwd)
      const config = JSON.parse(raw) as ComposeConfig
      if (!config.services?.app) throw new CliError('Compose app service is missing')
      const configured = observedSettings(config.services.app)
      const observed = await runningSettings(compose, cwd)
      if (JSON.stringify(configured) !== JSON.stringify(observed)) throw new CliError('Compose settings differ from the running app; reconcile them before connecting the agent')
      await health(`http://127.0.0.1:${observed.hostPort}`, status.instanceId)
      const claim = await callDirect<{ job: DeploymentClaim | null }>(target, '/system/deployment/claim', { agentId, instanceId: status.instanceId, observed })
      if (claim.job) {
        const source = await readFile(compose, 'utf8')
        // The source may contain deployment credentials; keep its permissions private while applying.
        await chmod(compose, 0o600)
        target = await applyJob(claim.job, source, config.services.app, compose, target)
      }
      if (options.once || stopped) break
      await delay(5000)
    } while (!stopped)
  } finally {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }
}
