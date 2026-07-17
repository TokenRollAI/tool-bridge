import { Command } from 'commander'
import type { Node, Page } from '../types'
import { guard, printJson, printLine, table } from '../output'
import { resolveTarget, withGlobalOpts } from '../args'
import { callTool } from '../http'

function deviceIdFromPath(path: string): string {
  const parts = path.split('/')
  return parts[0] === 'device' ? (parts[1] ?? path) : path
}

interface DeviceLsOpts {
  baseUrl?: string
  json?: boolean
  sk?: string
}

export function deviceLsCommand(): Command {
  return withGlobalOpts(new Command('ls'))
    .description('List registered devices')
    .action(async (opts: DeviceLsOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const target = resolveTarget(opts)
        const page = await callTool<Page<Node>>(target, '/system/registry', 'list', {
          prefix: 'device',
        })
        const devices = (page.items ?? []).filter(
          n => n.kind === 'directory' && n.online !== undefined,
        )
        const out: Page<Node> = page.cursor
          ? { items: devices, cursor: page.cursor }
          : { items: devices }
        if (asJson) {
          printJson(out)
          return
        }
        if (devices.length === 0) {
          printLine('(no devices)')
          return
        }
        printLine(
          table(
            ['DEVICE_ID', 'PATH', 'ONLINE', 'DESCRIPTION'],
            devices.map(n => [
              deviceIdFromPath(n.path),
              n.path,
              n.online ? 'yes' : 'no',
              n.description ?? '',
            ]),
          ),
        )
      })
    })
}

export function deviceCommand(): Command {
  return new Command('device')
    .description('Manage reverse-connected devices')
    .addCommand(deviceLsCommand())
}
