import { defineCommand } from 'citty'
import { globalArgs, resolveTarget } from '../args'
import { apiJson } from '../http'
import { guard, printJson, printLine, table } from '../output'
import { nodePath } from '../paths'
import type { HelpJson } from '../types'

/**
 * `tb ls [path]` —— 列出节点的子节点(GET <path>/~help 的 children;根缺省)。
 * 可见性已由网关按调用者裁剪。
 */
export const lsCommand = defineCommand({
  meta: { name: 'ls', description: 'List child nodes of a path (default: root)' },
  args: {
    ...globalArgs,
    path: { type: 'positional', description: 'Tree path (default: root)', required: false },
  },
  async run({ args }) {
    const asJson = Boolean(args.json)
    await guard(asJson, async () => {
      const help = await apiJson<HelpJson>(resolveTarget(args), {
        path: nodePath('~help', args.path as string | undefined),
      })
      const children = help.children ?? []
      if (asJson) {
        printJson(children)
        return
      }
      if (children.length === 0) {
        printLine('(no child nodes)')
        return
      }
      const rows = children.map((c) => [c.path, c.kind, c.description ?? ''])
      printLine(table(['PATH', 'KIND', 'DESCRIPTION'], rows))
    })
  },
})
