import type { DeviceExpose } from '@tool-bridge/core'
import {
  createStructuredCommandRuntime,
  parseStructuredCommandProfile,
  type StructuredCommandProfile,
} from '@tool-bridge/core/node'
import { Command, type OptionValues } from 'commander'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { collect, resolveTarget, withGlobalOpts } from '../args'
import { asArray, printJson, printLine } from '../output'
import { runDeviceConnection } from '../deviceRuntime'
import { resolveDeviceId } from '../deviceId'
import { CliError } from '../http'

export interface ConnectArgs {
  allow?: string | string[]
  baseUrl?: string
  commandProfile?: string | string[]
  deviceId?: string
  fs?: string | string[]
  fsReadonly?: boolean
  json?: boolean
  path?: string
  /** `--no-shell` → false;缺省(undefined)= 暴露 shell。 */
  shell?: boolean
  sk?: string
  timeout?: string
  url?: string
}

export interface PreparedConnect {
  baseUrl: string
  commandProfiles?: StructuredCommandProfile[]
  deviceId: string
  expose: DeviceExpose
  mountPath?: string
  sk: string
}

/** 长驻设备连接仍展示全局参数，但明确标出其中不适用或互斥的参数。 */
export function withDeviceConnectionGlobalOpts<
  Args extends unknown[],
  Opts extends OptionValues,
  GlobalOpts extends OptionValues,
>(command: Command<Args, Opts, GlobalOpts>) {
  const configured = withGlobalOpts(command)
  const baseUrl = configured.options.find(option => option.long === '--base-url')
  const timeout = configured.options.find(option => option.long === '--timeout')
  if (baseUrl) baseUrl.description = 'Gateway base URL (mutually exclusive with positional [url])'
  if (timeout) timeout.description = 'Not supported for this long-running command; rejected if passed'
  return configured
}

function pathsConflict(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
}

export function readCommandProfiles(files: readonly string[]): StructuredCommandProfile[] {
  const profiles = files.map((file) => {
    const path = resolve(file)
    let value: unknown
    try {
      value = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      throw new CliError(`cannot read command profile "${path}": ${(error as Error).message}`)
    }
    try {
      return parseStructuredCommandProfile(value)
    } catch (error) {
      throw new CliError(`invalid command profile "${path}": ${(error as Error).message}`)
    }
  })
  for (let index = 0; index < profiles.length; index++) {
    const profile = profiles[index]!
    for (const reserved of ['shell', 'fs']) {
      if (pathsConflict(profile.path, reserved)) {
        throw new CliError(`command profile path '${profile.path}' conflicts with reserved '${reserved}'`)
      }
    }
    for (let other = 0; other < index; other++) {
      if (pathsConflict(profile.path, profiles[other]!.path)) {
        throw new CliError(
          `command profile path '${profile.path}' conflicts with '${profiles[other]!.path}'`,
        )
      }
    }
  }
  return profiles
}

export function buildExpose(
  args: ConnectArgs,
  commandProfiles: readonly StructuredCommandProfile[] = [],
): DeviceExpose {
  const expose: DeviceExpose = {}
  if (args.shell !== false) {
    expose.shell = { allow: asArray(args.allow) }
  }
  const roots = asArray(args.fs)
  if (roots.length > 0) {
    expose.fs = { roots, readOnly: Boolean(args.fsReadonly) }
  }
  if (commandProfiles.length > 0) {
    expose.nodes = commandProfiles.map((profile) => {
      const runtime = createStructuredCommandRuntime(profile)
      return {
        path: runtime.path,
        kind: 'tool',
        description: runtime.description,
        cmds: runtime.cmds,
      }
    })
  }
  if (expose.shell === undefined && expose.fs === undefined && expose.nodes === undefined) {
    throw new CliError(
      'nothing to expose: omit --no-shell, pass --fs, or pass --command-profile',
    )
  }
  return expose
}

/** 前台 connect 与 daemon install 共用的参数/目标解析，避免安全语义漂移。 */
export function prepareConnect(args: ConnectArgs): PreparedConnect {
  if (args.timeout !== undefined) {
    throw new CliError('--timeout does not apply to the long-running connect command')
  }
  if (args.url && args.baseUrl) {
    throw new CliError('URL positional argument and --base-url are mutually exclusive')
  }
  if (args.shell === false && asArray(args.allow).length > 0) {
    throw new CliError('--allow cannot be used with --no-shell')
  }
  if (args.fsReadonly && asArray(args.fs).length === 0) {
    throw new CliError('--fs-readonly requires at least one --fs')
  }
  const target = resolveTarget({
    baseUrl: args.url ? String(args.url) : args.baseUrl,
    sk: args.sk,
  })
  if (!target.baseUrl) {
    throw new CliError('missing base URL: pass URL, --base-url, set TB_BASE_URL, or run tb login')
  }
  if (!target.sk) throw new CliError('missing SK: pass --sk, set TB_SK, or run tb login')
  const deviceId = resolveDeviceId(args.deviceId ? String(args.deviceId) : undefined)
  const commandProfiles = readCommandProfiles(asArray(args.commandProfile))
  const expose = buildExpose(args, commandProfiles)
  return {
    baseUrl: target.baseUrl,
    sk: target.sk,
    deviceId,
    expose,
    ...(commandProfiles.length > 0 ? { commandProfiles } : {}),
    ...(args.path ? { mountPath: String(args.path) } : {}),
  }
}

export async function runConnect(args: ConnectArgs): Promise<void> {
  const prepared = prepareConnect(args)
  const asJson = Boolean(args.json)
  await runDeviceConnection({
    ...prepared,
    onReady: (mountPath) => {
      if (asJson) printJson({ event: 'ready', deviceId: prepared.deviceId, mountPath })
      else printLine(`connected ${prepared.deviceId} -> ${mountPath}`)
    },
    onStateChange: (state) => {
      if (asJson) printJson({ event: 'state', state })
      else if (state !== 'ready') printLine(`device state: ${state}`)
    },
  })
}

/** `tb connect [url]` —— 设备反向注册长驻进程。 */
export function connectCommand() {
  return withDeviceConnectionGlobalOpts(new Command('connect'))
    .description(
      'Connect this machine as a device (long-running; exposes shell, fs, and/or structured commands)',
    )
    .argument('[url]', 'Gateway base URL (mutually exclusive with --base-url)')
    .option('--device-id <id>', 'Override stable local device id')
    .option('--path <path>', 'Mount path (default: device/<device-id>)')
    .option(
      '--allow <cmd>',
      'Allowed shell command (repeatable, or "*"); mutually exclusive with --no-shell',
      collect,
      [],
    )
    .option('--fs <root>', 'Expose local filesystem root (repeatable)', collect, [])
    .option('--fs-readonly', 'Expose fs as read-only; requires at least one --fs', false)
    .option(
      '--command-profile <file>',
      'Expose a strict structured-command JSON profile (repeatable; direct argv, no implicit shell)',
      collect,
      [],
    )
    .option('--no-shell', 'Do not expose shell; mutually exclusive with --allow')
    .addHelpText(
      'after',
      `
Examples:
  tb connect --allow git --allow npm            # shell restricted to git/npm
  tb connect --no-shell --fs ~/projects --fs-readonly
  tb connect --no-shell --command-profile ./device-ops.json
  tb connect --path device/build-01 --allow '*'   # full shell (trusted machines only)`,
    )
    .action(async (url, opts) => {
      await runConnect({ ...opts, url })
    })
}
