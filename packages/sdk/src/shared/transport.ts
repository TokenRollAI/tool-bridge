/**
 * 三个 Web-standard 子入口(client/store/device)共用的 HTTP 归一层。
 *
 * 此前 status→(code,retryable) fallback、TBError body 解析、凭证 header 校验、
 * timeout 校验在三个子入口各养一份且语义互不一致(同一个网关 404 在三条路径归一出
 * 不同 code/retryable)。收敛为单一实现;错误 message 仍由调用点决定(各链路的
 * 上下文措辞与脱敏策略不同,不在此统一)。
 */

import { TBError, type TBErrorBody } from '@tool-bridge/core/device'
import { tbErrorBodySchema } from '@tool-bridge/core/protocol'

/**
 * 无(或非法)TBError body 时按 HTTP status 归一 code/retryable 的唯一映射。
 * 规范 TBError body 存在时以 body 为准,不走此表。
 */
export function statusFallback(status: number): { code: TBErrorBody['code'], retryable: boolean } {
  if (status === 400 || status === 422) return { code: 'invalid_argument', retryable: false }
  if (status === 401 || status === 403) return { code: 'permission_denied', retryable: false }
  if (status === 404) return { code: 'not_found', retryable: false }
  if (status === 409) return { code: 'conflict', retryable: false }
  if (status === 429) return { code: 'rate_limited', retryable: true }
  if (status >= 500) return { code: 'unavailable', retryable: true }
  return { code: 'internal', retryable: false }
}

/** 规范 TBError body 解析;非法形状 → undefined(调用方走 statusFallback)。 */
export function parseTbErrorBody(value: unknown): TBErrorBody | undefined {
  const known = tbErrorBodySchema.safeParse(value)
  return known.success ? known.data : undefined
}

/**
 * Node timer 超过带符号 32 位上限会被静默钳到 1ms;Web-standard 层跨 Node/浏览器
 * 保持确定性,统一在此校验。
 */
export function validTimeout(value: number | undefined): value is number {
  return value !== undefined
    && Number.isInteger(value)
    && value > 0
    && value <= 2_147_483_647
}

/**
 * 凭证 provider 给出的 HTTP header 集合校验:必须含非空 Authorization,且不得设置
 * 保留 header(cookie/proxy-authorization/x-tb-*——后者是网关控制面信道,凭证不可伪造)。
 * `label` 决定错误消息前缀,保持各链路既有措辞。
 */
export function credentialHeadersFrom(
  headers: Readonly<Record<string, string>> | undefined,
  label: string,
): Headers {
  let parsed: Headers
  try {
    parsed = new Headers(headers)
  } catch {
    throw new TBError('invalid_argument', `${label} headers are invalid`)
  }
  const authorization = parsed.get('authorization')
  if (authorization === null || authorization.trim() === '') {
    throw new TBError(
      'invalid_argument',
      `${label} must include a non-empty Authorization header`,
    )
  }
  for (const name of parsed.keys()) {
    if (
      name === 'cookie'
      || name === 'cookie2'
      || name === 'proxy-authorization'
      || name.startsWith('x-tb-')
    ) {
      throw new TBError(
        'invalid_argument',
        `${label} cannot set reserved header '${name}'`,
      )
    }
  }
  return parsed
}
