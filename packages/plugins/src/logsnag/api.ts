/**
 * LogSnag 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/logsnag/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * LogSnag 的 API 面很窄:四个 action 打三个端点,入参**整体**就是请求体(project 也在
 * body 里,不进 URL),故没有路径参数拼接与分页。`insight` 端点用 POST/PATCH 区分
 * "设置最新值"与"增量变更",是唯一需要 handler 之间分辨的地方。
 */

import type { z } from 'zod/v4'
import type { identifyUserInput, mutateInsightInput, publishEventInput, publishInsightInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'logsnag'
const API_BASE = 'https://api.logsnag.com/v1'

/** LogSnag 只回 ack,不回业务对象;`payload` 缺席表示上游回了空体。 */
interface LogsnagResult {
  ok: true
  payload?: unknown
  status: number
}

/**
 * 响应体尽力解析。LogSnag 在 4xx 上有时回 JSON、有时回纯文本,故非 json 的
 * content-type 与解析失败都退回原始文本而不是丢弃——错误消息常常只在这里。
 */
async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '')
  if (text === '') return undefined
  if (response.headers.get('content-type')?.includes('json') !== true) return text
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/** 非空字符串(trim 后)才算数,与上游 `optionalString` 同语义。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.trim() || undefined
}

/** LogSnag 的错误体没有稳定形状,message/error/detail 三选一;都没有就退回状态码。 */
function errorMessage(payload: unknown, status: number): string {
  const direct = text(payload)
  if (direct !== undefined) return direct
  if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>
    for (const key of ['message', 'error', 'detail']) {
      const value = text(record[key])
      if (value !== undefined) return value
    }
  }
  return `LogSnag request failed with ${status}`
}

async function request(
  path: string,
  method: 'PATCH' | 'POST',
  body: Record<string, unknown>,
  ctx: ProviderContext,
): Promise<LogsnagResult> {
  const response = await guardedFetch(`${API_BASE}/${path}`, {
    method,
    headers: {
      'accept': 'application/json',
      'authorization': `Bearer ${requireApiKey(ctx, SERVICE)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const payload = await readPayload(response)
  if (!response.ok) {
    // 上游此处把 403 折成 401、把 5xx 折成 502;迁移后交给共用的 upstreamError 归一,
    // 于是 403 保持 permission_denied(403)、5xx 归 unavailable(retryable)。
    // 这是**有意**的口径统一——跨 provider 的错误语义一致比复刻单个 provider 的折叠更值钱。
    throw upstreamError(response.status, errorMessage(payload, response.status))
  }

  // payload 为 undefined 时不带这个键(上游 compactObject 的语义,outputSchema 也声明它可选)。
  return { ok: true, status: response.status, ...(payload === undefined ? {} : { payload }) }
}

export async function publishEvent(
  input: z.infer<typeof publishEventInput>,
  ctx: ProviderContext,
): Promise<LogsnagResult> {
  return request('log', 'POST', input, ctx)
}

export async function identifyUser(
  input: z.infer<typeof identifyUserInput>,
  ctx: ProviderContext,
): Promise<LogsnagResult> {
  return request('identify', 'POST', input, ctx)
}

export async function publishInsight(
  input: z.infer<typeof publishInsightInput>,
  ctx: ProviderContext,
): Promise<LogsnagResult> {
  return request('insight', 'POST', input, ctx)
}

export async function mutateInsight(
  input: z.infer<typeof mutateInsightInput>,
  ctx: ProviderContext,
): Promise<LogsnagResult> {
  return request('insight', 'PATCH', input, ctx)
}
