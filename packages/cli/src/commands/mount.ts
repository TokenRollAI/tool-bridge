import { defineCommand } from 'citty'
import { globalArgs } from '../args'
import { guard } from '../output'
import { type ConnectArgs, runConnect } from './connect'

export const mountFsCommand = defineCommand({
  meta: { name: 'fs', description: 'Expose a local directory as a device fs context' },
  args: {
    ...globalArgs,
    root: { type: 'positional', description: 'Local directory root', required: true },
    url: { type: 'positional', description: 'Gateway base URL', required: false },
    'device-id': { type: 'string', description: 'Override stable local device id' },
    path: { type: 'string', description: 'Mount path (default: device/<device-id>)' },
    'fs-readonly': { type: 'boolean', description: 'Expose fs as read-only', default: false },
  },
  async run({ args }) {
    const asJson = Boolean(args.json)
    await guard(asJson, async () =>
      runConnect({
        ...(args as ConnectArgs),
        'no-shell': true,
        fs: [String(args.root)],
      }),
    )
  },
})

export const mountCommand = defineCommand({
  meta: { name: 'mount', description: 'Mount local resources through a device connection' },
  subCommands: { fs: mountFsCommand },
})
