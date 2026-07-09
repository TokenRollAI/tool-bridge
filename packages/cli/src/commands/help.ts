import { Command } from 'commander'
import { resolveTarget, withGlobalOpts } from '../args'
import { apiJson, apiText, CliError } from '../http'
import { printMarkdown } from '../markdown'
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
 * 默认输出 Markdown 表现:stdout 是 TTY 时经 ANSI 富文本渲染,管道/重定向时裸 markdown 原样;
 * --md 强制裸 markdown(TTY 下也不渲染,便于复制/落文件);
 * --json 输出等价 JSON(cmd 数组等);--dsl 输出紧凑 Help DSL(Accept: text/plain)。
 */
export function helpCommand(): Command {
  return withGlobalOpts(new Command('help'))
    .description(
      'Show a node ~help (rendered markdown by default; --md raw markdown, --json structured, --dsl compact DSL)',
    )
    .argument('[path]', 'Tree path (default: root)')
    .option('--md', 'Force raw markdown (skip terminal rendering)')
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
        } else if (opts.dsl) {
          printLine(await apiText(target, { path, accept: 'text' }))
        } else {
          const md = await apiText(target, { path, accept: 'markdown' })
          // --md 强制裸输出;否则 TTY → ANSI 富文本、管道/Agent → 裸 markdown(markdown.ts 判定)。
          if (opts.md) printLine(md.replace(/\n+$/, ''))
          else printMarkdown(md)
        }
      })
    })
}
