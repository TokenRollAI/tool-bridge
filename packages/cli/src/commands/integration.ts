/**
 * `tb integration` —— 集成的**用户面**:浏览目录 → 一条命令配好凭证并挂载 → 需要时授权。
 *
 * 为什么另起一个命令族:此前挂一个内置 provider 要串起四个概念、三条命令 ——
 * `tb integration catalog` 看有什么、`tb secret set --name X` 起个**自由文本**
 * 名字、`tb tool mount --provider p --auth-ref X` 手打同一个名字(拼错不报错,agent
 * 首次调用才 401)、oauth 型还要 `tb tool auth`。用户心智里这是一件事。
 *
 * 故 `integration add` 做**编排**而不是新协议:secret set(若给了内联凭证)→ mount
 * → 提示或自动授权。底下仍是 `system/secret` 与 `~register`,没有新的权威存储。
 * `tb tool mount` / `tb ctx mount` 保留(树面的动词仍是 mount,协议不变)。
 */

import { encodeCredentialValues } from '@tool-bridge/core'
import { Command } from 'commander'
import type { NodeConfig, NodeInput, Page, SecretSummary } from '../types'
import { collect, parsePageOpts, resolveTarget, withGlobalOpts, withPageOpts } from '../args'
import { deleteNode, parseConfigSpecs, registerNode } from '../registry'
import { printJson, printLine, table } from '../output'
import { confirmDestructive } from '../confirm'
import { callDirect, CliError } from '../http'
import { toolAuthCommand } from './tool'

/** system/catalog 的列表项(core builtin/catalog 的 CatalogListItem)。 */
interface CatalogListItem {
  description?: string
  digest: string
  exportDetails: Record<string, CatalogExportDetails>
  exports: string[]
  id: string
  nodeKinds: Array<'context' | 'tool'>
}

interface CatalogCredentialField {
  description?: string
  key: string
  label?: string
  required?: boolean
  secret?: boolean
}

interface CatalogMountConfigField {
  description?: string
  key: string
  label?: string
  required?: boolean
}

type CatalogExportAuth
  = | { fields: CatalogCredentialField[], kind: 'fields' }
    | { kind: 'none' }
    | { kind: 'oauth' }
    | { description?: string, kind: 'single', label?: string, required: boolean }

interface CatalogExportDetails {
  auth: CatalogExportAuth
  description?: string
  id: string
  kind: 'context' | 'tool'
  mountConfigFields?: CatalogMountConfigField[]
}

type SecretExistence = 'absent' | 'exists' | 'unknown'

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
    const page = await callDirect<Page<CatalogListItem>>(
      target, '/system/catalog/search',
      { q: provider },
    )
    return (page.items ?? []).find(i => i.id === provider)
  } catch {
    // 无 read 权限、或宿主没装 catalog:降级为"不给提示",不阻断挂载。
    return undefined
  }
}

/** 目录按 export 给出唯一的精确契约。 */
function detailsFor(
  entry: CatalogListItem | undefined,
  exportId: string | undefined,
): CatalogExportDetails | undefined {
  if (entry === undefined) return undefined
  const id = exportId ?? (entry.exports.length === 1 ? entry.exports[0] : undefined)
  return id === undefined ? undefined : entry.exportDetails[id]
}

/** 字段名校验:挂载前就拒掉拼错的字段,而不是等 agent 首次调用收 401。 */
function assertFieldNames(
  entry: CatalogListItem | undefined,
  details: CatalogExportDetails | undefined,
  given: string[],
): void {
  const fields = details?.auth.kind === 'fields'
    ? details.auth.fields
    : details?.auth.kind === 'oauth'
      ? [{ key: 'clientId' }, { key: 'clientSecret' }]
      : undefined
  const declared = fields?.map(f => f.key)
  if (declared === undefined || declared.length === 0) return
  const unknown = given.filter(k => !declared.includes(k))
  if (unknown.length > 0) {
    throw new CliError(
      `unknown credential field(s) for "${entry!.id}" export "${details!.id}": `
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

/**
 * 必填的非凭证配置(如 memos 的 baseUrl)缺了就在挂载前拦 —— 否则要么 credentialProbe
 * 报个看着像凭证问题的错,要么等 agent 首次调用才 invalid_argument。
 *
 * 只校验**必填缺失**,不拦未知 key:providerConfig 允许 export 未声明的额外配置
 * (mountConfigFields 是"该配什么"的提示,不是白名单),且 catalog 查不到时(external
 * plugin / 无 read 权限)整个校验跳过 —— 与凭证字段校验同一"尽力而为"姿势。
 */
function assertMountConfig(
  entry: CatalogListItem | undefined,
  details: CatalogExportDetails | undefined,
  given: Record<string, string> | undefined,
): void {
  const fields = details?.mountConfigFields
  if (fields === undefined) return
  const provided = new Set(Object.keys(given ?? {}))
  const missing = fields.filter(f => f.required === true && !provided.has(f.key)).map(f => f.key)
  if (missing.length > 0) {
    throw new CliError(
      `missing required config for "${entry!.id}": ${missing.join(', ')} `
      + `(pass with --config ${missing[0]}=…)`,
    )
  }
}

/**
 * 内置集成的内部凭证槽。encodeURIComponent 对完整 path 是一一映射，故 `a/b` 与 `a-b`
 * 不会让 `a/b` 与 `a-b` 碰撞。这个名字只进入 wire，不属于用户输出。
 */
export function derivedSecretName(path: string): string {
  return `integration-${encodeURIComponent(path.trim())}`
}

/**
 * secret set 是 upsert。挂载失败前只有确认槽位原本不存在，才允许删除本轮写入；
 * 列表无权限/中途失败一律视为 unknown，宁可保留不可见孤儿也不误删既有凭证。
 */
async function secretExistence(
  target: ReturnType<typeof resolveTarget>,
  name: string,
): Promise<SecretExistence> {
  let cursor: string | undefined
  try {
    do {
      const page = await callDirect<Page<SecretSummary>>(
        target, '/system/secret/list',
        { opts: { limit: 200, ...(cursor !== undefined ? { cursor } : {}) } },
      )
      if ((page.items ?? []).some(item => item.name === name)) return 'exists'
      cursor = page.cursor
    } while (cursor !== undefined)
    return 'absent'
  } catch {
    return 'unknown'
  }
}

/** `tb integration catalog` → system/catalog list/search(read scope,非 admin)。 */
export function integrationCatalogCommand() {
  return withPageOpts(withGlobalOpts(new Command('catalog')))
    .description('Browse built-in integrations available on this host (read-only)')
    .option('--search <q>', 'Case-insensitive substring over id and description')
    .addHelpText('after', `
Examples:
  tb integration catalog                    # everything this host bundles
  tb integration catalog --search jira      # narrow by name/description
  tb integration add tools/tavily --provider tavily --key-stdin < key.txt`)
    .action(async (opts) => {
      const asJson = Boolean(opts.json)
      const pageOpts = parsePageOpts(opts)
      const q = opts.search !== undefined ? String(opts.search).trim() : undefined
      const result = await callDirect<Page<CatalogListItem>>(
        resolveTarget(opts), `/system/catalog/${q ? 'search' : 'list'}`,
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
        ['ID', 'KINDS', 'EXPORTS', 'CREDENTIAL', 'CONFIG'],
        items.map(i => [
          i.id,
          i.nodeKinds.join(','),
          i.exports.join(','),
          i.exports.map((id) => {
            const auth = detailsFor(i, id)?.auth
            if (auth?.kind === 'oauth') return `${id}:oauth`
            if (auth?.kind === 'none') return `${id}:none`
            if (auth?.kind === 'fields') return `${id}:${auth.fields.map(f => f.key).join('+')}`
            return `${id}:api-key${auth?.required === true ? '*' : ''}`
          }).join(';'),
          i.exports.map((id) => {
            const fields = detailsFor(i, id)?.mountConfigFields
            return fields === undefined
              ? `${id}:—`
              : `${id}:${fields.map(f => (f.required === true ? `${f.key}*` : f.key)).join('+')}`
          }).join(';'),
        ]),
      ))
      if (result.cursor !== undefined) printLine(`\nnext: --cursor ${result.cursor}`)
    })
}

/**
 * `tb integration add <path> --provider <id>` —— 配凭证 + 挂载(+ oauth 提示)一步完成。
 *
 * 凭证四种给法互斥:`--key`(单值)/ `--key-stdin`(单值,推荐)/ `--field k=v`(多字段)
 * / `--credential <name>`(复用已保存凭证)。前三种会由平台自动托管,内部槽位不进用户输出。
 */
export function integrationAddCommand() {
  return withGlobalOpts(new Command('add'))
    .description('Configure credentials and mount an integration in one step')
    .argument('<path>', 'Tree path to mount at')
    .requiredOption('--provider <id>', 'Integration id (see `tb integration catalog`)')
    .option('--export <id>', 'Which export to mount (required when the provider has more than one)')
    .option('--key <value>', 'Single-value credential (prefer --key-stdin: argv is world-readable)')
    .option('--key-stdin', 'Read the single-value credential from stdin')
    .option('--field <key=value>', 'One field of a multi-field credential (repeatable)', collect, [])
    .option('--credential <name>', 'Reuse a saved credential')
    .option('--config <key=value>', 'Non-secret provider config, e.g. baseUrl (repeatable)', collect, [])
    .option('--description <text>', 'One-line node description (default: auto-generated)')
    .addHelpText('after', `
Examples:
  tb integration add tools/tavily --provider tavily --key-stdin < key.txt
  tb integration add tools/jira --provider jira --field baseUrl=https://x.atlassian.net --field personalAccessToken=…
  tb integration add notes/memos --provider memos --key-stdin --config baseUrl=https://memos.example.com
  tb integration add tools/sentry --provider sentry --credential sentry-oauth-client   # then: tb integration auth tools/sentry`)
    .action(async (pathArg, opts) => {
      const asJson = Boolean(opts.json)
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
        opts.credential !== undefined ? '--credential' : undefined,
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
      const details = detailsFor(entry, exportId)

      // 目标节点 kind 由**选中 export** 的 profile 决定。多 export 跨 kind 的 provider
      // (如 notes:actions=tool / notes=context)必须按 exportId 取,否则挂 context export
      // 会落到默认 'tool' 被平台拒且无解。catalog 查不到 external plugin 时才退回 tool。
      const nodeKind: 'context' | 'tool'
        = details?.kind ?? 'tool'

      // 挂载配置在**任何写操作之前**解析并校验:缺必填 baseUrl 就该在这里拒,
      // 而不是等 secret 已经代建出来才炸(那会留下孤儿 secret)。
      const providerConfig = parseConfigSpecs(opts.config)
      assertMountConfig(entry, details, providerConfig)

      if (details?.auth.kind === 'none' && sources.length > 0) {
        throw new CliError(`provider "${provider}" export "${details.id}" does not accept credentials`)
      }
      if (details?.auth.kind === 'single' && details.auth.required && sources.length === 0) {
        throw new CliError(`provider "${provider}" export "${details.id}" requires a credential`)
      }
      if (
        (details?.auth.kind === 'fields' || details?.auth.kind === 'oauth')
        && sources.length === 0
      ) {
        throw new CliError(`provider "${provider}" export "${details.id}" requires credentials`)
      }

      const savedCredential = opts.credential
      let authRef = savedCredential !== undefined ? String(savedCredential).trim() : undefined
      if (savedCredential !== undefined && authRef === '') {
        throw new CliError('saved credential name is empty')
      }
      let managedCredential: string | undefined
      let shouldDeleteOnFailure = false
      let secretFields: string[] | undefined

      if (opts.field.length > 0) {
        const fields = parseFields(opts.field)
        if (details?.auth.kind === 'single' || details?.auth.kind === 'none') {
          throw new CliError(`provider "${provider}" export "${details.id}" does not use --field`)
        }
        assertFieldNames(entry, details, Object.keys(fields))
        authRef = derivedSecretName(path)
        shouldDeleteOnFailure = await secretExistence(target, authRef) === 'absent'
        secretFields = Object.keys(fields).sort()
        await callDirect(target, '/system/secret/set', {
          name: authRef,
          value: encodeCredentialValues(fields),
        })
        managedCredential = authRef
      } else if (opts.key !== undefined || opts.keyStdin === true) {
        const value = opts.keyStdin === true ? await readStdin() : String(opts.key)
        if (value === '') throw new CliError('credential value is empty')
        // 声明了多字段却给单值:平台会在挂载时拒,这里先说清该怎么给。
        const declaredFields = details?.auth.kind === 'fields' ? details.auth.fields : undefined
        if (declaredFields !== undefined && declaredFields.length > 1) {
          throw new CliError(
            `provider "${provider}" needs multiple credential fields `
            + `(${declaredFields.map(f => f.key).join(', ')}); use --field key=value`,
          )
        }
        if (details?.auth.kind === 'oauth') {
          throw new CliError(
            'oauth credentials need --field clientId=… --field clientSecret=… or --credential',
          )
        }
        authRef = derivedSecretName(path)
        shouldDeleteOnFailure = await secretExistence(target, authRef) === 'absent'
        await callDirect(target, '/system/secret/set', { name: authRef, value })
        managedCredential = authRef
      }

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

      let node: Awaited<ReturnType<typeof registerNode>>
      try {
        node = await registerNode(target, input)
      } catch (error) {
        // 仅确认此前不存在的内部槽位可清理；同名既有/存在性未知的凭证绝不删除。
        if (managedCredential !== undefined && shouldDeleteOnFailure) {
          await callDirect(target, '/system/secret/delete', { name: managedCredential }).catch(() => {})
        }
        throw error
      }

      if (asJson) {
        const visibleConfig = { ...(node.config ?? {}) } as Record<string, unknown>
        const credential = typeof visibleConfig.authRef === 'string' ? 'managed' : 'none'
        delete visibleConfig.authRef
        printJson({
          node: { ...node, config: visibleConfig, credential },
          ...(managedCredential !== undefined ? { credentialStored: true } : {}),
          ...(secretFields !== undefined ? { secretFields } : {}),
          needsAuthorization: details?.auth.kind === 'oauth',
        })
        return
      }
      if (managedCredential !== undefined) printLine('credential stored and managed by the platform')
      printLine(`mounted ${provider} at ${path}`)
      // 目录说得准就精确提示,说不准(external plugin)才给条件式那句。
      if (details?.auth.kind === 'oauth') {
        printLine(`next: run \`tb integration auth ${path}\` to authorize ${provider}`)
      } else if (entry === undefined && authRef !== undefined) {
        printLine(`note: if this export declares oauth, run \`tb integration auth ${path}\``)
      } else {
        printLine(`try: tb help ${path}`)
      }
    })
}

/**
 * `tb integration auth <path>` —— OAuth 授权。
 *
 * **复用 `toolAuthCommand` 本体**而不是转发或重实现:那条链有 `--local` 逃生阀
 * (严格上游只放行 loopback redirect)、浏览器打开、redirect 拒绝的降级指引,
 * 抄一遍必然漂移。同一个 Command 挂在两处,行为逐字相同。
 */
export function integrationAuthCommand() {
  return toolAuthCommand()
}

/**
 * `tb integration ls` —— **实例视图**:已挂载的集成有哪些。
 *
 * 不是新的权威表:它就是 `system/registry list` 按"kind 是 tool/context 且 config.provider
 * 不是内置 r2/s3"过滤出来的投影。一个 instance = 一次挂载,身份 = 节点 path。
 */
export function integrationLsCommand() {
  return withPageOpts(withGlobalOpts(new Command('ls')))
    .description('List mounted integrations (a projection over the node registry)')
    .action(async (opts) => {
      const asJson = Boolean(opts.json)
      const pageOpts = parsePageOpts(opts)
      const page = await callDirect<Page<{
        config?: Record<string, unknown>
        kind: string
        path: string
      }>>(
        resolveTarget(opts), '/system/registry/list',
        { ...(pageOpts ? { opts: pageOpts } : {}) },
      )
      const items = (page.items ?? []).filter((n) => {
        if (n.kind !== 'tool' && n.kind !== 'context') return false
        const provider = n.config?.provider
        return typeof provider === 'string' && provider !== 'r2' && provider !== 's3'
      })
      const visibleItems = items.map((node) => {
        const config = { ...(node.config ?? {}) }
        const managed = typeof config.authRef === 'string'
        delete config.authRef
        return { ...node, config, credential: managed ? 'managed' : 'none' }
      })
      if (asJson) {
        printJson({
          items: visibleItems,
          ...(page.cursor !== undefined ? { cursor: page.cursor } : {}),
        })
        return
      }
      if (items.length === 0) {
        printLine('(no integrations mounted; see `tb integration catalog`)')
        return
      }
      printLine(table(
        ['PATH', 'KIND', 'PROVIDER', 'CREDENTIAL'],
        visibleItems.map(n => [
          n.path,
          n.kind,
          String(n.config?.provider ?? '?'),
          n.credential,
        ]),
      ))
      if (page.cursor !== undefined) printLine(`\nnext: --cursor ${page.cursor}`)
    })
}

/**
 * `tb integration rm <path>` —— 卸载。
 *
 * **对称性**:挂载走 `~register`(register scope),卸载此前只能走 `system/registry delete`
 * (admin)—— 能装不能卸是权限面的不对称。这里仍走管理面(协议未变),但把它放进同一个
 * 命令族,并在 404 时给出可操作提示。凭证生命周期仍由 `tb secret` 显式管理。
 *
 * **kind 守卫**:集成挂载只会产生 tool/context 节点(见 add 的 nodeKind),卸载必须限定这两类。
 * 此前直打 `system/registry delete` 无校验,`tb integration rm device/build-01` 会误删设备节点。
 * 走 deleteNode 先 get 校验 kind,越界即拒。
 */
export function integrationRmCommand() {
  return withGlobalOpts(new Command('rm'))
    .description('Unmount an integration (tool/context nodes only)')
    .argument('<path>', 'Mounted integration path')
    .option('--yes', 'Skip the confirmation prompt')
    .action(async (pathArg, opts) => {
      const asJson = Boolean(opts.json)
      const path = String(pathArg ?? '').trim()
      if (!path) throw new CliError('tree path is required')
      await confirmDestructive(opts, `Unmount integration at ${path}?`)
      await deleteNode(resolveTarget(opts), path, ['tool', 'context'])
      if (asJson) printJson({ ok: true, path })
      else printLine(`unmounted ${path}`)
    })
}

export function integrationCommand() {
  const cmd = new Command('integration')
    .alias('int')
    .description('Integrations: browse the catalog, mount with credentials, authorize')
    .addHelpText('after', `
A single integration = one mount. Mount the same provider twice for two accounts.

Examples:
  tb integration catalog --search tavily
  tb integration add tools/tavily --provider tavily --key-stdin < key.txt
  tb integration ls
  tb integration rm tools/tavily`)
  cmd.addCommand(integrationCatalogCommand())
  cmd.addCommand(integrationAddCommand())
  cmd.addCommand(integrationAuthCommand())
  cmd.addCommand(integrationLsCommand())
  cmd.addCommand(integrationRmCommand())
  return cmd
}
