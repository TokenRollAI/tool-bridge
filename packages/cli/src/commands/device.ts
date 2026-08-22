import { Command } from 'commander'
import type { Node, Page } from '../types'
import { parsePageOpts, resolveTarget, withGlobalOpts, withPageOpts } from '../args'
import { guard, printJson, printLine, table } from '../output'
import { callDirect } from '../http'

function deviceIdFromPath(path: string): string {
  const parts = path.split('/')
  return parts[0] === 'device' ? (parts[1] ?? path) : path
}

interface DeviceLsOpts {
  baseUrl?: string
  cursor?: string
  json?: boolean
  limit?: string
  sk?: string
}

export function deviceLsCommand(): Command {
  return withPageOpts(withGlobalOpts(new Command('ls')))
    .description('List registered devices')
    .action(async (opts: DeviceLsOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const target = resolveTarget(opts)
        const pageOpts = parsePageOpts(opts)
        const page = await callDirect<Page<Node>>(target, '/system/registry/list', {
          prefix: 'device',
          ...(Object.keys(pageOpts).length ? { opts: pageOpts } : {}),
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
          printLine(page.cursor ? '(no devices on this page)' : '(no devices)')
          if (page.cursor) printLine(`next cursor: ${page.cursor}`)
          return
        }
        // ONLINE 来自存储层的连接位(建立/拆除),不是 `~tree` 的三态 presence:registry list
        // 返回未投影的 TreeNode。LAST_SEEN 给出最近一次存活观察,让 online=yes 但早已失联的设备
        // 能被看出来。
        printLine(
          table(
            ['DEVICE_ID', 'PATH', 'ONLINE', 'LAST_SEEN', 'DESCRIPTION'],
            devices.map(n => [
              deviceIdFromPath(n.path),
              n.path,
              n.online ? 'yes' : 'no',
              n.lastSeenAt ? new Date(n.lastSeenAt).toLocaleString() : '-',
              n.description ?? '',
            ]),
          ),
        )
        if (page.cursor) printLine(`next cursor: ${page.cursor}`)
      })
    })
}

export function deviceCommand(): Command {
  return new Command('device')
    .description('Manage reverse-connected devices')
    .addCommand(deviceLsCommand())
}
