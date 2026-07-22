import { Command } from 'commander'
import type { Node, NodeInput, Page, TreeJson } from '../types'
import { parsePageOpts, resolveTarget, withGlobalOpts, withPageOpts } from '../args'
import { guard, printJson, printLine, table } from '../output'
import { deleteNode, registerNode } from '../registry'
import { apiJson, callTool, CliError } from '../http'

interface ServerAddOpts {
  baseUrl?: string
  description?: string
  json?: boolean
  remoteUrl?: string
  sk?: string
  skRef?: string
  timeout?: string
}

interface GlobalOpts {
  baseUrl?: string
  cursor?: string
  json?: boolean
  limit?: string
  sk?: string
}

/**
 * `tb server add <path> --remote-url <u>` —— 联邦一个外部 HTBP 服务(kind:'remote')。
 * `--base-url` 始终表示当前 CLI 要访问的网关,不再在此命令复用为远端地址。
 */
export function serverAddCommand(): Command {
  return withGlobalOpts(new Command('add'))
    .description('Federate a remote HTBP server as a subtree')
    .argument('<path>', 'Tree path to mount the remote at')
    .option(
      '--remote-url <url>',
      'Required remote HTBP server URL (--base-url selects the gateway)',
    )
    .option('--sk-ref <ref>', 'SecretStore ref for outbound SK (skRef)')
    .option('--description <text>', 'One-line node description (default: derived from remote URL)')
    .addHelpText(
      'after',
      '\nMigration: remote URL uses --remote-url; --base-url always selects the gateway.\n',
    )
    .action(async (pathArg: string, opts: ServerAddOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const path = String(pathArg ?? '').trim()
        if (!path) throw new CliError('tree path is required')
        const remoteUrl = String(opts.remoteUrl ?? '').trim()
        if (!remoteUrl) {
          throw new CliError(
            '--remote-url is required; --base-url now selects the gateway (migrate the old remote URL flag to --remote-url)',
          )
        }
        const skRef = opts.skRef ? String(opts.skRef) : undefined

        const input: NodeInput = {
          path,
          kind: 'remote',
          description: opts.description
            ? String(opts.description)
            : `remote HTBP server at ${remoteUrl}`,
          config: { kind: 'remote', baseUrl: remoteUrl, ...(skRef ? { skRef } : {}) },
        }

        const node = await registerNode(resolveTarget(opts), input)
        if (asJson) printJson(node)
        else printLine(`added remote server at ${path} → ${remoteUrl}`)
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
  return withPageOpts(withGlobalOpts(new Command('ls')))
    .description('List federated remote servers')
    .addHelpText(
      'after',
      '\nPagination note: --limit/--cursor require system/registry visibility; the ~tree fallback cannot paginate.\n',
    )
    .action(async (opts: GlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const target = resolveTarget(opts)
        const pageOpts = parsePageOpts(opts)
        try {
          const page = await callTool<Page<Node>>(
            target,
            '/system/registry',
            'list',
            Object.keys(pageOpts).length ? { opts: pageOpts } : {},
          )
          const remotes = (page.items ?? []).filter(n => n.kind === 'remote')
          if (asJson) {
            printJson(page.cursor ? { items: remotes, cursor: page.cursor } : { items: remotes })
            return
          }
          if (remotes.length === 0) {
            printLine(page.cursor ? '(no remote servers on this page)' : '(no remote servers)')
            if (page.cursor) printLine(`next cursor: ${page.cursor}`)
            return
          }
          const rows = remotes.map(n => [
            n.path,
            n.config && n.config.kind === 'remote' ? n.config.baseUrl : '-',
            n.description ?? '',
          ])
          printLine(table(['PATH', 'BASEURL', 'DESCRIPTION'], rows))
          if (page.cursor) printLine(`next cursor: ${page.cursor}`)
        } catch (err) {
          if (!(err instanceof CliError && err.code === 'not_found')) throw err
          if (Object.keys(pageOpts).length > 0) {
            throw new CliError(
              '--limit/--cursor require system/registry visibility; the ~tree fallback cannot paginate',
            )
          }
          // 退化:无 system/registry 可见性 → ~tree 过滤 kind,baseUrl 不可见。
          const tree = await apiJson<TreeJson>(target, { path: '/~tree', query: { depth: 8 } })
          const remotes: TreeJson[] = []
          collectRemotes(tree, remotes)
          if (asJson) {
            printJson({
              items: remotes.map(n => ({
                path: n.path,
                kind: n.kind,
                description: n.description,
              })),
            })
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
