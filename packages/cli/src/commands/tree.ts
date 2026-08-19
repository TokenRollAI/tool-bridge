import { Command } from 'commander'
import type { TreeJson } from '../types'
import { resolveTarget, withGlobalOpts } from '../args'
import { guard, printJson, printLine } from '../output'
import { apiJson, CliError } from '../http'
import { nodePath } from '../paths'

/**
 * 把 TreeJson 渲染成缩进树(纯函数,便于单测)。
 *
 * presence 三态里只有 `online` 不标注 —— 健康设备保持安静,`stale`/`offline` 才出现在 flag 里,
 * 因为它们意味着调用很可能失败。缺省 presence(非 device 节点)同样不标。
 */
export function renderTree(node: TreeJson, depth = 0): string {
  const pad = '  '.repeat(depth)
  const name = node.path === '' ? '/' : node.path
  const state = node.presence?.state
  const flags = [
    state === 'stale' || state === 'offline' ? state : '',
    node.truncated ? 'truncated' : '',
  ].filter(Boolean)
  const suffix = flags.length ? ` [${flags.join(', ')}]` : ''
  const desc = node.description ? ` — ${node.description}` : ''
  const lines = [`${pad}${name} (${node.kind})${desc}${suffix}`]
  for (const child of node.children ?? []) lines.push(renderTree(child, depth + 1))
  return lines.join('\n')
}

interface TreeOpts {
  baseUrl?: string
  depth?: string
  json?: boolean
  sk?: string
}

/**
 * `tb tree [path] [--depth N]` —— GET <path>/~tree?depth=N(根缺省)。
 * 人类模式画缩进树;--json 原样输出 TreeJson。
 */
export function treeCommand(): Command {
  return withGlobalOpts(new Command('tree'))
    .description('Show the node tree (depth-limited)')
    .argument('[path]', 'Tree path (default: root)')
    .option('--depth <n>', 'Tree depth, integer 1-8 (default: 2)')
    .action(async (path: string | undefined, opts: TreeOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        let depth: number | undefined
        if (opts.depth !== undefined) {
          depth = Number(opts.depth)
          if (!Number.isInteger(depth) || depth < 1 || depth > 8) {
            throw new CliError(`invalid --depth "${opts.depth}": expected an integer between 1 and 8`)
          }
        }
        const tree = await apiJson<TreeJson>(resolveTarget(opts), {
          path: nodePath('~tree', path),
          query: { depth },
        })
        if (asJson) printJson(tree)
        else printLine(renderTree(tree))
      })
    })
}
