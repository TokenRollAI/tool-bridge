import { defineCommand } from 'citty'
import { globalArgs, resolveTarget } from '../args'
import { apiJson, apiText } from '../http'
import { guard, printJson, printLine } from '../output'
import { nodePath } from '../paths'
import type { HelpJson } from '../types'

/**
 * `tb help [path]` —— GET <path>/~help(根缺省)。
 * 默认原样输出 Help DSL 文本;--json 输出等价 JSON(cmd 数组等)。
 */
export const helpCommand = defineCommand({
  meta: { name: 'help', description: 'Show a node ~help (DSL by default, --json for structured)' },
  args: {
    ...globalArgs,
    path: { type: 'positional', description: 'Tree path (default: root)', required: false },
  },
  async run({ args }) {
    const asJson = Boolean(args.json)
    await guard(asJson, async () => {
      const target = resolveTarget(args)
      const path = nodePath('~help', args.path as string | undefined)
      if (asJson) {
        printJson(await apiJson<HelpJson>(target, { path }))
      } else {
        printLine(await apiText(target, { path }))
      }
    })
  },
})
