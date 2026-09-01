/**
 * DeepSeek 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/deepseek/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。凭证走请求头,不进 URL。
 *
 * 三处上游细节决定了这里的形状:
 * - **两套 base URL 两套认证头**:OpenAI 兼容面在 `https://api.deepseek.com`、认证走
 *   `authorization: Bearer`;Anthropic 兼容面在 `https://api.deepseek.com/anthropic`、认证走
 *   `x-api-key`。同一把 key,头名不同 —— 发错头是 401,这两条路径不能合并。
 * - **`stream: true` 显式拒绝**:schema 收这个字段(上游 action 声明里有),但这条链路不承载
 *   SSE,给 true 就在本地挡下,而不是把 `text/event-stream` 当 JSON 解析后报"响应格式不对"。
 * - 错误文案落在 `error.message`,退回顶层 `message`,再退回原始 body。
 *
 * 与上游的有意偏离:上游 `assertDeepseekResponse` 有个 `mode: 'validate'` 分支把 401/403 压成
 * 400(它的 credentialValidators 专用)。tool-bridge 的凭证校验由平台的 credentialProbe 做,
 * 业务路径不需要这个分支,故只保留 `execute` 语义。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createAnthropicMessageInput,
  createChatCompletionInput,
  getUserBalanceInput,
  listModelsInput,
} from './schema'
import type { ProviderHttpErrorContext, ResponseBodyKind } from '../_runtime/providerHttp'
import type { ProviderContext } from '../_runtime/plugin'
import { compactDefined as compact, asJsonObject as record, trimmedText as text } from '../_runtime/jsonValue'
import { createAuthedClient } from '../_runtime/authedClient'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'deepseek'
const API_BASE = 'https://api.deepseek.com'
/** Anthropic 兼容面挂在同一域名的子路径下,但认证头与 OpenAI 兼容面不同。 */
const ANTHROPIC_API_PREFIX = '/anthropic'

type Json = Record<string, unknown>

/** 上游 `readDeepseekError`:错误文案依次落在 `error.message` / 顶层 `message` / 原始 body。 */
function errorMessage(payload: unknown, bodyKind: ResponseBodyKind, status: number): string {
  const fallback = `deepseek request failed with ${status}`
  const body = record(payload)
  const nested = record(body?.error)
  return text(nested?.message)
    ?? text(body?.message)
    ?? (bodyKind === 'invalid-json' || bodyKind === 'text' ? text(payload) : undefined)
    ?? fallback
}

function mapDeepseekError({ bodyKind, data: payload, status }: ProviderHttpErrorContext): TBError {
  return upstreamError(status, errorMessage(payload, bodyKind, status))
}

/** OpenAI 兼容面:认证走 `authorization: Bearer`。 */
const openaiHttp = createAuthedClient({
  baseUrl: API_BASE,
  service: SERVICE,
  auth: { kind: 'bearer' },
  headers: { 'content-type': 'application/json' },
  mapError: mapDeepseekError,
})

/** Anthropic 兼容面:同一把 key,认证头换成 `x-api-key` —— 发错头是 401,两个 client 不能合并。 */
const anthropicHttp = createAuthedClient({
  baseUrl: `${API_BASE}${ANTHROPIC_API_PREFIX}/`,
  service: SERVICE,
  auth: { kind: 'header', name: 'x-api-key' },
  headers: { 'content-type': 'application/json' },
  mapError: mapDeepseekError,
})

/** SSE 在这条链路上没有承载,给 true 直接拒绝而不是静默降级成非流式。 */
function assertStreamingDisabled(input: { stream?: boolean }): void {
  if (input.stream === true) {
    throw new TBError('invalid_argument', 'stream=true is not supported by connector actions')
  }
}

interface RequestOptions {
  /** true 走 Anthropic 兼容面:换 client(base URL 与认证头都不同)。 */
  anthropic?: boolean
  body?: Json
  method?: 'GET' | 'POST'
  path: string
}

async function request(ctx: ProviderContext, options: RequestOptions): Promise<unknown> {
  const client = options.anthropic === true ? anthropicHttp : openaiHttp
  const { data } = await client.request(ctx, {
    path: options.path,
    method: options.method ?? 'GET',
    ...(options.body === undefined ? {} : { json: options.body }),
    invalidJsonMessage: 'deepseek returned malformed JSON',
  })
  if (data === undefined) throw upstreamError(502, 'deepseek returned malformed JSON')
  return data
}

export function listModels(_input: z.infer<typeof listModelsInput>, ctx: ProviderContext): Promise<unknown> {
  return request(ctx, { path: '/models' })
}

export function getUserBalance(_input: z.infer<typeof getUserBalanceInput>, ctx: ProviderContext): Promise<unknown> {
  return request(ctx, { path: '/user/balance' })
}

export function createChatCompletion(
  input: z.infer<typeof createChatCompletionInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  assertStreamingDisabled(input)
  return request(ctx, { path: '/chat/completions', method: 'POST', body: compact(input) })
}

export function createAnthropicMessage(
  input: z.infer<typeof createAnthropicMessageInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  assertStreamingDisabled(input)
  return request(ctx, { path: '/v1/messages', method: 'POST', body: compact(input), anthropic: true })
}
