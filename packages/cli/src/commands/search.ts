import { Command } from 'commander'
import type { Page, ToolSearchItem } from '../types'
import { parsePageOpts, resolveTarget, withGlobalOpts, withPageOpts } from '../args'
import { guard, printJson, printLine, table } from '../output'
import { apiJson, CliError } from '../http'

interface SearchOpts {
  baseUrl?: string
  cursor?: string
  json?: boolean
  limit?: string
  mode?: string
  sk?: string
}

function printSearchPage(page: Page<ToolSearchItem>): void {
  if (page.items.length === 0) {
    printLine('(no visible tools found)')
    return
  }
  printLine(
    table(
      ['NODE', 'TOOL', 'EFFECT', 'CONFIRM', 'DESCRIPTION'],
      page.items.map(({ path, tool }) => [
        path,
        tool.name,
        tool.effect ?? '',
        tool.confirm === true ? 'yes' : 'no',
        tool.description ?? '',
      ]),
    ),
  )
  if (page.cursor) printLine(`next cursor: ${page.cursor}`)
}

/** `tb search <query>` —— 在当前 SK 可见且可调用的全局工具中检索。 */
export function searchCommand(): Command {
  return withPageOpts(withGlobalOpts(new Command('search')))
    .description('Search callable tools across the gateway')
    .argument('<query>', 'Tool name, description, or feedback query')
    .option('--mode <mode>', 'Search mode: keyword | semantic (default keyword)')
    .action(async (queryArg: string, opts: SearchOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const query = String(queryArg ?? '').trim()
        if (!query) throw new CliError('query is required')
        const mode = opts.mode ? String(opts.mode) : undefined
        if (mode !== undefined && mode !== 'keyword' && mode !== 'semantic') {
          throw new CliError(`invalid --mode "${mode}"; valid: keyword, semantic`)
        }
        const pageOpts: Record<string, unknown> = parsePageOpts(opts)
        if (mode) pageOpts.mode = mode
        const page = await apiJson<Page<ToolSearchItem>>(resolveTarget(opts), {
          method: 'POST',
          path: '/~search',
          body: {
            query,
            ...(Object.keys(pageOpts).length > 0 ? { opts: pageOpts } : {}),
          },
        })
        if (asJson) printJson(page)
        else printSearchPage(page)
      })
    })
}
