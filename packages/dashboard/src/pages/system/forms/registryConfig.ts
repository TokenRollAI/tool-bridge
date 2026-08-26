import type {
  CatalogListItem,
  PluginCredentialField,
  PluginExport,
  PluginManifest,
  PluginProfile,
  RegistryNode,
} from '@/lib/types'
import {
  buildCredentialBinding,
  type CredentialInputPlan,
  initialManagedCredential,
  type ManagedCredentialFormState,
} from './managedCredential'

export type MountKind = 'mcp' | 'http' | 'context' | 'skillhub' | 'remote' | 'tool'
export type AuthSchemeMode = 'bearer' | 'raw' | 'custom'

export interface RegistryMountFormState {
  authHeader: string
  authScheme: string
  baseUrl: string
  ctxAuthRef: string
  ctxCredential: ManagedCredentialFormState
  ctxExport: string
  ctxPrefix: string
  describeSpec: string
  description: string
  endpoint: string
  hideSpec: string
  httpAuthRef: string
  httpSchemeMode: AuthSchemeMode
  kind: MountKind
  mcpAuthHeader: string
  mcpAuthMode: 'none' | 'authRef' | 'oauth'
  mcpAuthRef: string
  mcpAuthScheme: string
  mcpHeadersSpec: string
  mcpOAuthClientId: string
  mcpOAuthClientSecretRef: string
  mcpSchemeMode: AuthSchemeMode
  mcpUrl: string
  path: string
  pluginConfig: Record<string, string>
  prefix: string
  provider: string
  readOnly: boolean
  renameSpec: string
  s3Bucket: string
  s3Endpoint: string
  s3Region: string
  skillProvider: 'r2' | 's3'
  skRef: string
  toolAuthRef: string
  toolCredential: ManagedCredentialFormState
  toolExport: string
  toolProvider: string
  toolsJson: string
  ttl: string
}

export const INITIAL_REGISTRY_MOUNT_FORM: RegistryMountFormState = {
  authHeader: '',
  authScheme: '',
  baseUrl: '',
  ctxAuthRef: '',
  ctxCredential: initialManagedCredential(),
  ctxExport: '',
  ctxPrefix: '',
  describeSpec: '',
  description: '',
  endpoint: '',
  hideSpec: '',
  httpAuthRef: '',
  httpSchemeMode: 'bearer',
  kind: 'mcp',
  mcpAuthHeader: '',
  mcpAuthMode: 'none',
  mcpAuthRef: '',
  mcpAuthScheme: '',
  mcpHeadersSpec: '',
  mcpOAuthClientId: '',
  mcpOAuthClientSecretRef: '',
  mcpSchemeMode: 'bearer',
  mcpUrl: '',
  path: '',
  pluginConfig: {},
  prefix: '',
  provider: 'r2',
  readOnly: false,
  renameSpec: '',
  s3Bucket: '',
  s3Endpoint: '',
  s3Region: '',
  skillProvider: 'r2',
  skRef: '',
  toolAuthRef: '',
  toolCredential: initialManagedCredential(),
  toolExport: '',
  toolProvider: '',
  toolsJson:
    '[\n  {\n    "name": "echo",\n    "description": "…",\n    "method": "POST",\n    "pathTemplate": "/post"\n  }\n]',
  ttl: '',
}

export function exportsForProfile(
  plugin: PluginManifest,
  profile: PluginProfile,
): PluginExport[] {
  return (plugin.exports ?? []).filter(item => item.profile === profile)
}

export function pluginsForProfile(
  plugins: PluginManifest[],
  profile: PluginProfile,
): PluginManifest[] {
  return plugins.filter(plugin =>
    plugin.exports === undefined || exportsForProfile(plugin, profile).length > 0)
}

export function exportOptionsFor(
  plugins: PluginManifest[],
  pluginId: string,
  profile: PluginProfile,
): PluginExport[] {
  const plugin = plugins.find(item => item.id === pluginId)
  return plugin === undefined ? [] : exportsForProfile(plugin, profile)
}

/** 把只读内置 catalog 投影成高级挂载器现有的 plugin/export 选择形状。 */
export function catalogPluginsForMount(items: CatalogListItem[]): PluginManifest[] {
  return items.map(item => ({
    auth: { kind: 'platform-token' },
    enabled: true,
    endpoint: `binding:${item.id}`,
    exports: item.exports.map((id): PluginExport => {
      const details = item.exportDetails[id]!
      const auth = details.auth
      return {
        id,
        profile: details.kind === 'context'
          ? 'context/v1'
          : 'tools/v1',
        ...(details.description !== undefined ? { description: details.description } : {}),
        ...(details.mountConfigFields !== undefined
          ? { mountConfigFields: details.mountConfigFields }
          : {}),
        ...(auth?.kind === 'fields'
          ? { credentialFields: auth.fields }
          : {}),
        ...(auth?.kind === 'none' || auth?.kind === 'single' ? { auth } : {}),
        // 这里只供 Dashboard 判断“挂载后要授权”,端点全文仍以 gateway 的 describe 为真源。
        ...(auth?.kind === 'oauth'
          ? { oauth: { authorizationUrl: '', tokenUrl: '' } }
          : {}),
      }
    }),
    healthPath: '/healthz',
    id: item.id,
    protocolVersion: 'plugin/v2',
  }))
}

export function parsePairs(spec: string, field: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of spec.split('\n')) {
    const value = line.trim()
    if (!value) continue
    const index = value.indexOf('=')
    const from = index < 0 ? '' : value.slice(0, index).trim()
    const to = index < 0 ? '' : value.slice(index + 1).trim()
    if (!from || !to) throw new Error(`${field} 每行须为 "from=to" 形式:"${value}"`)
    out[from] = to
  }
  return out
}

export function resolvePluginExport(
  chosen: string,
  options: PluginExport[],
  pluginId: string,
): string {
  const picked = chosen.trim()
  if (picked) return picked
  if (options.length > 1) {
    throw new Error(
      `plugin '${pluginId}' 有多个 export(${options.map(item => item.id).join(', ')}),挂载须指定 export`,
    )
  }
  return ''
}

function selectedExport(options: PluginExport[], chosen: string): PluginExport | undefined {
  const id = chosen.trim()
  return id === '' ? options[0] : options.find(item => item.id === id)
}

/**
 * 按选中的 export 计算凭证形状。`secret:false` 只影响展示,字段仍全部走 authRef;
 * 非凭证配置由独立的 `mountConfigFields` 驱动并写入 providerConfig。
 */
export function credentialPlanFor(
  exports: PluginExport[],
  exportId: string,
): {
  authRequired: boolean
  kind: 'none' | 'oauth' | 'fields' | 'single'
  oauth?: PluginExport['oauth']
  probe?: string
  /** 走 authRef 那个 secret 的字段 —— 声明了 credentialFields 就是全部。 */
  secretFields: PluginCredentialField[]
} {
  // exportId 为空时取第一个 —— 与“单 export 可留空”的表单语义一致。
  const target = selectedExport(exports, exportId)
  if (target === undefined) return { authRequired: false, kind: 'single', secretFields: [] }
  if (target.auth?.kind === 'none') {
    return { authRequired: false, kind: 'none', secretFields: [] }
  }
  if (target.oauth !== undefined) {
    return { authRequired: true, kind: 'oauth', secretFields: [], oauth: target.oauth }
  }
  const fields = target.credentialFields ?? []
  if (fields.length === 0) {
    return {
      kind: 'single',
      authRequired: target.auth?.kind === 'single' && target.auth.required === true,
      secretFields: [],
      ...(target.credentialProbe !== undefined ? { probe: target.credentialProbe } : {}),
    }
  }
  return {
    authRequired: true,
    kind: 'fields',
    secretFields: fields,
    ...(target.credentialProbe !== undefined ? { probe: target.credentialProbe } : {}),
  }
}

function credentialInputPlanFor(exports: PluginExport[], exportId: string): CredentialInputPlan {
  const plan = credentialPlanFor(exports, exportId)
  return {
    authRequired: plan.authRequired,
    fields: plan.secretFields,
    kind: plan.kind,
  }
}

function pluginProviderConfig(
  options: PluginExport[],
  chosen: string,
  values: Record<string, string>,
): Record<string, string> | undefined {
  const fields = selectedExport(options, chosen)?.mountConfigFields ?? []
  const config: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    const trimmed = value.trim()
    if (key.trim() !== '' && trimmed !== '') config[key.trim()] = trimmed
  }
  const missing = fields
    .filter(field => field.required === true && (config[field.key] ?? '') === '')
    .map(field => field.key)
  if (missing.length > 0) throw new Error(`缺必填配置:${missing.join('、')}`)
  return Object.keys(config).length > 0 ? config : undefined
}

function assertPluginAuthRef(options: PluginExport[], chosen: string, authRef: string): void {
  const plan = credentialPlanFor(options, chosen)
  const hasAuthRef = authRef.trim() !== ''
  if (plan.kind === 'none' && hasAuthRef) throw new Error('该 export 声明无需凭证,不要填写 authRef')
  if (plan.authRequired && !hasAuthRef) throw new Error('该 export 需要 authRef')
}

function parseTtl(value: string): number | undefined {
  if (!value.trim()) return undefined
  const ttl = Number(value.trim())
  if (!Number.isInteger(ttl) || ttl <= 0) throw new Error('ttl 须为正整数秒')
  return ttl
}

export function buildRegistryVirtualize(state: RegistryMountFormState) {
  if (state.kind !== 'mcp' && state.kind !== 'http' && state.kind !== 'tool') return undefined
  const virtualize: Record<string, unknown> = {}
  if (state.prefix.trim()) virtualize.prefix = state.prefix.trim()
  const rename = parsePairs(state.renameSpec, 'rename')
  if (Object.keys(rename).length) virtualize.rename = rename
  const hide = state.hideSpec
    .split(/[,\n]/)
    .map(value => value.trim())
    .filter(Boolean)
  if (hide.length) virtualize.hide = hide
  const describe = parsePairs(state.describeSpec, 'describe')
  if (Object.keys(describe).length) virtualize.describe = describe
  return Object.keys(virtualize).length ? virtualize : undefined
}

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE'])

function parseHttpTools(value: string): Array<Record<string, unknown>> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('tools 不是合法 JSON')
  }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('tools 需为非空数组')
  return parsed.map((tool, index) => {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
      throw new Error(`tools[${index}] 须为对象`)
    }
    const record = tool as Record<string, unknown>
    for (const field of ['name', 'description', 'method', 'pathTemplate']) {
      if (typeof record[field] !== 'string' || record[field] === '') {
        throw new Error(`tools[${index}] 缺少必填字符串字段 "${field}"`)
      }
    }
    const method = String(record.method).toUpperCase()
    if (!HTTP_METHODS.has(method)) {
      throw new Error(`tools[${index}] method "${record.method}" 非法；仅支持 GET/POST/PUT/DELETE`)
    }
    return {
      name: String(record.name),
      description: String(record.description),
      method,
      pathTemplate: String(record.pathTemplate),
      ...(record.inputSchema !== undefined ? { inputSchema: record.inputSchema } : {}),
      ...(record.effect !== undefined ? { effect: record.effect } : {}),
    }
  })
}

export function buildRegistryConfig(
  state: RegistryMountFormState,
  exports: { context: PluginExport[], tool: PluginExport[] },
): Record<string, unknown> {
  switch (state.kind) {
    case 'mcp': {
      if (!state.mcpUrl.trim()) throw new Error('url 必填')
      if (state.mcpAuthMode === 'authRef' && !state.mcpAuthRef.trim()) {
        throw new Error('authRef 必填(先在「凭证保管」set)')
      }
      if (
        state.mcpAuthMode === 'authRef'
        && state.mcpSchemeMode === 'custom'
        && !state.mcpAuthScheme.trim()
      ) {
        throw new Error('自定义 authScheme 前缀必填')
      }
      if (state.mcpAuthMode !== 'oauth' && (
        state.mcpOAuthClientId.trim() !== ''
        || state.mcpOAuthClientSecretRef.trim() !== ''
      )) {
        throw new Error('预注册 OAuth client 只能与 oauth 认证一起使用')
      }
      if (
        state.mcpAuthMode === 'oauth'
        && state.mcpOAuthClientSecretRef.trim() !== ''
        && state.mcpOAuthClientId.trim() === ''
      ) {
        throw new Error('clientSecretRef 需要同时填写 clientId')
      }
      const headers = parsePairs(state.mcpHeadersSpec, 'headers')
      return {
        kind: 'mcp',
        url: state.mcpUrl.trim(),
        ...(state.mcpAuthMode === 'authRef' ? { authRef: state.mcpAuthRef.trim() } : {}),
        ...(state.mcpAuthMode === 'oauth' ? { auth: 'oauth' } : {}),
        ...(state.mcpAuthMode === 'oauth' && state.mcpOAuthClientId.trim() !== ''
          ? {
              oauthClient: {
                clientId: state.mcpOAuthClientId.trim(),
                ...(state.mcpOAuthClientSecretRef.trim() !== ''
                  ? { clientSecretRef: state.mcpOAuthClientSecretRef.trim() }
                  : {}),
              },
            }
          : {}),
        ...(state.mcpAuthMode === 'authRef' && state.mcpAuthHeader.trim()
          ? { authHeader: state.mcpAuthHeader.trim() }
          : {}),
        ...(state.mcpAuthMode === 'authRef'
          ? state.mcpSchemeMode === 'raw'
            ? { authScheme: '' }
            : state.mcpSchemeMode === 'custom' && state.mcpAuthScheme.trim()
              ? { authScheme: state.mcpAuthScheme.trim() }
              : {}
          : {}),
        ...(Object.keys(headers).length ? { headers } : {}),
      }
    }
    case 'http': {
      if (!state.endpoint.trim()) throw new Error('endpoint 必填')
      const tools = parseHttpTools(state.toolsJson)
      if (
        !state.httpAuthRef.trim()
        && (state.authHeader.trim() || state.httpSchemeMode !== 'bearer')
      ) {
        throw new Error('authHeader/authScheme 只有同时填写 authRef 才能使用')
      }
      if (state.httpSchemeMode === 'custom' && !state.authScheme.trim()) {
        throw new Error('自定义 authScheme 前缀必填')
      }
      return {
        kind: 'http',
        endpoint: state.endpoint.trim(),
        tools,
        ...(state.httpAuthRef.trim() ? { authRef: state.httpAuthRef.trim() } : {}),
        ...(state.authHeader.trim() ? { authHeader: state.authHeader.trim() } : {}),
        ...(state.httpSchemeMode === 'raw'
          ? { authScheme: '' }
          : state.httpSchemeMode === 'custom' && state.authScheme.trim()
            ? { authScheme: state.authScheme.trim() }
            : {}),
      }
    }
    case 'context': {
      const ttl = parseTtl(state.ttl)
      if (state.provider === 's3') {
        if (!state.s3Endpoint.trim() || !state.s3Bucket.trim()) {
          throw new Error('s3 需要 endpoint 与 bucket')
        }
        if (!state.ctxAuthRef.trim()) throw new Error('s3 需要 authRef(先在「凭证保管」set)')
        return {
          kind: 'context',
          provider: 's3',
          providerConfig: {
            endpoint: state.s3Endpoint.trim(),
            bucket: state.s3Bucket.trim(),
            ...(state.s3Region.trim() ? { region: state.s3Region.trim() } : {}),
            ...(state.ctxPrefix.trim() ? { prefix: state.ctxPrefix.trim() } : {}),
          },
          authRef: state.ctxAuthRef.trim(),
          ...(state.readOnly ? { readOnly: true } : {}),
          ...(ttl !== undefined ? { ttl } : {}),
        }
      }
      if (state.provider === 'r2') {
        return {
          kind: 'context',
          provider: 'r2',
          ...(state.ctxPrefix.trim()
            ? { providerConfig: { prefix: state.ctxPrefix.trim() } }
            : {}),
          ...(state.readOnly ? { readOnly: true } : {}),
          ...(ttl !== undefined ? { ttl } : {}),
        }
      }
      const exportId = resolvePluginExport(state.ctxExport, exports.context, state.provider)
      assertPluginAuthRef(exports.context, state.ctxExport, state.ctxAuthRef)
      const providerConfig = pluginProviderConfig(
        exports.context,
        state.ctxExport,
        state.pluginConfig,
      )
      return {
        kind: 'context',
        provider: state.provider,
        ...(exportId ? { export: exportId } : {}),
        ...(state.ctxAuthRef.trim() ? { authRef: state.ctxAuthRef.trim() } : {}),
        ...(providerConfig !== undefined ? { providerConfig } : {}),
        ...(state.readOnly ? { readOnly: true } : {}),
        ...(ttl !== undefined ? { ttl } : {}),
      }
    }
    case 'skillhub': {
      const ttl = parseTtl(state.ttl)
      if (state.skillProvider === 's3') {
        if (!state.s3Endpoint.trim() || !state.s3Bucket.trim()) {
          throw new Error('s3 需要 endpoint 与 bucket')
        }
        if (!state.ctxAuthRef.trim()) throw new Error('s3 需要 authRef(先在「凭证保管」set)')
        return {
          kind: 'skillhub',
          provider: 's3',
          providerConfig: {
            endpoint: state.s3Endpoint.trim(),
            bucket: state.s3Bucket.trim(),
            ...(state.s3Region.trim() ? { region: state.s3Region.trim() } : {}),
            ...(state.ctxPrefix.trim() ? { prefix: state.ctxPrefix.trim() } : {}),
          },
          authRef: state.ctxAuthRef.trim(),
          ...(state.readOnly ? { readOnly: true } : {}),
          ...(ttl !== undefined ? { ttl } : {}),
        }
      }
      return {
        kind: 'skillhub',
        provider: 'r2',
        ...(state.ctxPrefix.trim()
          ? { providerConfig: { prefix: state.ctxPrefix.trim() } }
          : {}),
        ...(state.readOnly ? { readOnly: true } : {}),
        ...(ttl !== undefined ? { ttl } : {}),
      }
    }
    case 'remote':
      if (!state.baseUrl.trim()) throw new Error('baseUrl 必填')
      return {
        kind: 'remote',
        baseUrl: state.baseUrl.trim(),
        ...(state.skRef.trim() ? { skRef: state.skRef.trim() } : {}),
      }
    case 'tool': {
      if (!state.toolProvider) throw new Error('先选择一个 plugin(没有则去「Plugin」注册)')
      const exportId = resolvePluginExport(state.toolExport, exports.tool, state.toolProvider)
      assertPluginAuthRef(exports.tool, state.toolExport, state.toolAuthRef)
      const providerConfig = pluginProviderConfig(
        exports.tool,
        state.toolExport,
        state.pluginConfig,
      )
      return {
        kind: 'tool',
        provider: state.toolProvider,
        ...(exportId ? { export: exportId } : {}),
        ...(state.toolAuthRef.trim() ? { authRef: state.toolAuthRef.trim() } : {}),
        ...(providerConfig !== undefined ? { providerConfig } : {}),
      }
    }
  }
}

export function buildRegistryWriteArgs(
  state: RegistryMountFormState,
  exports: { context: PluginExport[], tool: PluginExport[] },
) {
  const path = state.path.trim()
  const description = state.description.trim()
  if (!path || !description) throw new Error('path 与描述必填')
  const virtualize = buildRegistryVirtualize(state)
  return {
    path,
    kind: state.kind,
    description,
    config: buildRegistryConfig(state, exports),
    ...(virtualize ? { virtualize } : {}),
  }
}

function effectiveExportId(options: PluginExport[], chosen: string): string | undefined {
  const explicit = chosen.trim()
  if (explicit !== '') return explicit
  return options.length === 1 ? options[0]!.id : undefined
}

/**
 * 替换同一内置 provider/export 时允许留空保留原凭证。跨 provider/export 绝不复用，
 * 防止把一个服务的 token 静默交给另一个服务。
 */
export function existingManagedAuthRef(
  existing: RegistryNode | undefined,
  state: RegistryMountFormState,
  exports: { context: PluginExport[], tool: PluginExport[] },
): string | undefined {
  if (existing === undefined || existing.kind !== state.kind) return undefined
  const config = existing.config
  if (config === undefined || typeof config.authRef !== 'string') return undefined

  if (state.kind === 'tool') {
    if (config.provider !== state.toolProvider) return undefined
    const before = typeof config.export === 'string'
      ? config.export
      : effectiveExportId(exports.tool, '')
    const after = effectiveExportId(exports.tool, state.toolExport)
    return before === after ? config.authRef : undefined
  }
  if (state.kind === 'context' && state.provider !== 'r2' && state.provider !== 's3') {
    if (config.provider !== state.provider) return undefined
    const before = typeof config.export === 'string'
      ? config.export
      : effectiveExportId(exports.context, '')
    const after = effectiveExportId(exports.context, state.ctxExport)
    return before === after ? config.authRef : undefined
  }
  return undefined
}

export interface RegistryMountCalls {
  mount: ReturnType<typeof buildRegistryWriteArgs>
  /** 仅内置 plugin 且用户填写了新凭证时出现。 */
  secret?: { name: string, value: string }
}

/**
 * 高级挂载器的编排计划。内置 plugin 的用户态凭证在这里编译成内部 authRef；external
 * plugin 继续使用兼容的手填引用。最终 registry payload 仍走 buildRegistryWriteArgs 一处。
 */
export function buildRegistryMountCalls(
  state: RegistryMountFormState,
  exports: { context: PluginExport[], tool: PluginExport[] },
  options: {
    contextBuiltin: boolean
    existing?: RegistryNode
    toolBuiltin: boolean
  },
): RegistryMountCalls {
  let resolved = state
  let secret: RegistryMountCalls['secret']
  const fallbackAuthRef = existingManagedAuthRef(options.existing, state, exports)

  if (state.kind === 'tool' && options.toolBuiltin) {
    const binding = buildCredentialBinding(
      state.toolCredential,
      credentialInputPlanFor(exports.tool, state.toolExport),
      state.path,
      fallbackAuthRef,
    )
    resolved = { ...state, toolAuthRef: binding.authRef ?? '' }
    secret = binding.secret
  } else if (
    state.kind === 'context'
    && state.provider !== 'r2'
    && state.provider !== 's3'
    && options.contextBuiltin
  ) {
    const binding = buildCredentialBinding(
      state.ctxCredential,
      credentialInputPlanFor(exports.context, state.ctxExport),
      state.path,
      fallbackAuthRef,
    )
    resolved = { ...state, ctxAuthRef: binding.authRef ?? '' }
    secret = binding.secret
  }

  return {
    mount: buildRegistryWriteArgs(resolved, exports),
    ...(secret !== undefined ? { secret } : {}),
  }
}

/**
 * 这个节点要不要显示"授权"入口(对等 `tb tool auth`)。
 *
 * 两类节点走网关托管的 OAuth,而它们是**两套机制**、共用 `~authorize`:
 * - `auth:'oauth'` 的 mcp 挂载 —— 判据就在挂载配置里,能精确判;
 * - export 声明了 `oauth` 的 plugin tool 挂载(provider 型)—— **判据不在这里**:
 *   oauth 声明在 plugin 的 `~describe` 里,而列表页只有节点记录。
 *
 * 故对所有 `kind:'tool'` 都给入口。代价是非 oauth 的 tool 节点点了会收到
 * invalid_argument(平台侧 `authorizeToolNode` 查 export 后拒),但反过来 ——
 * 收窄成"只有 mcp"会让 oauth 型 tool 挂载**完全没有入口**,那是管理旁路(缺陷),
 * 比多一个会报错的按钮严重得多。平台侧 `routes/register.ts` 的分派用的是同一判据。
 */
export function showsAuthorizeAction(node: {
  config?: Record<string, unknown>
  kind: string
}): boolean {
  if (node.kind === 'tool') return true
  return node.kind === 'mcp' && node.config?.auth === 'oauth'
}
