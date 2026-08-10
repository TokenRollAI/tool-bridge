/**
 * 规范网关 origin(TB_CANONICAL_ORIGIN)的解析。
 *
 * 用途:把 OAuth 的 redirect_uri 钉在部署的规范 origin 上,而不是每请求动态取 origin
 * ——实例经多域名(自定义域 + *.workers.dev + Preview URL 等)访问时,动态 origin 会让
 * 授权 code 在不同域名间被互换。
 *
 * **fail closed**:配置了但非法(不是合法绝对 URL / 非 http(s))→ 抛 invalid_argument,
 * 而不是静默回退到请求期 origin。静默回退的危险在于运维以为已经钉住,实际没有——
 * 一个拼错的值会安静地退回到最不安全的行为(2026-07-24 安全复核合入阻断项)。
 * 未配置(undefined / 空串 / 纯空白)→ undefined,表示"本部署不钉",属显式选择。
 *
 * 纯逻辑,无宿主依赖:Workers(app.ts)、Node(server config)与 SDK 共用此单一真源,
 * 保证三处配置面语义不漂移。
 */

import { TBError } from './errors'

// `URL` 在 Workers 与 Node 20+ 均为全局,但 core 的 tsconfig 刻意不引 DOM/node lib
// (纯逻辑内核,无宿主依赖)。此处以模块作用域最小声明补齐类型,与 secret/secretStore.ts
// 对 WebCrypto 的处理同则:不改 tsconfig、不污染全局。
interface MinimalUrl {
  readonly origin: string
  readonly protocol: string
}

declare const URL: { new (input: string): MinimalUrl }

/**
 * 解析规范 origin:取 URL 的 origin 部分(丢弃 path/query/hash)。
 * 未配置 → undefined;配置了但非法 → 抛 invalid_argument(fail closed)。
 */
export function normalizeCanonicalOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const raw = value.trim()
  if (raw.length === 0) return undefined
  let url: MinimalUrl
  try {
    url = new URL(raw)
  } catch {
    throw new TBError(
      'invalid_argument',
      `TB_CANONICAL_ORIGIN is set but is not a valid absolute URL: ${JSON.stringify(raw)}`,
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TBError(
      'invalid_argument',
      `TB_CANONICAL_ORIGIN must use http or https, got ${JSON.stringify(url.protocol)}`,
    )
  }
  return url.origin
}
