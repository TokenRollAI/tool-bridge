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
import { compactDefined as compact, asJsonObject as record, trimmedText as text } from '../_runtime/jsonValue'
import { createProviderHttpClient, type ResponseBodyKind } from '../_runtime/providerHttp'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'deepseek'
const API_BASE = 'https://api.deepseek.com'
/** Anthropic 兼容面挂在同一域名的子路径下,但认证头与 OpenAI 兼容面不同。 */
const ANTHROPIC_API_PREFIX = '/anthropic'
const http = createProviderHttpClient({ baseUrl: API_BASE, service: SERVICE })

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

/** SSE 在这条链路上没有承载,给 true 直接拒绝而不是静默降级成非流式。 */
function assertStreamingDisabled(input: { stream?: boolean }): void {
  if (input.stream === true) {
    throw new TBError('invalid_argument', 'stream=true is not supported by connector actions')
  }
}

interface RequestOptions {
  /** true 走 Anthropic 兼容面:换 base URL,并把认证头从 authorization 换成 x-api-key。 */
  anthropic?: boolean
  body?: Json
  method?: 'GET' | 'POST'
  path: string
}

async function request(ctx: ProviderContext, options: RequestOptions): Promise<unknown> {
  const apiKey = requireApiKey(ctx, SERVICE)
  const headers: Record<string, string> = options.anthropic === true
    ? { 'content-type': 'application/json', 'x-api-key': apiKey }
    : { 'authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' }

  const { data } = await http.request({
    path: `${options.anthropic === true ? ANTHROPIC_API_PREFIX : ''}${options.path}`,
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { json: options.body }),
    invalidJsonMessage: 'deepseek returned malformed JSON',
    mapError: ({ bodyKind, data: payload, status }) => upstreamError(
      status,
      errorMessage(payload, bodyKind, status),
    ),
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
