import { Command } from 'commander'
import { resolveTarget, withGlobalOpts } from '../args'
import { apiJson, apiText } from '../http'
import { guard, printJson, printLine } from '../output'
import { nodePath } from '../paths'
import type { HelpJson } from '../types'

interface HelpOpts {
  json?: boolean
  md?: boolean
  baseUrl?: string
  sk?: string
}

/**
 * `tb help [path]` —— GET <path>/~help(根缺省)。
 * 默认原样输出 Help DSL 文本;--json 输出等价 JSON(cmd 数组等);
 * --md 输出可读 Markdown 表现(Accept: text/markdown)。
 */
export function helpCommand(): Command {
  return withGlobalOpts(new Command('help'))
    .description('Show a node ~help (DSL by default, --json structured, --md markdown)')
    .argument('[path]', 'Tree path (default: root)')
    .option('--md', 'Render as readable markdown (Accept: text/markdown)')
    .action(async (pathArg: string | undefined, opts: HelpOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const target = resolveTarget(opts)
        const path = nodePath('~help', pathArg)
        if (asJson) {
          printJson(await apiJson<HelpJson>(target, { path }))
        } else {
          printLine(
            await apiText(target, { path, ...(opts.md ? { accept: 'markdown' as const } : {}) }),
          )
        }
      })
    })
}
