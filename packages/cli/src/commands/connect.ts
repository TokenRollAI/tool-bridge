import type { DeviceExpose } from '@tool-bridge/core'
import { Command } from 'commander'
import { collect, resolveTarget, withGlobalOpts } from '../args'
import { asArray, guard, printJson, printLine } from '../output'
import { runDeviceConnection } from '../deviceRuntime'
import { resolveDeviceId } from '../deviceId'
import { CliError } from '../http'

export interface ConnectArgs {
  allow?: string | string[]
  baseUrl?: string
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

/** 长驻设备连接仍展示全局参数，但明确标出其中不适用或互斥的参数。 */
export function withDeviceConnectionGlobalOpts(command: Command): Command {
  const configured = withGlobalOpts(command)
  const baseUrl = configured.options.find(option => option.long === '--base-url')
  const timeout = configured.options.find(option => option.long === '--timeout')
  if (baseUrl) baseUrl.description = 'Gateway base URL (mutually exclusive with positional [url])'
  if (timeout) timeout.description = 'Not supported for this long-running command; rejected if passed'
  return configured
}

export function buildExpose(args: ConnectArgs): DeviceExpose {
  const expose: DeviceExpose = {}
  if (args.shell !== false) {
    expose.shell = { allow: asArray(args.allow) }
  }
  const roots = asArray(args.fs)
  if (roots.length > 0) {
    expose.fs = { roots, readOnly: Boolean(args.fsReadonly) }
  }
  if (expose.shell === undefined && expose.fs === undefined) {
    throw new CliError('nothing to expose: omit --no-shell or pass --fs')
  }
  return expose
}

export async function runConnect(args: ConnectArgs): Promise<void> {
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
  const expose = buildExpose(args)
  const asJson = Boolean(args.json)
  await runDeviceConnection({
    baseUrl: target.baseUrl,
    sk: target.sk,
    deviceId,
    ...(args.path ? { mountPath: String(args.path) } : {}),
    expose,
    onReady: (mountPath) => {
      if (asJson) printJson({ event: 'ready', deviceId, mountPath })
      else printLine(`connected ${deviceId} -> ${mountPath}`)
    },
    onStateChange: (state) => {
      if (asJson) printJson({ event: 'state', state })
      else if (state !== 'ready') printLine(`device state: ${state}`)
    },
  })
}

/** `tb connect [url]` —— 设备反向注册长驻进程。 */
export function connectCommand(): Command {
  return withDeviceConnectionGlobalOpts(new Command('connect'))
    .description(
      'Connect this machine as a device (long-running; exposes shell and/or fs on the tree)',
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
    .option('--no-shell', 'Do not expose shell; mutually exclusive with --allow')
    .addHelpText(
      'after',
      `
Examples:
  tb connect --allow git --allow npm            # shell restricted to git/npm
  tb connect --no-shell --fs ~/projects --fs-readonly
  tb connect --path device/build-01 --allow '*'   # full shell (trusted machines only)`,
    )
    .action(async (url: string | undefined, opts: Omit<ConnectArgs, 'url'>) => {
      await guard(Boolean(opts.json), () => runConnect({ ...opts, url }))
    })
}
