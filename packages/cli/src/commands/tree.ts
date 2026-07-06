import { defineCommand } from 'citty'
import { globalArgs, resolveTarget } from '../args'
import { apiJson, CliError } from '../http'
import { guard, printJson, printLine } from '../output'
import { nodePath } from '../paths'
import type { TreeJson } from '../types'

/** 把 TreeJson 渲染成缩进树(纯函数,便于单测)。 */
export function renderTree(node: TreeJson, depth = 0): string {
  const pad = '  '.repeat(depth)
  const name = node.path === '' ? '/' : node.path
  const flags = [node.online === false ? 'offline' : '', node.truncated ? 'truncated' : ''].filter(
    Boolean,
  )
  const suffix = flags.length ? ` [${flags.join(', ')}]` : ''
  const desc = node.description ? ` — ${node.description}` : ''
  const lines = [`${pad}${name} (${node.kind})${desc}${suffix}`]
  for (const child of node.children ?? []) lines.push(renderTree(child, depth + 1))
  return lines.join('\n')
}

/**
 * `tb tree [path] [--depth N]` —— GET <path>/~tree?depth=N(根缺省)。
 * 人类模式画缩进树;--json 原样输出 TreeJson。
 */
export const treeCommand = defineCommand({
  meta: { name: 'tree', description: 'Show the node tree (depth-limited)' },
  args: {
    ...globalArgs,
    path: { type: 'positional', description: 'Tree path (default: root)', required: false },
    depth: { type: 'string', description: 'Max depth (gateway default 2, cap 8)' },
  },
  async run({ args }) {
    const asJson = Boolean(args.json)
    await guard(asJson, async () => {
      let depth: number | undefined
      if (args.depth !== undefined) {
        depth = Number(args.depth)
        if (!Number.isInteger(depth) || depth < 0) {
          throw new CliError(`invalid --depth "${args.depth}": expected a non-negative integer`)
        }
      }
      const tree = await apiJson<TreeJson>(resolveTarget(args), {
        path: nodePath('~tree', args.path as string | undefined),
        query: { depth },
      })
      if (asJson) printJson(tree)
      else printLine(renderTree(tree))
    })
  },
})
