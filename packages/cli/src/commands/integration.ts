/**
 * `tb integration` —— 集成的**用户面**:浏览目录 → 一条命令配好凭证并挂载 → 需要时授权。
 *
 * 为什么另起一个命令族:此前挂一个内置 provider 要串起四个概念、三条命令 ——
 * `tb plugin catalog` 看有什么(而且要 admin)、`tb secret set --name X` 起个**自由文本**
 * 名字、`tb tool mount --provider p --auth-ref X` 手打同一个名字(拼错不报错,agent
 * 首次调用才 401)、oauth 型还要 `tb tool auth`。用户心智里这是一件事。
 *
 * 故 `integration add` 做**编排**而不是新协议:secret set(若给了内联凭证)→ mount
 * → 提示或自动授权。底下仍是 `system/secret` 与 `~register`,没有新的权威存储。
 * `tb tool mount` / `tb ctx mount` 保留(树面的动词仍是 mount,协议不变)。
 */

import { encodeCredentialValues } from '@tool-bridge/core'
import { Command } from 'commander'
import type { NodeConfig, NodeInput, Page } from '../types'
import { collect, parsePageOpts, resolveTarget, withGlobalOpts, withPageOpts } from '../args'
import { guard, printJson, printLine, table } from '../output'
import { parseConfigSpecs, registerNode } from '../registry'
import { callTool, CliError } from '../http'
import { toolAuthCommand } from './tool'

/** system/catalog 的列表项(core builtin/catalog 的 CatalogListItem)。 */
interface CatalogListItem {
  credentialFields?: Array<{
    description?: string
    key: string
    label?: string
    required?: boolean
    secret?: boolean
  }>
  description?: string
  digest: string
  exports: string[]
  id: string
  needsOAuth: boolean
  nodeKinds: Array<'context' | 'tool'>
}

/** 全局参数的公共形状(本仓无集中 GlobalOpts 类型,各命令 inline 声明)。 */
interface CommonOpts {
  baseUrl?: string
  json?: boolean
  sk?: string
  timeout?: string
}

interface IntegrationAddOpts extends CommonOpts {
  config: string[]
  description?: string
  export?: string
  field: string[]
  key?: string
  keyStdin?: boolean
  provider: string
  secret?: string
}

/** 读 stdin 全量(单值凭证的推荐通道:不进 shell history、不进 ps 输出)。 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8').trim()
}

/** `--field k=v` → 字段表(与 `tb secret set --field` 同一解析规则)。 */
function parseFields(specs: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const spec of specs) {
    const idx = spec.indexOf('=')
    if (idx < 0) throw new CliError(`invalid --field "${spec}": expected "key=value"`)
    const key = spec.slice(0, idx).trim()
    const value = spec.slice(idx + 1)
    if (!key || !value) throw new CliError(`invalid --field "${spec}": empty key/value`)
    out[key] = value
  }
  return out
}

/**
 * 取该 provider 的目录项。**尽力而为**:catalog 只覆盖内置插件,external plugin 不在里面,
 * 所以查不到不是错误 —— 只是拿不到"要配哪些字段"的提示,挂载校验照旧在平台侧做。
 */
async function catalogEntry(
  target: ReturnType<typeof resolveTarget>,
  provider: string,
): Promise<CatalogListItem | undefined> {
  try {
    const page = await callTool<Page<CatalogListItem>>(
      target,
      '/system/catalog',
      'search',
      { q: provider },
    )
    return (page.items ?? []).find(i => i.id === provider)
  } catch {
    // 无 read 权限、或宿主没装 catalog:降级为"不给提示",不阻断挂载。
    return undefined
  }
}

/** 字段名校验:挂载前就拒掉拼错的字段,而不是等 agent 首次调用收 401。 */
function assertFieldNames(
  entry: CatalogListItem | undefined,
  exportId: string | undefined,
  given: string[],
): void {
  const declared = entry?.credentialFields?.map(f => f.key)
  if (declared === undefined || declared.length === 0) return
  const unknown = given.filter(k => !declared.includes(k))
  if (unknown.length > 0) {
    throw new CliError(
      `unknown credential field(s) for "${entry!.id}"${exportId ? ` export "${exportId}"` : ''}: `
      + `${unknown.join(', ')}; declared: ${declared.join(', ')}`,
    )
  }
  const missing = declared.filter(k => !given.includes(k))
  if (missing.length > 0) {
    throw new CliError(
      `missing credential field(s) for "${entry!.id}": ${missing.join(', ')} `
      + '(the gateway rejects incomplete multi-field credentials at mount time)',
    )
  }
}

/** secret 名由挂载路径派生:不再让用户手打一个两处都要对上的自由文本。 */
function derivedSecretName(path: string): string {
  return `integration-${path.replace(/\//g, '-')}`
}

/** `tb integration catalog` → system/catalog list/search(read scope,非 admin)。 */
export function integrationCatalogCommand(): Command {
  return withPageOpts(withGlobalOpts(new Command('catalog')))
    .description('Browse built-in integrations available on this host (read-only)')
    .option('--search <q>', 'Case-insensitive substring over id and description')
    .addHelpText('after', `
Examples:
  tb integration catalog                    # everything this host bundles
  tb integration catalog --search jira      # narrow by name/description
  tb integration add tools/tavily --provider tavily --key-stdin < key.txt`)
    .action(async (opts: CommonOpts & { cursor?: string, limit?: string, search?: string }) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const pageOpts = parsePageOpts(opts)
        const q = opts.search !== undefined ? String(opts.search).trim() : undefined
        const result = await callTool<Page<CatalogListItem>>(
          resolveTarget(opts),
          '/system/catalog',
          q ? 'search' : 'list',
          { ...(q ? { q } : {}), ...(pageOpts ? { opts: pageOpts } : {}) },
        )
        if (asJson) {
          printJson(result)
          return
        }
        const items = result.items ?? []
        if (items.length === 0) {
          printLine(q ? `(no integration matches "${q}")` : '(no built-in integrations on this host)')
          return
        }
        printLine(table(
          ['ID', 'KINDS', 'EXPORTS', 'CREDENTIAL'],
          items.map(i => [
            i.id,
            i.nodeKinds.join(','),
            i.exports.join(','),
            i.needsOAuth
              ? 'oauth (authorize after mount)'
              : i.credentialFields !== undefined
                ? i.credentialFields.map(f => f.key).join(',')
                : 'single api key',
          ]),
        ))
        if (result.cursor !== undefined) printLine(`\nnext: --cursor ${result.cursor}`)
      })
    })
}

/**
 * `tb integration add <path> --provider <id>` —— 配凭证 + 挂载(+ oauth 提示)一步完成。
 *
 * 凭证四种给法互斥:`--key`(单值)/ `--key-stdin`(单值,推荐)/ `--field k=v`(多字段)
 * / `--secret <name>`(复用已有 secret)。前三种会**代建 secret**,名字由路径派生
 * (`integration-<path>`),用户不必也不该记住它。
 */
export function integrationAddCommand(): Command {
  return withGlobalOpts(new Command('add'))
    .description('Configure credentials and mount an integration in one step')
    .argument('<path>', 'Tree path to mount at')
    .requiredOption('--provider <id>', 'Integration id (see `tb integration catalog`)')
    .option('--export <id>', 'Which export to mount (required when the provider has more than one)')
    .option('--key <value>', 'Single-value credential (prefer --key-stdin: argv is world-readable)')
    .option('--key-stdin', 'Read the single-value credential from stdin')
    .option('--field <key=value>', 'One field of a multi-field credential (repeatable)', collect, [])
    .option('--secret <name>', 'Reuse an existing secret instead of creating one')
    .option('--config <key=value>', 'Non-secret provider config, e.g. baseUrl (repeatable)', collect, [])
    .option('--description <text>', 'One-line node description (default: auto-generated)')
    .addHelpText('after', `
Examples:
  tb integration add tools/tavily --provider tavily --key-stdin < key.txt
  tb integration add tools/jira --provider jira --field baseUrl=https://x.atlassian.net --field personalAccessToken=…
  tb integration add notes/memos --provider memos --key-stdin --config baseUrl=https://memos.example.com
  tb integration add tools/sentry --provider sentry --secret sentry-oauth-client   # then: tb integration auth tools/sentry`)
    .action(async (pathArg: string, opts: IntegrationAddOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const path = String(pathArg ?? '').trim()
        if (!path) throw new CliError('tree path is required')
        const provider = String(opts.provider ?? '').trim()
        if (!provider) throw new CliError('--provider is required')
        const exportId = opts.export !== undefined ? String(opts.export).trim() : undefined
        const target = resolveTarget(opts)

        const sources = [
          opts.key !== undefined ? '--key' : undefined,
          opts.keyStdin === true ? '--key-stdin' : undefined,
          opts.field.length > 0 ? '--field' : undefined,
          opts.secret !== undefined ? '--secret' : undefined,
        ].filter((s): s is string => s !== undefined)
        if (sources.length > 1) {
          throw new CliError(`${sources.join(' / ')} are mutually exclusive`)
        }

        const entry = await catalogEntry(target, provider)

        // 目录知道该 export 存在几个:多 export 而没指定,本地就能拦(免一次往返)。
        if (entry !== undefined && exportId === undefined && entry.exports.length > 1) {
          throw new CliError(
            `provider "${provider}" has multiple exports (${entry.exports.join(', ')}); `
            + 'pick one with --export',
          )
        }
        if (entry !== undefined && exportId !== undefined && !entry.exports.includes(exportId)) {
          throw new CliError(
            `provider "${provider}" has no export "${exportId}" (declared: ${entry.exports.join(', ')})`,
          )
        }

        // 目标节点 kind 由 export 的 profile 决定;单一 kind 时可自动判定。
        const nodeKind = entry?.nodeKinds.length === 1 ? entry.nodeKinds[0]! : 'tool'

        let authRef = opts.secret !== undefined ? String(opts.secret).trim() : undefined
        let createdSecret: string | undefined
        let secretFields: string[] | undefined

        if (opts.field.length > 0) {
          const fields = parseFields(opts.field)
          assertFieldNames(entry, exportId, Object.keys(fields))
          authRef = derivedSecretName(path)
          secretFields = Object.keys(fields).sort()
          await callTool(target, '/system/secret', 'set', {
            name: authRef,
            value: encodeCredentialValues(fields),
          })
          createdSecret = authRef
        } else if (opts.key !== undefined || opts.keyStdin === true) {
          const value = opts.keyStdin === true ? await readStdin() : String(opts.key)
          if (value === '') throw new CliError('credential value is empty')
          // 声明了多字段却给单值:平台会在挂载时拒,这里先说清该怎么给。
          if (entry?.credentialFields !== undefined && entry.credentialFields.length > 1) {
            throw new CliError(
              `provider "${provider}" needs multiple credential fields `
              + `(${entry.credentialFields.map(f => f.key).join(', ')}); use --field key=value`,
            )
          }
          authRef = derivedSecretName(path)
          await callTool(target, '/system/secret', 'set', { name: authRef, value })
          createdSecret = authRef
        }

        const providerConfig = parseConfigSpecs(opts.config)
        const config: NodeConfig = nodeKind === 'context'
          ? {
              kind: 'context',
              provider,
              ...(exportId ? { export: exportId } : {}),
              ...(authRef ? { authRef } : {}),
              ...(providerConfig ? { providerConfig } : {}),
            } as NodeConfig
          : {
              kind: 'tool',
              provider,
              ...(exportId ? { export: exportId } : {}),
              ...(authRef ? { authRef } : {}),
              ...(providerConfig ? { providerConfig } : {}),
            } as NodeConfig

        const input: NodeInput = {
          path,
          kind: nodeKind,
          description: opts.description
            ? String(opts.description)
            : `${provider} integration at ${path}`,
          config,
        }

        const node = await registerNode(target, input)

        if (asJson) {
          printJson({
            node,
            ...(createdSecret !== undefined ? { createdSecret } : {}),
            ...(secretFields !== undefined ? { secretFields } : {}),
            needsAuthorization: entry?.needsOAuth ?? false,
          })
          return
        }
        if (createdSecret !== undefined) {
          printLine(
            `created secret: ${createdSecret}`
            + (secretFields !== undefined ? ` (fields: ${secretFields.join(', ')})` : ''),
          )
        }
        printLine(`mounted ${provider} at ${path}`)
        // 目录说得准就精确提示,说不准(external plugin)才给条件式那句。
        if (entry?.needsOAuth === true) {
          printLine(`next: run \`tb integration auth ${path}\` to authorize ${provider}`)
        } else if (entry === undefined && authRef !== undefined) {
          printLine(`note: if this export declares oauth, run \`tb integration auth ${path}\``)
        } else {
          printLine(`try: tb help ${path}`)
        }
      })
    })
}

/**
 * `tb integration auth <path>` —— OAuth 授权。
 *
 * **复用 `toolAuthCommand` 本体**而不是转发或重实现:那条链有 `--local` 逃生阀
 * (严格上游只放行 loopback redirect)、浏览器打开、redirect 拒绝的降级指引,
 * 抄一遍必然漂移。同一个 Command 挂在两处,行为逐字相同。
 */
export function integrationAuthCommand(): Command {
  return toolAuthCommand()
}

/**
 * `tb integration ls` —— **实例视图**:已挂载的集成有哪些。
 *
 * 不是新的权威表:它就是 `system/registry list` 按"kind 是 tool/context 且 config.provider
 * 不是内置 r2/s3"过滤出来的投影。一个 instance = 一次挂载,身份 = 节点 path。
 */
export function integrationLsCommand(): Command {
  return withPageOpts(withGlobalOpts(new Command('ls')))
    .description('List mounted integrations (a projection over the node registry)')
    .action(async (opts: CommonOpts & { cursor?: string, limit?: string }) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const pageOpts = parsePageOpts(opts)
        const page = await callTool<Page<{
          config?: Record<string, unknown>
          kind: string
          path: string
        }>>(
          resolveTarget(opts),
          '/system/registry',
          'list',
          { ...(pageOpts ? { opts: pageOpts } : {}) },
        )
        const items = (page.items ?? []).filter((n) => {
          if (n.kind !== 'tool' && n.kind !== 'context') return false
          const provider = n.config?.provider
          return typeof provider === 'string' && provider !== 'r2' && provider !== 's3'
        })
        if (asJson) {
          printJson({ items, ...(page.cursor !== undefined ? { cursor: page.cursor } : {}) })
          return
        }
        if (items.length === 0) {
          printLine('(no integrations mounted; see `tb integration catalog`)')
          return
        }
        printLine(table(
          ['PATH', 'KIND', 'PROVIDER', 'CREDENTIAL'],
          items.map(n => [
            n.path,
            n.kind,
            String(n.config?.provider ?? '?'),
            typeof n.config?.authRef === 'string' ? String(n.config.authRef) : '(none)',
          ]),
        ))
        if (page.cursor !== undefined) printLine(`\nnext: --cursor ${page.cursor}`)
      })
    })
}

/**
 * `tb integration rm <path>` —— 卸载。
 *
 * **对称性**:挂载走 `~register`(register scope),卸载此前只能走 `system/registry delete`
 * (admin)—— 能装不能卸是权限面的不对称。这里仍走管理面(协议未变),但把它放进同一个
 * 命令族,并在 404 时给出可操作提示。`--purge` 连带删掉 add 代建的那个 secret。
 */
export function integrationRmCommand(): Command {
  return withGlobalOpts(new Command('rm'))
    .description('Unmount an integration (optionally delete the secret `add` created)')
    .argument('<path>', 'Mounted integration path')
    .option('--purge', 'Also delete the derived secret (integration-<path>), if any')
    .action(async (pathArg: string, opts: CommonOpts & { purge?: boolean }) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const path = String(pathArg ?? '').trim()
        if (!path) throw new CliError('tree path is required')
        const target = resolveTarget(opts)
        await callTool(target, '/system/registry', 'delete', { path })
        let purged: string | undefined
        if (opts.purge === true) {
          const name = derivedSecretName(path)
          try {
            await callTool(target, '/system/secret', 'delete', { name })
            purged = name
          } catch {
            // 没有派生 secret(用了 --secret 复用现成的,或本来不需要凭证):不是错误。
          }
        }
        if (asJson) printJson({ ok: true, path, ...(purged !== undefined ? { purged } : {}) })
        else {
          printLine(`unmounted ${path}`)
          if (purged !== undefined) printLine(`deleted secret: ${purged}`)
        }
      })
    })
}

export function integrationCommand(): Command {
  const cmd = new Command('integration')
    .alias('int')
    .description('Integrations: browse the catalog, mount with credentials, authorize')
    .addHelpText('after', `
A single integration = one mount. Mount the same provider twice for two accounts.

Examples:
  tb integration catalog --search tavily
  tb integration add tools/tavily --provider tavily --key-stdin < key.txt
  tb integration ls
  tb integration rm tools/tavily --purge`)
  cmd.addCommand(integrationCatalogCommand())
  cmd.addCommand(integrationAddCommand())
  cmd.addCommand(integrationAuthCommand())
  cmd.addCommand(integrationLsCommand())
  cmd.addCommand(integrationRmCommand())
  return cmd
}
