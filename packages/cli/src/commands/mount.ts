import { Command } from 'commander'
import { runConnect, withDeviceConnectionGlobalOpts } from './connect'

export function mountFsCommand() {
  return withDeviceConnectionGlobalOpts(new Command('fs'))
    .description('Expose a local directory as a device fs context')
    .argument('<root>', 'Local directory root')
    .argument('[url]', 'Gateway base URL (mutually exclusive with --base-url)')
    .option('--device-id <id>', 'Override stable local device id')
    .option('--path <path>', 'Mount path (default: device/<device-id>)')
    .option('--fs-readonly', 'Expose fs as read-only', false)
    .action(async (root, url, opts) => {
      await runConnect({ ...opts, url, shell: false, fs: [String(root)] })
    })
}

export function mountCommand() {
  return new Command('mount')
    .description('Mount local resources through a device connection')
    .addCommand(mountFsCommand())
}
