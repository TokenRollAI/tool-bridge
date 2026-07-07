import type { DeviceExpose } from '@tool-bridge/core'
import { defineCommand } from 'citty'
import { globalArgs, repeatableArg, resolveTarget } from '../args'
import { resolveDeviceId } from '../deviceId'
import { runDeviceConnection } from '../deviceRuntime'
import { CliError } from '../http'
import { asArray, guard, printJson, printLine } from '../output'

export interface ConnectArgs {
  [key: string]: unknown
  url?: string
  'base-url'?: string
  sk?: string
  'device-id'?: string
  path?: string
  allow?: string | string[]
  fs?: string | string[]
  'fs-readonly'?: boolean
  'no-shell'?: boolean
  json?: boolean
}

export function buildExpose(args: ConnectArgs): DeviceExpose {
  const expose: DeviceExpose = {}
  if (!args['no-shell']) {
    expose.shell = { allow: asArray(args.allow) }
  }
  const roots = asArray(args.fs)
  if (roots.length > 0) {
    expose.fs = { roots, readOnly: Boolean(args['fs-readonly']) }
  }
  if (expose.shell === undefined && expose.fs === undefined) {
    throw new CliError('nothing to expose: omit --no-shell or pass --fs')
  }
  return expose
}

export async function runConnect(args: ConnectArgs): Promise<void> {
  const target = resolveTarget({
    ...args,
    'base-url': args.url ? String(args.url) : args['base-url'],
  })
  if (!target.baseUrl) {
    throw new CliError('missing base URL: pass URL, --base-url, set TB_BASE_URL, or run tb login')
  }
  if (!target.sk) throw new CliError('missing SK: pass --sk, set TB_SK, or run tb login')
  const deviceId = resolveDeviceId(args['device-id'] ? String(args['device-id']) : undefined)
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
export const connectCommand = defineCommand({
  meta: { name: 'connect', description: 'Connect this machine as a device' },
  args: {
    ...globalArgs,
    url: { type: 'positional', description: 'Gateway base URL', required: false },
    'device-id': { type: 'string', description: 'Override stable local device id' },
    path: { type: 'string', description: 'Mount path (default: device/<device-id>)' },
    allow: { type: 'string', description: 'Allowed shell command (repeatable, or "*")' },
    fs: { type: 'string', description: 'Expose local filesystem root (repeatable)' },
    'fs-readonly': { type: 'boolean', description: 'Expose fs as read-only', default: false },
    'no-shell': { type: 'boolean', description: 'Do not expose shell', default: false },
  },
  async run({ args, rawArgs }) {
    const asJson = Boolean(args.json)
    await guard(asJson, async () =>
      runConnect({
        ...(args as ConnectArgs),
        allow: repeatableArg(args.allow, rawArgs, 'allow'),
        fs: repeatableArg(args.fs, rawArgs, 'fs'),
      }),
    )
  },
})
