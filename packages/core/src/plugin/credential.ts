/**
 * 多字段凭证的编解码。平台侧(校验挂载配置)与插件侧(取字段)共用这一份规则,
 * 免得两边对"什么算合法凭证"的判断漂移。
 *
 * 传输形态不变:仍是 `X-TB-Upstream-Auth` 里那个字符串。单字段凭证原样是明文(绝大多数
 * provider 只要一个 API key);声明了 `credentialFields` 的则是一个 JSON 对象的序列化。
 * 这样已有 plugin 完全不受影响 —— 它们既没声明字段,平台也就照旧传明文。
 */

import type { PluginCredentialField } from './contract'
import { TBError } from '../errors'

/** 解析出的多字段凭证。 */
export type PluginCredentialValues = Record<string, string>

/**
 * 把 secret 明文解析成字段表,并按声明校验。
 *
 * @param raw SecretStore 解出的明文(单值凭证就是它本身;多字段是 JSON 对象)
 * @param fields export 声明的字段;未声明 → 不解析,调用方按单值用
 * @throws invalid_argument 形状不对、或必填字段缺失。消息只点名字段名,**不回显值**。
 */
export function parseCredentialValues(
  raw: string,
  fields: readonly PluginCredentialField[],
): PluginCredentialValues {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new TBError(
      'invalid_argument',
      `该 plugin 需要多字段凭证(${fields.map(f => f.key).join('、')}),`
      + '但 secret 存的不是 JSON 对象。用 `tb secret set <name> --field k=v` 写入',
    )
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TBError('invalid_argument', '多字段凭证的 secret 必须是一个 JSON 对象')
  }

  const source = parsed as Record<string, unknown>
  const values: PluginCredentialValues = {}
  const missing: string[] = []
  for (const field of fields) {
    const value = source[field.key]
    if (typeof value === 'string' && value !== '') {
      values[field.key] = value
      continue
    }
    // 缺省视为必填:漏标 required 的字段不该被静默放行(与 secret 缺省按敏感处理同理)。
    if (field.required !== false) missing.push(field.key)
  }
  if (missing.length > 0) {
    throw new TBError('invalid_argument', `多字段凭证缺少必填字段:${missing.join('、')}`)
  }
  return values
}

/**
 * 字段表 → 可放进 `X-TB-Upstream-Auth` 的明文(供 CLI/管理面写入 secret 时用)。
 * 键序固定,同一份凭证每次编码结果一致。
 */
export function encodeCredentialValues(values: PluginCredentialValues): string {
  const sorted: PluginCredentialValues = {}
  for (const key of Object.keys(values).sort()) sorted[key] = values[key]!
  return JSON.stringify(sorted)
}
