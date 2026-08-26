import type { StructuredCommandProfile } from '@tool-bridge/core/node'
import type { DeviceExpose } from '@tool-bridge/core'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { homedir, userInfo } from 'node:os'
import { spawn } from 'node:child_process'
import { runDeviceConnection } from './deviceRuntime'
import { configDir } from './config'
import { CliError } from './http'

export const DAEMON_SERVICE = 'tool-bridge-device.service'

export interface DaemonConfig {
  baseUrl: string
  commandProfiles?: StructuredCommandProfile[]
  deviceId: string
  expose: DeviceExpose
  mountPath?: string
  revision: string
  sk: string
  version: 1
}

export type DaemonConnectionState = 'connecting' | 'ready' | 'reconnecting' | 'error'

export interface DaemonState {
  deviceId: string
  error?: string
  mountPath?: string
  revision: string
  state: DaemonConnectionState
  updatedAt: string
}

export interface DaemonPaths {
  config: string
  state: string
  unit: string
}

export interface ProcessResult {
  exitCode: number
  stderr: string
  stdout: string
}

export type ProcessRunner = (
  executable: string,
  args: string[],
  opts?: { inherit?: boolean },
) => Promise<ProcessResult>

export interface DaemonInstallInput {
  baseUrl: string
  commandProfiles?: StructuredCommandProfile[]
  deviceId: string
  expose: DeviceExpose
  mountPath?: string
  sk: string
}

export interface DaemonStatus {
  active: boolean
  connection: DaemonConnectionState | 'unknown'
  deviceId?: string
  enabled: boolean
  installed: boolean
  mountPath?: string
}

export interface DaemonDeps {
  execArgv: string[]
  getUid: () => number | undefined
  interactive: boolean
  paths: DaemonPaths
  platform: NodeJS.Platform
  runner: ProcessRunner
  username: string
  waitForReady: (paths: DaemonPaths, revision: string) => Promise<DaemonState>
}

function atomicWrite(path: string, content: string, mode: number): void {
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, content, { mode })
  chmodSync(tmp, mode)
  renameSync(tmp, path)
}

function parseJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new CliError(`cannot read daemon file "${path}": ${(error as Error).message}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertDaemonConfig(value: unknown): asserts value is DaemonConfig {
  if (!isRecord(value)
    || value.version !== 1
    || typeof value.baseUrl !== 'string'
    || typeof value.sk !== 'string'
    || typeof value.deviceId !== 'string'
    || typeof value.revision !== 'string'
    || !isRecord(value.expose)
    || (value.commandProfiles !== undefined && !Array.isArray(value.commandProfiles))
    || (value.mountPath !== undefined && typeof value.mountPath !== 'string')) {
    throw new CliError('invalid daemon config')
  }
}

function parseState(path: string): DaemonState | undefined {
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!isRecord(value)
      || typeof value.revision !== 'string'
      || typeof value.deviceId !== 'string'
      || typeof value.state !== 'string'
      || typeof value.updatedAt !== 'string') return undefined
    if (!['connecting', 'ready', 'reconnecting', 'error'].includes(value.state)) return undefined
    return value as unknown as DaemonState
  } catch {
    return undefined
  }
}

export function daemonPaths(): DaemonPaths {
  const daemonDir = join(configDir(), 'daemon')
  return {
    config: join(daemonDir, 'device.json'),
    state: join(daemonDir, 'state.json'),
    unit: join(homedir(), '.config', 'systemd', 'user', DAEMON_SERVICE),
  }
}

/** systemd ExecStart 参数引用：不经 shell，并阻止 $/%% 被二次展开。 */
export function systemdQuote(value: string): string {
  if (/[\0\n\r]/.test(value)) throw new CliError('daemon executable path contains a control character')
  return `"${value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('$', () => '$$')
    .replaceAll('%', () => '%%')}"`
}

export function daemonExecArgv(argv = process.argv, execPath = process.execPath): string[] {
  // 官方 Bun 形态是 build:binary 生成的独立可执行文件；service 直接重启该文件。
  if (typeof process.versions.bun === 'string') return [execPath]
  const entry = argv[1]
  if (!entry) throw new CliError('cannot determine the tb CLI entrypoint for systemd')
  return [execPath, isAbsolute(entry) ? entry : resolve(entry)]
}

export function renderSystemdUnit(execArgv: string[], configPath: string): string {
  const command = [...execArgv, 'daemon', '_run', '--config', configPath]
    .map(systemdQuote)
    .join(' ')
  return `[Unit]
Description=Tool Bridge device connector
Wants=network-online.target
After=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
WorkingDirectory=%h
ExecStart=${command}
Restart=always
RestartSec=5s
KillSignal=SIGTERM

[Install]
WantedBy=default.target
`
}

export const defaultProcessRunner: ProcessRunner = async (executable, args, opts = {}) =>
  await new Promise<ProcessResult>((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      stdio: opts.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    if (!opts.inherit) {
      child.stdout?.on('data', chunk => stdout.push(Buffer.from(chunk)))
      child.stderr?.on('data', chunk => stderr.push(Buffer.from(chunk)))
    }
    child.once('error', rejectPromise)
    child.once('close', code => resolvePromise({
      exitCode: code ?? -1,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }))
  })

export async function waitForDaemonReady(
  paths: DaemonPaths,
  revision: string,
  timeoutMs = 15_000,
  intervalMs = 250,
): Promise<DaemonState> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = parseState(paths.state)
    if (state?.revision === revision) {
      if (state.state === 'ready') return state
      if (state.state === 'error') {
        throw new CliError(`daemon connection failed: ${state.error ?? 'unknown error'}`)
      }
    }
    await new Promise<void>(resolvePromise => setTimeout(resolvePromise, intervalMs))
  }
  throw new CliError(
    `daemon service started but did not become ready within ${Math.round(timeoutMs / 1000)}s; run \`tb daemon logs\``,
  )
}

function defaultDeps(): DaemonDeps {
  return {
    paths: daemonPaths(),
    platform: process.platform,
    username: userInfo().username,
    getUid: () => process.getuid?.(),
    interactive: Boolean(process.stdin.isTTY && process.stderr.isTTY),
    execArgv: daemonExecArgv(),
    runner: defaultProcessRunner,
    waitForReady: waitForDaemonReady,
  }
}

function assertUserSystemd(deps: DaemonDeps): void {
  if (deps.platform !== 'linux') {
    throw new CliError('tb daemon currently supports Linux with systemd only')
  }
  if (deps.getUid() === 0 || process.env.SUDO_USER) {
    throw new CliError('do not run `tb daemon` with sudo/root; install it as the target Linux user')
  }
}

function commandError(executable: string, args: string[], result: ProcessResult): CliError {
  const detail = result.stderr.trim() || result.stdout.trim()
  const suffix = detail ? `: ${detail}` : ''
  return new CliError(`${executable} ${args.join(' ')} failed (exit ${result.exitCode})${suffix}`)
}

async function requiredRun(
  runner: ProcessRunner,
  executable: string,
  args: string[],
  opts?: { inherit?: boolean },
): Promise<ProcessResult> {
  let result: ProcessResult
  try {
    result = await runner(executable, args, opts)
  } catch (error) {
    throw new CliError(`cannot run ${executable}: ${(error as Error).message}`)
  }
  if (result.exitCode !== 0) throw commandError(executable, args, result)
  return result
}

function writeDaemonConfig(paths: DaemonPaths, config: DaemonConfig): void {
  atomicWrite(paths.config, `${JSON.stringify(config, null, 2)}\n`, 0o600)
}

function writeDaemonState(path: string, state: DaemonState): void {
  atomicWrite(path, `${JSON.stringify(state, null, 2)}\n`, 0o600)
}

function readDaemonConfig(path: string): DaemonConfig {
  const value = parseJsonFile(path)
  assertDaemonConfig(value)
  return value
}

interface InstallSnapshot {
  config?: string
  state?: string
  unit?: string
}

function snapshotInstall(paths: DaemonPaths): InstallSnapshot {
  const read = (path: string): string | undefined =>
    existsSync(path) ? readFileSync(path, 'utf8') : undefined
  return {
    config: read(paths.config),
    state: read(paths.state),
    unit: read(paths.unit),
  }
}

async function rollbackInstall(
  deps: DaemonDeps,
  snapshot: InstallSnapshot,
): Promise<void> {
  if (snapshot.unit === undefined) {
    await deps.runner('systemctl', ['--user', 'disable', '--now', DAEMON_SERVICE]).catch(() => {})
  }
  const restore = (path: string, content: string | undefined, mode: number) => {
    if (content === undefined) rmSync(path, { force: true })
    else atomicWrite(path, content, mode)
  }
  restore(deps.paths.config, snapshot.config, 0o600)
  restore(deps.paths.state, snapshot.state, 0o600)
  restore(deps.paths.unit, snapshot.unit, 0o644)
  await deps.runner('systemctl', ['--user', 'daemon-reload']).catch(() => {})
  if (snapshot.unit !== undefined && snapshot.config !== undefined) {
    await deps.runner('systemctl', ['--user', 'restart', DAEMON_SERVICE]).catch(() => {})
  }
}

async function probe(
  runner: ProcessRunner,
  args: string[],
): Promise<boolean> {
  try {
    const result = await runner('systemctl', args)
    if (result.exitCode === 0) return true
    if (result.stderr.trim()) throw commandError('systemctl', args, result)
    return false
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError(`cannot run systemctl: ${(error as Error).message}`)
  }
}

export async function daemonStatus(overrides: Partial<DaemonDeps> = {}): Promise<DaemonStatus> {
  const deps = { ...defaultDeps(), ...overrides }
  assertUserSystemd(deps)
  const installed = existsSync(deps.paths.unit) && existsSync(deps.paths.config)
  if (!installed) {
    return { installed: false, enabled: false, active: false, connection: 'unknown' }
  }
  const config = readDaemonConfig(deps.paths.config)
  const state = parseState(deps.paths.state)
  const enabled = await probe(
    deps.runner,
    ['--user', 'is-enabled', '--quiet', DAEMON_SERVICE],
  )
  const active = await probe(
    deps.runner,
    ['--user', 'is-active', '--quiet', DAEMON_SERVICE],
  )
  return {
    installed,
    enabled,
    active,
    connection: active && state?.revision === config.revision ? state.state : 'unknown',
    deviceId: config.deviceId,
    mountPath: state?.revision === config.revision ? state.mountPath : config.mountPath,
  }
}

export async function installDaemon(
  input: DaemonInstallInput,
  overrides: Partial<DaemonDeps> = {},
): Promise<DaemonStatus> {
  const deps = { ...defaultDeps(), ...overrides }
  assertUserSystemd(deps)
  const config: DaemonConfig = {
    version: 1,
    revision: crypto.randomUUID(),
    baseUrl: input.baseUrl,
    sk: input.sk,
    deviceId: input.deviceId,
    expose: input.expose,
    ...(input.commandProfiles !== undefined ? { commandProfiles: input.commandProfiles } : {}),
    ...(input.mountPath !== undefined ? { mountPath: input.mountPath } : {}),
  }
  const linger = await requiredRun(
    deps.runner,
    'loginctl',
    ['show-user', deps.username, '--property=Linger', '--value'],
  )
  if (linger.stdout.trim() !== 'yes') {
    try {
      await requiredRun(deps.runner, 'loginctl', ['enable-linger', deps.username])
    } catch (error) {
      if (deps.interactive) {
        await requiredRun(
          deps.runner,
          'sudo',
          ['loginctl', 'enable-linger', deps.username],
          { inherit: true },
        )
      } else {
        throw new CliError(
          `${(error as Error).message}; enable it with: sudo loginctl enable-linger ${deps.username}`,
        )
      }
    }
  }
  await requiredRun(deps.runner, 'systemctl', ['--user', 'show-environment'])

  const snapshot = snapshotInstall(deps.paths)
  writeDaemonConfig(deps.paths, config)
  rmSync(deps.paths.state, { force: true })
  atomicWrite(deps.paths.unit, renderSystemdUnit(deps.execArgv, deps.paths.config), 0o644)
  try {
    await requiredRun(deps.runner, 'systemctl', ['--user', 'daemon-reload'])
    await requiredRun(deps.runner, 'systemctl', ['--user', 'enable', DAEMON_SERVICE])
    // restart 对新装与已 active 的幂等更新都成立；enable --now 不会重启旧进程。
    await requiredRun(deps.runner, 'systemctl', ['--user', 'restart', DAEMON_SERVICE])
    await requiredRun(deps.runner, 'systemctl', ['--user', 'is-active', '--quiet', DAEMON_SERVICE])
    const ready = await deps.waitForReady(deps.paths, config.revision)
    const status = await daemonStatus(deps)
    return {
      ...status,
      connection: ready.state,
      mountPath: ready.mountPath ?? status.mountPath,
    }
  } catch (error) {
    await rollbackInstall(deps, snapshot)
    throw error
  }
}

export async function restartDaemon(overrides: Partial<DaemonDeps> = {}): Promise<DaemonStatus> {
  const deps = { ...defaultDeps(), ...overrides }
  assertUserSystemd(deps)
  if (!existsSync(deps.paths.unit) || !existsSync(deps.paths.config)) {
    throw new CliError('daemon is not installed; run `tb daemon install` first')
  }
  rmSync(deps.paths.state, { force: true })
  await requiredRun(deps.runner, 'systemctl', ['--user', 'restart', DAEMON_SERVICE])
  await requiredRun(deps.runner, 'systemctl', ['--user', 'is-active', '--quiet', DAEMON_SERVICE])
  const config = readDaemonConfig(deps.paths.config)
  const ready = await deps.waitForReady(deps.paths, config.revision)
  const status = await daemonStatus(deps)
  return {
    ...status,
    connection: ready.state,
    mountPath: ready.mountPath ?? status.mountPath,
  }
}

export async function uninstallDaemon(
  overrides: Partial<DaemonDeps> = {},
): Promise<{ removed: boolean }> {
  const deps = { ...defaultDeps(), ...overrides }
  assertUserSystemd(deps)
  const removed = existsSync(deps.paths.unit) || existsSync(deps.paths.config)
  const stopped = await deps.runner('systemctl', [
    '--user',
    'disable',
    '--now',
    DAEMON_SERVICE,
  ])
  if (stopped.exitCode !== 0 && !/not loaded|does not exist|not found/i.test(stopped.stderr)) {
    throw commandError('systemctl', ['--user', 'disable', '--now', DAEMON_SERVICE], stopped)
  }
  rmSync(deps.paths.unit, { force: true })
  rmSync(deps.paths.config, { force: true })
  rmSync(deps.paths.state, { force: true })
  await requiredRun(deps.runner, 'systemctl', ['--user', 'daemon-reload'])
  return { removed }
}

export async function daemonLogs(
  opts: { follow?: boolean, lines: number },
  overrides: Partial<DaemonDeps> = {},
): Promise<void> {
  const deps = { ...defaultDeps(), ...overrides }
  assertUserSystemd(deps)
  const args = ['--user', '--unit', DAEMON_SERVICE, '--lines', String(opts.lines)]
  if (opts.follow) args.push('--follow')
  else args.push('--no-pager')
  await requiredRun(deps.runner, 'journalctl', args, { inherit: true })
}

export async function runDaemon(configPath: string): Promise<void> {
  if (!isAbsolute(configPath)) throw new CliError('daemon config path must be absolute')
  const config = readDaemonConfig(configPath)
  const statePath = join(dirname(configPath), 'state.json')
  const update = (state: DaemonConnectionState, extra: Partial<DaemonState> = {}) => {
    writeDaemonState(statePath, {
      revision: config.revision,
      deviceId: config.deviceId,
      state,
      updatedAt: new Date().toISOString(),
      ...extra,
    })
  }
  update('connecting', { mountPath: config.mountPath })
  try {
    await runDeviceConnection({
      baseUrl: config.baseUrl,
      sk: config.sk,
      deviceId: config.deviceId,
      expose: config.expose,
      ...(config.commandProfiles !== undefined ? { commandProfiles: config.commandProfiles } : {}),
      ...(config.mountPath !== undefined ? { mountPath: config.mountPath } : {}),
      onReady: mountPath => update('ready', { mountPath }),
      onStateChange: (state) => {
        if (state === 'reconnecting') update('reconnecting', { mountPath: config.mountPath })
      },
    })
  } catch (error) {
    update('error', { error: error instanceof Error ? error.message : String(error) })
    throw error
  }
}
