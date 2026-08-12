/**
 * 上游 HTTP 状态 → `TBError` 七码。所有迁移产物共用一份。
 *
 * 迁移前每个 provider 自带一个 `mapXxxError`,映射口径各不相同(有的把 404 压成 400、
 * 有的把一切 <500 归成 invalid_input)。收成一处后,消费者看到的错误语义在 1300 个
 * provider 之间是一致的;个别上游有稳定的自有错误码,再在该 provider 里覆盖。
 */

import { TBError } from '@tool-bridge/plugin-sdk'

/**
 * @param status 上游返回的 HTTP 状态
 * @param message 给调用方看的消息(不要塞上游原始 body 里的敏感内容)
 */
export function upstreamError(status: number, message: string): TBError {
  if (status === 401) {
    // 契约允许的状态特例:保留"未认证"与"已认证但无权"之别。
    return new TBError('permission_denied', message, { httpStatus: 401 })
  }
  if (status === 403) return new TBError('permission_denied', message)
  if (status === 404) return new TBError('not_found', message)
  if (status === 409) return new TBError('conflict', message)
  if (status === 429) return new TBError('rate_limited', message, { retryable: true })
  if (status >= 500) return new TBError('unavailable', message, { retryable: true })
  return new TBError('invalid_argument', message)
}
