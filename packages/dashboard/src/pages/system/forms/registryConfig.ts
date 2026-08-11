import type { PluginExport, PluginManifest, PluginProfile } from '@/lib/types'

export type MountKind = 'mcp' | 'http' | 'context' | 'skillhub' | 'remote' | 'tool'
export type AuthSchemeMode = 'bearer' | 'raw' | 'custom'

export interface RegistryMountFormState {
  authHeader: string
  authScheme: string
  baseUrl: string
  ctxAuthRef: string
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
  mcpSchemeMode: AuthSchemeMode
  mcpUrl: string
  path: string
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
  mcpSchemeMode: 'bearer',
  mcpUrl: '',
  path: '',
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
      const headers = parsePairs(state.mcpHeadersSpec, 'headers')
      return {
        kind: 'mcp',
        url: state.mcpUrl.trim(),
        ...(state.mcpAuthMode === 'authRef' ? { authRef: state.mcpAuthRef.trim() } : {}),
        ...(state.mcpAuthMode === 'oauth' ? { auth: 'oauth' } : {}),
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
      return {
        kind: 'context',
        provider: state.provider,
        ...(exportId ? { export: exportId } : {}),
        ...(state.ctxAuthRef.trim() ? { authRef: state.ctxAuthRef.trim() } : {}),
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
      return {
        kind: 'tool',
        provider: state.toolProvider,
        ...(exportId ? { export: exportId } : {}),
        ...(state.toolAuthRef.trim() ? { authRef: state.toolAuthRef.trim() } : {}),
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
