import { Command } from 'commander'
import { withGlobalOpts } from '../args'
import { guard } from '../output'
import { type ConnectArgs, runConnect } from './connect'

export function mountFsCommand(): Command {
  return withGlobalOpts(new Command('fs'))
    .description('Expose a local directory as a device fs context')
    .argument('<root>', 'Local directory root')
    .argument('[url]', 'Gateway base URL')
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
