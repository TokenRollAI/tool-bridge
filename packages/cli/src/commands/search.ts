import { Command } from 'commander'
import type { Page, ToolSearchItem, ToolSearchPage } from '../types'
import { collect, parsePageOpts, resolveTarget, withGlobalOpts, withPageOpts } from '../args'
import { printJson, printLine, table } from '../output'
import { CliError, withClient } from '../http'

const SEARCH_EFFECTS = ['read', 'write', 'destructive', 'unknown'] as const
const SEARCH_FEDERATION = ['local', 'recursive'] as const
const SEARCH_MATCHING = ['best', 'all'] as const
const SEARCH_MODES = ['keyword', 'semantic'] as const

function parseChoice<const Values extends readonly string[]>(
  value: unknown,
  flag: string,
  values: Values,
): Values[number] | undefined {
  if (value === undefined) return undefined
  const normalized = String(value).trim()
  if (!(values as readonly string[]).includes(normalized)) {
    throw new CliError(`invalid ${flag} "${normalized}"; valid: ${values.join(', ')}`)
  }
  return normalized as Values[number]
}

function parseMinCoverage(value: unknown): number | undefined {
  if (value === undefined) return undefined
  const coverage = Number(value)
  if (!Number.isFinite(coverage) || coverage <= 0 || coverage > 1) {
    throw new CliError(`invalid --min-coverage "${String(value)}": expected a number in (0, 1]`)
  }
  return coverage
}

/**
 * `--schemas` 的附加段:逐工具打 `NODE/TOOL` 标题 + pretty inputSchema。
 * 命令会用 `detail:'full'` 请求 schema，但仍只发一次 `~search`；默认是
 * compact discovery，避免在广泛结果中携带所有参数 schema。
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

function printPartialNotice(page: ToolSearchPage): void {
  if (page.partial !== true) return
  const failures = page.sources
    ?.filter(source => source.status !== 'ok')
    .map(source => `${source.path || '(local)'}=${source.status}`)
  const detail = failures === undefined || failures.length === 0
    ? ''
    : ` (${failures.join(', ')})`
  process.stderr.write(`warning: partial search results${detail}\n`)
}

function printSearchPage(page: ToolSearchPage, withSchemas = false): void {
  if (page.items.length === 0) {
    printLine('(no visible tools found)')
    return
  }
  printLine(
    table(
      ['NODE', 'TOOL', 'SOURCE', 'COVERAGE', 'EFFECT', 'CONFIRM', 'DESCRIPTION'],
      page.items.map(({ path, relevance, source, tool }) => [
        path,
        tool.name,
        source?.path || '(local)',
        `${relevance.matchedTermCount}/${relevance.totalTermCount}`,
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
    .option('--federation <scope>', 'Search scope: local | recursive')
    .option('--matching <matching>', 'Keyword matching: best | all (default best)')
    .option('--min-coverage <fraction>', 'Minimum query-term coverage in (0, 1]')
    .option('--path-prefix <path>', 'Only return tools below this path prefix')
    .option(
      '--effect <effect>',
      'Only return an effect: read | write | destructive | unknown (repeatable)',
      collect,
      [],
    )
    .option(
      '--schemas',
      'Request full results and print argument schemas (default, including --json: compact)',
      false,
    )
    .addHelpText(
      'after',
      `
Examples:
  tb search calendar
  tb search calendar --effect read --matching all
  tb search calendar --schemas   request and print arguments schemas in the same round-trip`,
    )
    .action(async (queryArg, opts) => {
      const asJson = Boolean(opts.json)
      const query = String(queryArg ?? '').trim()
      if (!query) throw new CliError('query is required')

      const mode = parseChoice(opts.mode, '--mode', SEARCH_MODES)
      const federation = parseChoice(opts.federation, '--federation', SEARCH_FEDERATION)
      const matching = parseChoice(opts.matching, '--matching', SEARCH_MATCHING)
      const effects = opts.effect.map((effect: string) => {
        const parsed = parseChoice(effect, '--effect', SEARCH_EFFECTS)
        if (parsed === undefined) throw new CliError('--effect requires a value')
        return parsed
      })
      const minCoverage = parseMinCoverage(opts.minCoverage)
      if (matching === 'all' && minCoverage !== undefined && minCoverage !== 1) {
        throw new CliError('--matching all only accepts --min-coverage 1')
      }
      const pathPrefix = opts.pathPrefix === undefined ? undefined : String(opts.pathPrefix).trim()
      if (opts.pathPrefix !== undefined && !pathPrefix) {
        throw new CliError('--path-prefix must not be empty')
      }
      const pageOpts = {
        ...parsePageOpts(opts),
        detail: opts.schemas ? 'full' as const : 'compact' as const,
        ...(effects.length === 0 ? {} : { effects }),
        ...(federation === undefined ? {} : { federation }),
        ...(matching === undefined ? {} : { matching }),
        ...(minCoverage === undefined ? {} : { minCoverage }),
        ...(mode === undefined ? {} : { mode }),
        ...(pathPrefix === undefined ? {} : { pathPrefix }),
      }
      const target = resolveTarget(opts)
      const page = await withClient(
        target,
        async client => await client.search({
          query,
          opts: pageOpts,
        }),
      )
      printPartialNotice(page)
      if (asJson) printJson(page)
      else printSearchPage(page, Boolean(opts.schemas))
    })
}
