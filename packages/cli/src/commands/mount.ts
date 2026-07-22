import { Command } from 'commander'
import { type ConnectArgs, runConnect, withDeviceConnectionGlobalOpts } from './connect'
import { guard } from '../output'

export function mountFsCommand(): Command {
  return withDeviceConnectionGlobalOpts(new Command('fs'))
    .description('Expose a local directory as a device fs context')
    .argument('<root>', 'Local directory root')
    .argument('[url]', 'Gateway base URL (mutually exclusive with --base-url)')
    .option('--device-id <id>', 'Override stable local device id')
    .option('--path <path>', 'Mount path (default: device/<device-id>)')
    .option('--fs-readonly', 'Expose fs as read-only', false)
    .action(async (root: string, url: string | undefined, opts: Omit<ConnectArgs, 'url'>) => {
      await guard(Boolean(opts.json), () =>
        runConnect({ ...opts, url, shell: false, fs: [String(root)] }),
      )
    })
}

export function mountCommand(): Command {
  return new Command('mount')
    .description('Mount local resources through a device connection')
    .addCommand(mountFsCommand())
}
