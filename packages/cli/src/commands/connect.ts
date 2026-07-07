import type { DeviceExpose } from '@tool-bridge/core'
import { Command } from 'commander'
import { collect, resolveTarget, withGlobalOpts } from '../args'
import { resolveDeviceId } from '../deviceId'
import { runDeviceConnection } from '../deviceRuntime'
import { CliError } from '../http'
import { asArray, guard, printJson, printLine } from '../output'

export interface ConnectArgs {
  url?: string
  baseUrl?: string
  sk?: string
  deviceId?: string
  path?: string
  allow?: string | string[]
  fs?: string | string[]
  fsReadonly?: boolean
  /** `--no-shell` → false;缺省(undefined)= 暴露 shell。 */
  shell?: boolean
  json?: boolean
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
  return withGlobalOpts(new Command('connect'))
    .description('Connect this machine as a device')
    .argument('[url]', 'Gateway base URL')
    .option('--device-id <id>', 'Override stable local device id')
    .option('--path <path>', 'Mount path (default: device/<device-id>)')
    .option('--allow <cmd>', 'Allowed shell command (repeatable, or "*")', collect, [])
    .option('--fs <root>', 'Expose local filesystem root (repeatable)', collect, [])
    .option('--fs-readonly', 'Expose fs as read-only', false)
    .option('--no-shell', 'Do not expose shell')
    .action(async (url: string | undefined, opts: Omit<ConnectArgs, 'url'>) => {
      await guard(Boolean(opts.json), () => runConnect({ ...opts, url }))
    })
}
