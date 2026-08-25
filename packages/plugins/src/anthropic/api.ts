/**
 * Anthropic 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/anthropic/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 凭证走 **header**(`x-api-key`),不进 URL。
 *
 * 三处上游细节决定了这里的形状:
 * - 每个请求都必须带 `anthropic-version` 头,漏了会被上游以 400 拒;它是 API 契约的一部分,
 *   不是可选优化项,故钉死在 `headers()` 里。
 * - `create_message` 的请求体是**整个入参原样透传**(上游 `compactObject(input)`),
 *   schema 侧也是 `looseObject` —— 新出的 Anthropic 字段无须改代码即可用。
 * - `get_model` 的 `model_id` 在上游 schema 里没声明 required,executor 里却有 `requiredString`
 *   断言;schema.ts 忠实反映上游(`.optional()`),必填断言保留在这层。
 *
 * 与上游的有意偏离:
 * - 上游 `assertAnthropicResponse` 逐状态手写映射(429/401/403/400/422,其余压成 `status || 500`)。
 *   这里把原始状态交给 `upstreamError`,404 因此是 `not_found` 而非笼统的失败 —— 收敛各
 *   provider 互不相同的错误口径正是 `_runtime/upstreamError.ts` 存在的理由。
 * - 上游的 `mode: 'validate'` 分支只服务 `credentialValidators`(把 401/403 说成 400)。
 *   平台侧的 credentialProbe 自己做这层分账,故不迁。
 * - 不发 `user-agent`:上游那个值标识的是 open-connector 进程,在这里已无意义。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  countMessageTokensInput,
  createMessageInput,
  getModelInput,
  listModelsInput,
} from './schema'
import { compactDefined as compact, asJsonObject as record, trimmedText as text } from '../_runtime/jsonValue'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { createProviderHttpClient } from '../_runtime/providerHttp'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'anthropic'
const API_BASE = 'https://api.anthropic.com'
/** 上游 API 的版本契约:每个请求都要带,值变了就是换了一套响应形状。 */
const API_VERSION = '2023-06-01'
const http = createProviderHttpClient({ baseUrl: `${API_BASE}/`, service: SERVICE })

type Json = Record<string, unknown>

/** 上游 `requiredString`:schema 没标 required 的字段,必填断言落在这里。 */
function requireText(value: unknown, field: string): string {
  const result = text(value)
  if (result === undefined) throw new TBError('invalid_argument', `${field} 不能为空`)
  return result
}

function headers(apiKey: string): Record<string, string> {
  return {
    'accept': 'application/json',
    'anthropic-version': API_VERSION,
    'content-type': 'application/json',
    'x-api-key': apiKey,
  }
}

/** Anthropic 的错误体是 `{type, error:{type, message}}`;网关层的错误可能是纯文本。 */
function errorMessage(status: number, payload: unknown): string {
  const fallback = `anthropic request failed with ${status}`
  const nested = record(record(payload)?.error)
  return text(nested?.message) ?? text(payload) ?? fallback
}

interface RequestInput {
  body?: Json
  method?: 'GET' | 'POST'
  path: string
  query?: Record<string, boolean | null | number | string | undefined>
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  const apiKey = requireApiKey(ctx, SERVICE)
  const method = input.method ?? 'GET'
  const { data } = await http.request({
    path: input.path,
    method,
    query: Object.entries(input.query ?? {}),
    headers: headers(apiKey),
    ...(input.body === undefined ? {} : { json: input.body }),
    invalidJsonMessage: 'anthropic returned malformed JSON',
    mapError: ({ data: payload, status }) => upstreamError(status, errorMessage(status, payload)),
    mapTransportError: ({ message }) => upstreamError(
      502,
      `anthropic ${method} ${input.path} failed before receiving response: ${message ?? 'unknown network error'}`,
    ),
  })
  if (data === undefined) throw upstreamError(502, 'anthropic returned malformed JSON')
  return data
}

/** 连接器只支持非流式:让上游回一段没人能消费的 SSE 不如当场说清。 */
function assertStreamingDisabled(input: { stream?: boolean }): void {
  if (input.stream === true) {
    throw new TBError('invalid_argument', 'stream=true is not supported by connector actions')
  }
}

export async function listModels(
  input: z.infer<typeof listModelsInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, {
    path: '/v1/models',
    query: { before_id: input.before_id, after_id: input.after_id, limit: input.limit },
  })
}

export async function getModel(
  input: z.infer<typeof getModelInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, { path: `/v1/models/${encodeURIComponent(requireText(input.model_id, 'model_id'))}` })
}

export async function createMessage(
  input: z.infer<typeof createMessageInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  assertStreamingDisabled(input)
  return request(ctx, { method: 'POST', path: '/v1/messages', body: compact(input) })
}

export async function countMessageTokens(
  input: z.infer<typeof countMessageTokensInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, { method: 'POST', path: '/v1/messages/count_tokens', body: compact(input) })
}
