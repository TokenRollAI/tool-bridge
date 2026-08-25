import { Command } from 'commander'
import type { Page, ToolSearchItem } from '../types'
import { parsePageOpts, resolveTarget, withGlobalOpts, withPageOpts } from '../args'
import { printJson, printLine, table } from '../output'
import { CliError, withClient } from '../http'

/**
 * `--schemas` 的附加段:逐工具打 `NODE/TOOL` 标题 + pretty inputSchema。
 * schema 已在 `~search` 响应里(`items[].tool.inputSchema`),因此这只是渲染开关,
 * 不额外请求 —— 目的是省掉"search 命中后再 `tb help` 拿 schema"的往返。
 */
function printSearchSchemas(page: Page<ToolSearchItem>): void {
  for (const { path, tool } of page.items) {
    printLine('')
    printLine(`${path}/${tool.name}`)
    if (tool.inputSchema === undefined) printLine('  (no input schema)')
    else {
      for (const line of JSON.stringify(tool.inputSchema, null, 2).split('\n')) {
        printLine(`  ${line}`)
      }
    }
  }
}

function printSearchPage(page: Page<ToolSearchItem>, withSchemas = false): void {
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
  if (withSchemas) printSearchSchemas(page)
  if (page.cursor) printLine(`next cursor: ${page.cursor}`)
}

/** `tb search <query>` —— 在当前 SK 可见且可调用的全局工具中检索。 */
export function searchCommand() {
  return withPageOpts(withGlobalOpts(new Command('search')))
    .description('Search callable tools across the gateway')
    .argument('<query>', 'Tool name, description, or feedback query')
    .option('--mode <mode>', 'Search mode: keyword | semantic (default keyword)')
    .option(
      '--schemas',
      'Also print each result\'s arguments JSON Schema (no effect with --json, which always carries it)',
      false,
    )
    .addHelpText(
      'after',
      `
Examples:
  tb search calendar
  tb search calendar --schemas   print arguments schemas inline, no extra \`tb help\` round-trip`,
    )
    .action(async (queryArg, opts) => {
      const asJson = Boolean(opts.json)
      const query = String(queryArg ?? '').trim()
      if (!query) throw new CliError('query is required')
      const mode = opts.mode ? String(opts.mode) : undefined
      if (mode !== undefined && mode !== 'keyword' && mode !== 'semantic') {
        throw new CliError(`invalid --mode "${mode}"; valid: keyword, semantic`)
      }
      const searchMode = mode as 'keyword' | 'semantic' | undefined
      const pageOpts = {
        ...parsePageOpts(opts),
        ...(searchMode === undefined ? {} : { mode: searchMode }),
      }
      const target = resolveTarget(opts)
      const page = await withClient(
        target,
        async client => await client.search({
          query,
          ...(Object.keys(pageOpts).length > 0 ? { opts: pageOpts } : {}),
        }),
      )
      if (asJson) printJson(page)
      else printSearchPage(page, Boolean(opts.schemas))
    })
}
