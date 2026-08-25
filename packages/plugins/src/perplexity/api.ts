/**
 * Perplexity 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/perplexity/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。凭证在 **Authorization 头**,不进 URL。
 *
 * 四个 action 是同一形状:一个 GET(列模型)+ 三个"整个入参就是 JSON body"的 POST。
 * 三处上游细节决定了这里的形状:
 * - `stream: true` 在 schema 里是合法字段(Perplexity API 支持),但连接器消费不了 SSE,
 *   故在本地拦成 invalid_argument —— 让它打过去只会回一段没人能解的流。
 * - embeddings 的 `dimensions` 上限**随模型变**(0.6b 是 1024,4b 是 2560),这是一个
 *   跨字段约束,Zod 的 `z.int()` 表达不了,必须留在这层。
 * - 错误消息在 `error.message` / `error.detail` / 顶层 `message` / 顶层 `detail` 四处之一,
 *   逐个回退才拿得到人能读的那句。
 *
 * 与上游的有意偏离:
 * - 上游把 5xx 一律压成 502、把 `mode: 'validate'` 下的 401/403 说成 400。前者由
 *   `_runtime/upstreamError.ts` 统一归一(原始状态更有诊断价值),后者只服务上游的
 *   `credentialValidators`,平台侧的 credentialProbe 自己做这层分账,故不迁。
 * - 2xx 上回非 JSON 时上游会抛裸的 `SyntaxError`(冒到归一处变成"插件崩了")。这里判成
 *   `unavailable` + retryable —— 那是上游坏了,不是插件坏了。
 * - 不发 `user-agent`:上游那个值标识的是 open-connector 进程,在这里已无意义。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createChatCompletionInput,
  createEmbeddingsInput,
  listModelsInput,
  searchInput,
} from './schema'
import { createProviderHttpClient, type ResponseBodyKind } from '../_runtime/providerHttp'
import { asJsonObject as record, trimmedText as text } from '../_runtime/jsonValue'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'perplexity'
const API_BASE = 'https://api.perplexity.ai'
const http = createProviderHttpClient({ baseUrl: API_BASE, service: SERVICE })

/** embeddings 的 `dimensions` 下限,与模型无关。 */
const EMBEDDING_MIN_DIMENSIONS = 128
/** `dimensions` 上限随模型变;表里没有的模型按上游的兜底值 2560 算。 */
const EMBEDDING_MAX_DIMENSIONS: Record<string, number> = { 'pplx-embed-v1-0.6b': 1024 }
const EMBEDDING_MAX_DIMENSIONS_FALLBACK = 2560

/** Perplexity 的错误体有嵌套与顶层两种形状,消息键还分 message / detail。 */
function errorMessage(status: number, payload: unknown, bodyKind: ResponseBodyKind): string {
  const top = record(payload)
  const nested = record(top?.error)
  return text(nested?.message)
    ?? text(nested?.detail)
    ?? text(top?.message)
    ?? text(top?.detail)
    ?? (bodyKind === 'invalid-json' || bodyKind === 'text' ? text(payload) : undefined)
    ?? `perplexity request failed with ${status}`
}

async function request(
  ctx: ProviderContext,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  const { data } = await http.request({
    path,
    method,
    headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
    // 上游先过一道 `compactObject`;JSON.stringify 本来就丢 undefined 值,故不再重复一遍。
    ...(method === 'POST' ? { json: body ?? {} } : {}),
    invalidJsonMessage: 'Perplexity 返回了非 JSON 响应',
    mapError: ({ bodyKind, data: payload, status }) => upstreamError(
      status,
      errorMessage(status, payload, bodyKind),
    ),
    mapTransportError: ({ message }) => upstreamError(
      502,
      `perplexity ${method} ${path} failed before receiving response: ${message ?? 'unknown network error'}`,
    ),
  })
  return data ?? null
}

/** 连接器只支持非流式:`stream: true` 打过去会回一段没人能消费的 SSE。 */
function assertStreamingDisabled(input: { stream?: boolean }): void {
  if (input.stream === true) {
    throw new TBError('invalid_argument', 'stream=true is not supported by connector actions')
  }
}

/** `dimensions` 的上限取决于 `model`,是跨字段约束,schema 表达不了。 */
function assertEmbeddingDimensions(input: z.infer<typeof createEmbeddingsInput>): void {
  const dimensions = input.dimensions
  if (dimensions === undefined) return

  const max = EMBEDDING_MAX_DIMENSIONS[input.model] ?? EMBEDDING_MAX_DIMENSIONS_FALLBACK
  if (dimensions < EMBEDDING_MIN_DIMENSIONS || dimensions > max) {
    throw new TBError(
      'invalid_argument',
      `${input.model} dimensions must be between ${EMBEDDING_MIN_DIMENSIONS} and ${max}`,
    )
  }
}

export async function listModels(
  _input: z.infer<typeof listModelsInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, 'GET', '/v1/models')
}

export async function search(
  input: z.infer<typeof searchInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, 'POST', '/search', input)
}

export async function createChatCompletion(
  input: z.infer<typeof createChatCompletionInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  assertStreamingDisabled(input)
  return request(ctx, 'POST', '/v1/sonar', input)
}

export async function createEmbeddings(
  input: z.infer<typeof createEmbeddingsInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  assertEmbeddingDimensions(input)
  return request(ctx, 'POST', '/v1/embeddings', input)
}
