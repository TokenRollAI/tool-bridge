import { Command } from 'commander'
import { printJson, printLine, table } from '../output'
import { resolveTarget, withGlobalOpts } from '../args'
import { withClient } from '../http'

interface LsOpts {
  baseUrl?: string
  json?: boolean
  sk?: string
}

/**
 * `tb ls [path]` —— 列出节点的子节点(GET <path>/~help 的 children;根缺省)。
 * 可见性已由网关按调用者裁剪。
 */
export function lsCommand(): Command {
  return withGlobalOpts(new Command('ls'))
    .description('List child nodes of a path (default: root)')
    .argument('[path]', 'Tree path (default: root)')
    .action(async (path: string | undefined, opts: LsOpts) => {
      const asJson = Boolean(opts.json)
      const target = resolveTarget(opts)
      const help = await withClient(target, async client => await client.getHelp(path ?? ''))
      const children = help.children ?? []
      if (asJson) {
        printJson(children)
        return
      }
      if (children.length === 0) {
        printLine('(no child nodes)')
        return
      }
      const rows = children.map(c => [c.path, c.kind, c.description ?? ''])
      printLine(table(['PATH', 'KIND', 'DESCRIPTION'], rows))
    })
}
