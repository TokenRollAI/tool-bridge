import { Command } from 'commander'
import type { Node, NodeInput, Page, TreeJson } from '../types'
import { guard, printJson, printLine, table } from '../output'
import { resolveTarget, withGlobalOpts } from '../args'
import { deleteNode, registerNode } from '../registry'
import { apiJson, callTool, CliError } from '../http'

interface ServerAddOpts {
  baseUrl: string
  description?: string
  json?: boolean
  sk?: string
  skRef?: string
}

interface GlobalOpts {
  baseUrl?: string
  json?: boolean
  sk?: string
}

/**
 * `tb server add <path> --base-url <u>` —— 联邦一个外部 HTBP 服务(kind:'remote')。
 *
 * 注意:此处 `--base-url` 指**远端 HTBP 服务地址**(config.baseUrl),与全局网关 `--base-url`
 * 语义冲突;本命令下网关地址仅取自 $TB_BASE_URL / 当前 profile(不接受网关 --base-url 覆盖)。
 * 该偏差已在交付说明标注。
 */
export function serverAddCommand(): Command {
  return new Command('add')
    .description('Federate a remote HTBP server as a subtree')
    .argument('<path>', 'Tree path to mount the remote at')
    .option('--json', 'Output parseable JSON', false)
    .option('--sk <sk>', 'Secret Key (default: $TB_SK or config profile)')
    .requiredOption('--base-url <url>', 'Remote HTBP server base URL')
    .option('--sk-ref <ref>', 'SecretStore ref for outbound SK (skRef)')
    .option('--description <text>', 'One-line node description')
    .action(async (pathArg: string, opts: ServerAddOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const path = String(pathArg ?? '').trim()
        if (!path) throw new CliError('tree path is required')
        const baseUrl = String(opts.baseUrl ?? '').trim()
        if (!baseUrl) throw new CliError('--base-url (remote server URL) is required')
        const skRef = opts.skRef ? String(opts.skRef) : undefined

        const input: NodeInput = {
          path,
          kind: 'remote',
          description: opts.description ? String(opts.description) : '',
          config: { kind: 'remote', baseUrl, ...(skRef ? { skRef } : {}) },
        }

        // 网关地址取自 env/profile(--base-url 已被远端占用);仅透传 --sk。
        const node = await registerNode(resolveTarget({ sk: opts.sk }), input)
        if (asJson) printJson(node)
        else printLine(`added remote server at ${path} → ${baseUrl}`)
      })
    })
}

/** 递归收集树中的 remote 节点(~tree 退化路径用;~tree 无 config,baseUrl 不可见)。 */
function collectRemotes(node: TreeJson, out: TreeJson[]): void {
  if (node.kind === 'remote') out.push(node)
  for (const child of node.children ?? []) collectRemotes(child, out)
}

/**
 * `tb server ls` —— 列出 remote 节点。
 * 首选管理面 `system/registry` list(带 config.baseUrl);无可见性(404)时退化为
 * `GET /~tree?depth=8` 过滤 kind==='remote'(此路径 baseUrl 不可见,注明)。
 */
export function serverLsCommand(): Command {
  return withGlobalOpts(new Command('ls'))
    .description('List federated remote servers')
    .action(async (opts: GlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const target = resolveTarget(opts)
        try {
          const page = await callTool<Page<Node>>(target, '/system/registry', 'list', {})
          const remotes = (page.items ?? []).filter(n => n.kind === 'remote')
          if (asJson) {
            printJson(remotes)
            return
          }
          if (remotes.length === 0) {
            printLine('(no remote servers)')
            return
          }
          const rows = remotes.map(n => [
            n.path,
            n.config && n.config.kind === 'remote' ? n.config.baseUrl : '-',
            n.description ?? '',
          ])
          printLine(table(['PATH', 'BASEURL', 'DESCRIPTION'], rows))
        } catch (err) {
          if (!(err instanceof CliError && err.code === 'not_found')) throw err
          // 退化:无 system/registry 可见性 → ~tree 过滤 kind,baseUrl 不可见。
          const tree = await apiJson<TreeJson>(target, { path: '/~tree', query: { depth: 8 } })
          const remotes: TreeJson[] = []
          collectRemotes(tree, remotes)
          if (asJson) {
            printJson(
              remotes.map(n => ({ path: n.path, kind: n.kind, description: n.description })),
            )
            return
          }
          if (remotes.length === 0) {
            printLine('(no remote servers)')
            return
          }
          const rows = remotes.map(n => [n.path, '(not visible)', n.description ?? ''])
          printLine(table(['PATH', 'BASEURL', 'DESCRIPTION'], rows))
          printLine('')
          printLine('note: baseUrl unavailable via ~tree (no system/registry visibility)')
        }
      })
    })
}

/** `tb server rm <path>` —— 卸载 remote 节点(管理面 system/registry delete)。 */
export function serverRmCommand(): Command {
  return withGlobalOpts(new Command('rm'))
    .description('Remove a federated remote server')
    .argument('<path>', 'Tree path to remove')
    .action(async (pathArg: string, opts: GlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const path = String(pathArg ?? '').trim()
        if (!path) throw new CliError('tree path is required')
        await deleteNode(resolveTarget(opts), path, ['remote'])
        if (asJson) printJson({ ok: true, path })
        else printLine(`removed remote server: ${path}`)
      })
    })
}

export function serverCommand(): Command {
  return new Command('server')
    .description('Federate/list/remove remote HTBP servers')
    .addCommand(serverAddCommand())
    .addCommand(serverLsCommand())
    .addCommand(serverRmCommand())
}
