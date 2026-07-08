import { Command } from 'commander'
import { resolveTarget, withGlobalOpts } from '../args'
import { CliError, callTool } from '../http'
import { guard, printJson, printLine, table } from '../output'

interface FederationGlobalOpts {
  json?: boolean
  baseUrl?: string
  sk?: string
}

/** system/federation list 的一行(env 基线不可删;运行时条目可删)。 */
interface FederationHost {
  host: string
  source: 'env' | 'store'
  removable: boolean
  updatedAt?: string
}

/**
 * `tb federation ls` → 合并视图:env 基线(source=env,不可删)+ 运行时条目(source=store)。
 * 白名单是 remote 联邦的 host 后缀闸门,空 = 拒一切 remote。
 */
export function federationLsCommand(): Command {
  return withGlobalOpts(new Command('ls'))
    .description('List remote federation allowlist (env baseline + runtime entries)')
    .action(async (opts: FederationGlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const page = await callTool<{ items: FederationHost[] }>(
          resolveTarget(opts),
          '/system/federation',
          'list',
          {},
        )
        if (asJson) {
          printJson(page)
          return
        }
        const rows = (page.items ?? []).map((h) => [
          h.host,
          h.source,
          h.removable ? 'yes' : 'no',
          h.updatedAt ? new Date(h.updatedAt).toLocaleString() : '-',
        ])
        printLine(table(['HOST', 'SOURCE', 'REMOVABLE', 'UPDATED'], rows))
      })
    })
}

/** `tb federation add <host>` → 运行时新增一个 host 后缀(裸主机名,不含 scheme/端口/路径)。 */
export function federationAddCommand(): Command {
  return withGlobalOpts(new Command('add'))
    .description('Allow a remote host suffix (bare hostname, e.g. example.com)')
    .argument('<host>', 'Host suffix to allow')
    .action(async (hostArg: string, opts: FederationGlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const host = String(hostArg ?? '').trim()
        if (!host) throw new CliError('host is required')
        const entry = await callTool<{ host: string; updatedAt: string }>(
          resolveTarget(opts),
          '/system/federation',
          'add',
          { host },
        )
        if (asJson) printJson(entry)
        else printLine(`allowed remote host: ${entry.host}`)
      })
    })
}

/** `tb federation rm <host>` → 删除运行时条目(env 基线条目不可删)。 */
export function federationRmCommand(): Command {
  return withGlobalOpts(new Command('rm'))
    .description('Remove a runtime allowlist entry (env baseline entries are not removable)')
    .argument('<host>', 'Host suffix to remove')
    .action(async (hostArg: string, opts: FederationGlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const host = String(hostArg ?? '').trim()
        if (!host) throw new CliError('host is required')
        await callTool(resolveTarget(opts), '/system/federation', 'remove', { host })
        if (asJson) printJson({ ok: true, host })
        else printLine(`removed remote host: ${host}`)
      })
    })
}

export function federationCommand(): Command {
  return new Command('federation')
    .description('Manage remote federation host allowlist (system/federation; admin scope)')
    .addCommand(federationLsCommand())
    .addCommand(federationAddCommand())
    .addCommand(federationRmCommand())
}
