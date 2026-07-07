/**
 * 上游错误归一 + https 强制(上游 https 强制,定型)。
 *
 * mcp/http Provider 的**单一 choke point**:把上游传输/协议错误归一为 TBError。
 * MCP RPC 业务错误(`result.isError`)不走这里——那是正常 HTTP 200 的 ToolResult(见 types.ts)。
 */

import { TBError } from '../errors'

/** choke point 的输入:gateway 侧把 fetch/SDK 错误归一到这个中立形状。 */
export interface UpstreamError {
  /** network:网络失败/超时/会话重建仍失败;http:拿到响应但状态码非 2xx。 */
  kind: 'network' | 'http'
  /** kind==='http' 时的状态码。 */
  status?: number
  /** 诊断用简述(不含上游 body 原文)。 */
  message?: string
}

/**
 * 归一映射(规范性,定型):
 * - network / 5xx / 超时 / 会话重建仍失败 → `unavailable`(retryable:true);
 * - 4xx(我方拼装错误或上游拒绝)→ `internal`(retryable:false);message 携带状态码摘要,
 *   **不透传上游 body 原文**(防泄漏)。
 * - 其余(非 4xx/5xx 的异常状态,如 3xx/1xx)保守归 `unavailable`(retryable:true)。
 */
export function normalizeUpstreamError(e: UpstreamError): TBError {
  if (e.kind === 'network') {
    return new TBError('unavailable', `上游不可用:${e.message ?? '网络错误'}`, {
      retryable: true,
    })
  }
  const status = e.status
  if (status !== undefined && status >= 400 && status < 500) {
    return new TBError('internal', `上游返回 ${status}`, { retryable: false })
  }
  // 5xx 及其它异常状态:暂时不可用
  return new TBError('unavailable', `上游返回 ${status ?? '未知状态'}`, { retryable: true })
}

/**
 * 上游 endpoint https 强制(定型):非 https 且未放行 → invalid_argument。
 * `allowInsecure`(env `TB_ALLOW_INSECURE_HTTP=true`)时放行 http://(仅本地开发)。
 * URL 无可识别 scheme → invalid_argument。通过返回 null。
 *
 * core 无运行时全局(不用 `URL`);用纯字符串取 scheme。
 */
export function assertSecureUrl(url: string, allowInsecure: boolean): TBError | null {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(url)
  if (m === null) {
    return new TBError('invalid_argument', `非法 URL:'${url}'`)
  }
  const scheme = (m[1] ?? '').toLowerCase()
  if (scheme === 'https') return null
  if (scheme === 'http' && allowInsecure) return null
  return new TBError(
    'invalid_argument',
    `上游 endpoint 必须为 https://(得到 '${scheme}://');设 TB_ALLOW_INSECURE_HTTP=true 放行本地 http`,
  )
}
