import { Command } from 'commander'
import { resolveTarget, withGlobalOpts } from '../args'
import { apiJson, apiText, CliError } from '../http'
import { guard, printJson, printLine } from '../output'
import { nodePath } from '../paths'
import type { HelpJson } from '../types'

interface HelpOpts {
  json?: boolean
  md?: boolean
  dsl?: boolean
  baseUrl?: string
  sk?: string
}

/**
 * `tb help [path]` —— GET <path>/~help(根缺省)。
 * 默认输出可读 Markdown 表现(协议默认);--json 输出等价 JSON(cmd 数组等);
 * --dsl 输出紧凑 Help DSL(Accept: text/plain);--md 是默认行为的别名(兼容旧脚本)。
 */
export function helpCommand(): Command {
  return withGlobalOpts(new Command('help'))
    .description('Show a node ~help (markdown by default, --json structured, --dsl compact DSL)')
    .argument('[path]', 'Tree path (default: root)')
    .option('--md', 'Render as readable markdown (alias of the default)')
    .option('--dsl', 'Render as compact Help DSL (Accept: text/plain)')
    .action(async (pathArg: string | undefined, opts: HelpOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        if (opts.dsl && opts.md) throw new CliError('--dsl and --md are mutually exclusive')
        if (opts.dsl && asJson) throw new CliError('--dsl and --json are mutually exclusive')
        const target = resolveTarget(opts)
        const path = nodePath('~help', pathArg)
        if (asJson) {
          printJson(await apiJson<HelpJson>(target, { path }))
        } else {
          printLine(
            await apiText(target, { path, accept: opts.dsl ? ('text' as const) : 'markdown' }),
          )
        }
      })
    })
}
