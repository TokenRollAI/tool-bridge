/**
 * `IntegrationDialog` 的纯逻辑:从 catalog 项推出"该填什么",并把表单态编译成
 * 要发的两三个调用。
 *
 * 抽成无 React/DOM 依赖的纯函数是本仓的既有姿势(见 registryConfig.ts):wire payload
 * 能被 Node vitest 直接断言,不必起 DOM。
 */

import type {
  CatalogExportDetails,
  CatalogListItem,
  PluginCredentialField,
  PluginMountConfigField,
} from '@/lib/types'

/** 凭证的四种给法。与 CLI `tb integration add` 的互斥组一一对应。 */
export type CredentialMode = 'inline' | 'existing' | 'oauth' | 'none'

export interface IntegrationFormState {
  /** 非凭证挂载配置(providerConfig)。 */
  config: Record<string, string>
  /** 用户填的凭证字段值(key → value);单值凭证用 SINGLE_FIELD_KEY。 */
  credentials: Record<string, string>
  description: string
  /** 复用已有 secret 时的名字。 */
  existingSecret: string
  exportId: string
  mode: CredentialMode
  path: string
  provider: string
}

export const SINGLE_FIELD_KEY = '__single__'

export const INITIAL_INTEGRATION_FORM: IntegrationFormState = {
  provider: '',
  path: '',
  exportId: '',
  description: '',
  mode: 'inline',
  credentials: {},
  existingSecret: '',
  config: {},
}

/**
 * 这个集成要怎么配凭证。
 *
 * 三种形态互斥(plugin-sdk 侧保证):oauth / 多字段 / 单值。**`secret: false` 不再分流** ——
 * 声明了 credentialFields 的 export,全部字段都进 authRef 指向的那个 secret,`secret`
 * 只决定输入框要不要遮蔽。
 */
export function integrationPlan(entry: CatalogListItem | undefined, exportId = ''): {
  authRequired: boolean
  fields: PluginCredentialField[]
  kind: 'none' | 'oauth' | 'fields' | 'single'
  /** 该 export 声明的非凭证配置字段(如 baseUrl);向导据此渲染带标签的输入而非自由 k=v。 */
  mountConfigFields: PluginMountConfigField[]
  needsExportChoice: boolean
} {
  if (entry === undefined) {
    return {
      authRequired: false,
      kind: 'single',
      fields: [],
      mountConfigFields: [],
      needsExportChoice: false,
    }
  }
  const needsExportChoice = entry.exports.length > 1
  const chosen = exportId.trim() || (entry.exports.length === 1 ? entry.exports[0]! : '')
  const details: CatalogExportDetails | undefined = chosen === ''
    ? undefined
    : entry.exportDetails?.[chosen]
  const mountConfigFields = details?.mountConfigFields ?? entry.mountConfigFields ?? []
  const auth = details?.auth
  if (auth?.kind === 'none') {
    return { authRequired: false, kind: 'none', fields: [], mountConfigFields, needsExportChoice }
  }
  if (auth?.kind === 'oauth' || (auth === undefined && entry.needsOAuth)) {
    return { authRequired: true, kind: 'oauth', fields: [], mountConfigFields, needsExportChoice }
  }
  const fields = auth?.kind === 'fields' ? auth.fields : entry.credentialFields ?? []
  if (fields.length > 0) {
    return { authRequired: true, kind: 'fields', fields, mountConfigFields, needsExportChoice }
  }
  return {
    authRequired: auth?.kind === 'single' ? auth.required : false,
    kind: 'single',
    fields: [],
    mountConfigFields,
    needsExportChoice,
  }
}

/** secret 名由挂载路径派生 —— authRef 不再是两处都要打对的自由文本。 */
export function derivedSecretName(path: string): string {
  return `integration-${path.trim().replace(/\//g, '-')}`
}

/**
 * 选中 provider 时给挂载路径一个默认值,省得用户从零想。前缀按节点 kind 分:tool → `tools/`、
 * context → `notes/`(与既有内置节点的习惯一致);拿不到 kind(external / 无 read)退回 `tools/`。
 * 这只是**默认值**,用户可改 —— 故仅在 path 尚空时用它,不覆盖已输入的路径。
 */
export function defaultMountPath(entry: CatalogListItem | undefined): string {
  if (entry === undefined) return ''
  const kind = entry.nodeKinds.length === 1 ? entry.nodeKinds[0]! : 'tool'
  return `${kind === 'context' ? 'notes' : 'tools'}/${entry.id}`
}

/** 多字段凭证的 secret 明文:键序固定(与 core encodeCredentialValues 同规则)。 */
export function encodeFields(values: Record<string, string>): string {
  const sorted: Record<string, string> = {}
  for (const key of Object.keys(values).sort()) sorted[key] = values[key]!
  return JSON.stringify(sorted)
}

export interface IntegrationCalls {
  /** 挂载节点(`system/registry write`)。 */
  mount: {
    config: Record<string, unknown>
    description: string
    kind: 'context' | 'tool'
    path: string
  }
  /** 挂载后是否要引导 OAuth 授权。 */
  needsAuthorize: boolean
  /** 先写 secret(`system/secret set`);复用已有或无需凭证时为 undefined。 */
  secret?: { name: string, value: string }
}

/**
 * 表单态 → 要发的调用。校验在这里做(而不是等平台拒),因为这里能说清是哪个字段。
 *
 * @throws Error 校验失败;消息面向用户,直接进错误条。
 */
export function buildIntegrationCalls(
  state: IntegrationFormState,
  entry: CatalogListItem | undefined,
): IntegrationCalls {
  const path = state.path.trim()
  if (path === '') throw new Error('path 必填')
  const provider = state.provider.trim()
  if (provider === '') throw new Error('先选一个集成')

  const exportId = state.exportId.trim()
  const plan = integrationPlan(entry, exportId)
  if (plan.needsExportChoice && exportId === '') {
    throw new Error(`${provider} 有多个 export(${entry!.exports.join('、')}),挂载须选一个`)
  }
  if (exportId !== '' && entry !== undefined && !entry.exports.includes(exportId)) {
    throw new Error(`${provider} 没有 export "${exportId}"`)
  }
  if (plan.kind === 'none' && (state.mode === 'existing' || state.existingSecret.trim() !== '')) {
    throw new Error(`${provider} 的 export ${exportId || entry?.exports[0] || ''} 不需要凭证`)
  }
  if (plan.authRequired && state.mode === 'none') {
    throw new Error(`${provider} 的 export ${exportId || entry?.exports[0] || ''} 需要凭证`)
  }

  // kind 由**选中 export** 决定:跨 kind 的多 export provider(notes:actions=tool /
  // notes=context)挂 context export 时不能落到默认 'tool'(平台会拒且用户无参数可救)。
  // 退化:选中 export 的 kind → 单一 nodeKind → 'tool'(external plugin 不在 catalog 时的兜底)。
  const nodeKind: 'context' | 'tool'
    = (exportId !== '' ? entry?.exportDetails?.[exportId]?.kind : undefined)
      ?? (exportId !== '' ? entry?.exportKinds?.[exportId] : undefined)
      ?? (entry?.nodeKinds.length === 1 ? entry.nodeKinds[0]! : 'tool')

  let authRef: string | undefined
  let secret: { name: string, value: string } | undefined

  if (state.mode === 'existing') {
    const name = state.existingSecret.trim()
    if (name === '') throw new Error('选一个已有凭证,或改用"新建凭证"')
    authRef = name
  } else if (state.mode === 'inline' && plan.kind !== 'none') {
    if (plan.kind === 'fields') {
      const values: Record<string, string> = {}
      const missing: string[] = []
      for (const field of plan.fields) {
        const value = (state.credentials[field.key] ?? '').trim()
        // 缺省视为必填(与运行时 parseCredentialValues 同口径)。
        if (value === '') {
          if (field.required !== false) missing.push(field.key)
          continue
        }
        values[field.key] = value
      }
      if (missing.length > 0) throw new Error(`缺必填凭证字段:${missing.join('、')}`)
      authRef = derivedSecretName(path)
      secret = { name: authRef, value: encodeFields(values) }
    } else if (plan.kind === 'oauth') {
      // OAuth 的 secret 存 clientId/clientSecret 两个固定字段。
      const clientId = (state.credentials.clientId ?? '').trim()
      const clientSecret = (state.credentials.clientSecret ?? '').trim()
      if (clientId === '' || clientSecret === '') {
        throw new Error('OAuth 集成需要 clientId 与 clientSecret(到 provider 后台注册应用后获得)')
      }
      authRef = derivedSecretName(path)
      secret = { name: authRef, value: encodeFields({ clientId, clientSecret }) }
    } else {
      const value = (state.credentials[SINGLE_FIELD_KEY] ?? '').trim()
      if (value === '' && plan.authRequired) throw new Error('API key 必填')
      if (value !== '') {
        authRef = derivedSecretName(path)
        secret = { name: authRef, value }
      }
      // 单值且留空 = 这个 provider 不需要凭证(少数如 v2ex);不强制。
    }
  }

  const config: Record<string, unknown> = {
    kind: nodeKind,
    provider,
    ...(exportId !== '' ? { export: exportId } : {}),
    ...(authRef !== undefined ? { authRef } : {}),
  }
  const providerConfig: Record<string, string> = {}
  for (const [key, value] of Object.entries(state.config)) {
    const trimmed = value.trim()
    if (key.trim() !== '' && trimmed !== '') providerConfig[key.trim()] = trimmed
  }
  // 必配的非凭证配置(如 memos 的 baseUrl)缺了就在这里拦 —— 与凭证字段同口径,
  // 说清缺哪个,而不是等 credentialProbe 报个像凭证问题的错、或首次调用才 invalid_argument。
  const missingConfig = plan.mountConfigFields
    .filter(f => f.required === true && (providerConfig[f.key] ?? '') === '')
    .map(f => f.key)
  if (missingConfig.length > 0) {
    throw new Error(`缺必填配置:${missingConfig.join('、')}`)
  }
  if (Object.keys(providerConfig).length > 0) config.providerConfig = providerConfig

  return {
    ...(secret !== undefined ? { secret } : {}),
    mount: {
      path,
      kind: nodeKind,
      description: state.description.trim() === ''
        ? `${provider} integration at ${path}`
        : state.description.trim(),
      config,
    },
    needsAuthorize: plan.kind === 'oauth',
  }
}
