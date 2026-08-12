/**
 * IP2Proxy 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/ip2proxy/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * IP2Proxy 的形状特点:
 * - **凭证是 query 参数 `key`**,不走 header。
 * - **失败常以 HTTP 200 返回**,真正的成败写在 body 的 `response` 字段里
 *   (`"OK"` 才是成功)。故状态码不足以判定,必须先读 `response` 文案。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { lookupIpInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'ip2proxy'
const API_BASE = 'https://api.ip2proxy.com'
/** 上游 action 定义里 package 的默认值;schema 声明了它但 `.default().optional()` 不会兜底。 */
const DEFAULT_PACKAGE = 'PX1'

type Json = Record<string, unknown>

/** 尽力解析响应体:IP2Proxy 在边缘错误上会回空体或纯文本。 */
async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text()
  if (body === '') return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    return body
  }
}

/** body 里 `response` 非 "OK" 即为失败;返回那句文案,成功则返回 undefined。 */
function payloadError(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const message = (payload as Json).response
  if (typeof message !== 'string' || message === '' || message === 'OK') return undefined
  return message
}

export async function lookupIp(
  input: z.infer<typeof lookupIpInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // schema 把 ip 标成可选,但没有 ip 的查询上游一律拒;本地挡住,省一次往返。
  if (input.ip === undefined || input.ip === '') {
    throw new TBError('invalid_argument', 'ip 不能为空')
  }

  const url = new URL('/', API_BASE)
  url.searchParams.set('key', requireApiKey(ctx, SERVICE))
  url.searchParams.set('format', 'json')
  url.searchParams.set('ip', input.ip)
  url.searchParams.set('package', input.package ?? DEFAULT_PACKAGE)

  let response: Response
  let payload: unknown
  try {
    response = await guardedFetch(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
    payload = await readPayload(response)
  } catch (error) {
    // 上游主机是写死的常量,这里只可能是网络/传输问题 —— 重试有意义。
    throw new TBError(
      'unavailable',
      error instanceof Error ? `IP2Proxy 请求失败: ${error.message}` : 'IP2Proxy 请求失败',
      { retryable: true },
    )
  }

  const failure = payloadError(payload)
  if (failure !== undefined) {
    // 上游只把"提到 API key 或额度"的文案当成凭证问题,其余一概算上游故障。
    const lower = failure.toLowerCase()
    const credentialIssue = lower.includes('api key') || lower.includes('credit')
    throw upstreamError(credentialIssue ? 401 : 502, failure)
  }

  if (!response.ok) {
    throw upstreamError(response.status || 500, response.statusText || 'IP2Proxy request failed')
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TBError('unavailable', 'IP2Proxy 返回的不是 JSON 对象', { retryable: true })
  }
  return payload as Json
}
