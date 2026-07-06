import { defineCommand } from 'citty'
import { globalArgs, resolveTarget } from '../args'
import { callTool } from '../http'
import { guard, printJson, printLine, table } from '../output'
import type { Node, Page } from '../types'

function deviceIdFromPath(path: string): string {
  const parts = path.split('/')
  return parts[0] === 'device' ? (parts[1] ?? path) : path
}

export const deviceLsCommand = defineCommand({
  meta: { name: 'ls', description: 'List registered devices' },
  args: globalArgs,
  async run({ args }) {
    const asJson = Boolean(args.json)
    await guard(asJson, async () => {
      const target = resolveTarget(args)
      const page = await callTool<Page<Node>>(target, '/system/registry', 'list', {
        prefix: 'device',
      })
      const devices = (page.items ?? []).filter(
        (n) => n.kind === 'directory' && n.online !== undefined,
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
          devices.map((n) => [
            deviceIdFromPath(n.path),
            n.path,
            n.online ? 'yes' : 'no',
            n.description ?? '',
          ]),
        ),
      )
    })
  },
})

export const deviceCommand = defineCommand({
  meta: { name: 'device', description: 'Manage reverse-connected devices' },
  subCommands: { ls: deviceLsCommand },
})
