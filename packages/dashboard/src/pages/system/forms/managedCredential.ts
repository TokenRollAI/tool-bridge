import type { PluginCredentialField } from '@/lib/types'

/** 内置集成的用户态凭证方式；authRef 是编译结果，不进入这层心智。 */
export type CredentialMode = 'inline' | 'existing' | 'none'

export interface CredentialInputPlan {
  authRequired: boolean
  fields: PluginCredentialField[]
  kind: 'none' | 'oauth' | 'fields' | 'single'
}

export interface ManagedCredentialFormState {
  credentials: Record<string, string>
  existingSecret: string
  mode: CredentialMode
}

export interface CredentialBinding {
  /** 只供 registry wire payload 使用，不展示给内置集成用户。 */
  authRef?: string
  /** 新凭证先写 SecretStore，再写 registry。 */
  secret?: { name: string, value: string }
}

export const SINGLE_FIELD_KEY = '__single__'

export function initialManagedCredential(plan?: Pick<CredentialInputPlan, 'kind'>): ManagedCredentialFormState {
  return {
    credentials: {},
    existingSecret: '',
    mode: plan?.kind === 'none' ? 'none' : 'inline',
  }
}

/**
 * 一个挂载路径拥有一个稳定的内部凭证槽。名字只进入 wire，不应出现在内置集成表单里。
 * encodeURIComponent 对完整 path 是一一映射，避免 legacy slash→dash 规则让 `a/b` 与
 * `a-b` 误用同一凭证；v2 前缀同时与既有槽隔离。已有挂载编辑仍由 fallbackAuthRef 保留旧槽。
 */
export function derivedSecretName(path: string): string {
  return `integration-v2-${encodeURIComponent(path.trim())}`
}

/** 多字段凭证的 secret 明文：键序固定，与 core encodeCredentialValues 同规则。 */
export function encodeFields(values: Record<string, string>): string {
  const sorted: Record<string, string> = {}
  for (const key of Object.keys(values).sort()) sorted[key] = values[key]!
  return JSON.stringify(sorted)
}

function hasAnyCredentialValue(values: Record<string, string>): boolean {
  return Object.values(values).some(value => value.trim() !== '')
}

/**
 * 把用户看到的“填写/保留/复用凭证”编译成 SecretStore + registry 的内部引用。
 *
 * `fallbackAuthRef` 只用于同 provider/export 的原路径替换：所有输入留空时沿用已绑定凭证，
 * 避免用户为了改描述或虚拟化被迫重新输入不可回读的密钥。
 */
export function buildCredentialBinding(
  state: ManagedCredentialFormState,
  plan: CredentialInputPlan,
  path: string,
  fallbackAuthRef?: string,
): CredentialBinding {
  if (plan.kind === 'none') return {}

  if (state.mode === 'existing') {
    const name = state.existingSecret.trim()
    if (name === '') throw new Error('请选择一项已保存凭证，或直接填写新凭证')
    return { authRef: name }
  }

  if (state.mode === 'none') {
    if (plan.authRequired) throw new Error('该集成需要凭证')
    return {}
  }

  // 编辑同一个内置挂载时，完全留空表示“保留”，而不是把空字符串覆盖进 SecretStore。
  if (!hasAnyCredentialValue(state.credentials) && fallbackAuthRef !== undefined) {
    return { authRef: fallbackAuthRef }
  }

  const name = derivedSecretName(path)
  if (plan.kind === 'fields') {
    const values: Record<string, string> = {}
    const missing: string[] = []
    for (const field of plan.fields) {
      const value = (state.credentials[field.key] ?? '').trim()
      if (value === '') {
        if (field.required !== false) missing.push(field.key)
        continue
      }
      values[field.key] = value
    }
    if (missing.length > 0) throw new Error(`缺必填凭证字段:${missing.join('、')}`)
    return { authRef: name, secret: { name, value: encodeFields(values) } }
  }

  if (plan.kind === 'oauth') {
    const clientId = (state.credentials.clientId ?? '').trim()
    const clientSecret = (state.credentials.clientSecret ?? '').trim()
    if (clientId === '' || clientSecret === '') {
      throw new Error('OAuth 集成需要 clientId 与 clientSecret（到服务商后台注册应用后获得）')
    }
    return {
      authRef: name,
      secret: { name, value: encodeFields({ clientId, clientSecret }) },
    }
  }

  const value = (state.credentials[SINGLE_FIELD_KEY] ?? '').trim()
  if (value === '') {
    if (plan.authRequired) throw new Error('API key 必填')
    return {}
  }
  return { authRef: name, secret: { name, value } }
}
