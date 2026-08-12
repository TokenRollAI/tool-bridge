/**
 * OpenRouter 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/openrouter/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。凭证走 `Authorization: Bearer` 头,不进 URL。
 *
 * 四处上游细节决定了这里的形状:
 * - **`httpReferer` / `xTitle` 是"伪入参"**:它们不进请求体,而是变成 `HTTP-Referer` /
 *   `X-Title` 两个请求头(OpenRouter 用它们做归因统计)。发进 body 会被上游当成未知字段。
 *   故每个 POST 的请求体都要先 `stripHeaderInputs`,漏了这一步归因头没了、body 还多两个字段。
 * - **`stream: true` 在本层就拒**:连接器返回的是一次性 JSON,不是 SSE 流。放过去会拿到一段
 *   解不开的 `data:` 流,报出来像"上游返回非 JSON"。
 * - **legacy 的 `functions` / `function_call` 要现场翻译成 `tools` / `tool_choice`**:
 *   已经给了新字段就不翻译(新的优先),翻完两个旧字段都不发。
 * - **`list_available_models` 的 `useRss` 会让上游回 XML**:那时出参是 `{rss: "<xml…>"}`,
 *   不能按 JSON 解。只在**显式要了 RSS**时才接受非 JSON 响应,免得把"上游坏了"当成正常出参。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createChatCompletionInput,
  createMessageInput,
  getCurrentKeyInput,
  getGenerationInput,
  getModelsCountInput,
  listAvailableModelsInput,
  listEmbeddingModelsInput,
  listModelEndpointsInput,
  listUserModelsInput,
  listZdrEndpointsInput,
} from './schema'
import type { createCoinbaseChargeInput } from './schema.handwritten'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'openrouter'
const API_BASE = 'https://openrouter.ai/api/v1'

/** 这两个入参是请求**头**的来源,不进请求体。 */
const HEADER_INPUT_KEYS = ['httpReferer', 'xTitle'] as const

type Json = Record<string, unknown>
type QueryValue = boolean | number | string | undefined

interface RequestInput {
  /** 只在显式要了 RSS 时为真:允许非 JSON 响应,包成 `{rss}`。 */
  allowText?: boolean
  body?: Json
  /** 取 `httpReferer` / `xTitle` 的来源(不是每个 action 都有这两个入参)。 */
  headerSource?: Json
  method?: 'GET' | 'POST'
  path: string
  query?: Record<string, QueryValue>
}

/** 上游 `optionalString`:去空白后仍非空才算有值。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 契约说好是对象;不是就是上游出问题,不是调用方的错。 */
function requireRecord(value: unknown, label: string): Json {
  const result = record(value)
  if (result === undefined) {
    throw new TBError('unavailable', `OpenRouter 的${label}不是对象`, { retryable: true })
  }
  return result
}

/** 丢掉值为 undefined 的键(上游 `compactObject`);`null` 要留住。 */
function compact(input: Json): Json {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

/** 请求体 = 入参去掉两个"伪入参"与未给的字段。 */
function stripHeaderInputs(input: object): Json {
  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) =>
      !HEADER_INPUT_KEYS.includes(key as (typeof HEADER_INPUT_KEYS)[number]) && value !== undefined),
  )
}

/** 连接器只返回一次性 JSON;流式请求在本层就拒,而不是让它变成一段解不开的响应。 */
function assertStreamingDisabled(input: { stream?: boolean }): void {
  if (input.stream === true) {
    throw new TBError('invalid_argument', 'stream=true 不被支持:本 action 只返回一次性响应')
  }
}

/** legacy `functions` → `tools`:每个函数声明包一层 `{type:'function', function}`。 */
function legacyTools(value: unknown): Json[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map(tool => ({ type: 'function', function: tool }))
}

/** legacy `function_call` → `tool_choice`:'none'/'auto' 原样,具名的包成 tool 引用。 */
function legacyToolChoice(value: unknown): Json | string | undefined {
  if (value === 'none' || value === 'auto') return value
  const name = text(record(value)?.name)
  if (name === undefined) return undefined
  return { type: 'function', function: { name } }
}

function buildUrl(path: string, query: Record<string, QueryValue>): string {
  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  return url.toString()
}

/** OpenRouter 的错误体:`{error:{type, code, message}}`,也可能把 message 放在根上。 */
function errorMessage(payload: unknown): string | undefined {
  const body = record(payload)
  if (body === undefined) return undefined
  return text(record(body.error)?.message) ?? text(body.message)
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<Json> {
  const hasBody = input.body !== undefined
  const headers = new Headers({ authorization: `Bearer ${requireApiKey(ctx, SERVICE)}` })
  if (hasBody) headers.set('content-type', 'application/json')
  const referer = text(input.headerSource?.httpReferer)
  const title = text(input.headerSource?.xTitle)
  if (referer !== undefined) headers.set('HTTP-Referer', referer)
  if (title !== undefined) headers.set('X-Title', title)

  const response = await guardedFetch(buildUrl(input.path, input.query ?? {}), {
    method: input.method ?? 'GET',
    headers,
    ...(hasBody ? { body: JSON.stringify(compact(input.body ?? {})) } : {}),
  })

  const body = await response.text()
  if (response.ok) {
    const contentType = response.headers.get('content-type') ?? ''
    const isText = contentType.includes('xml') || contentType.includes('rss') || contentType.startsWith('text/')
    // 只有显式要了 RSS 才接受非 JSON;否则非 JSON 就是上游坏了。
    if (input.allowText === true && isText) return { rss: body }
    try {
      return requireRecord(JSON.parse(body), '响应')
    } catch (error) {
      if (error instanceof TBError) throw error
      throw new TBError('unavailable', 'OpenRouter 返回了非 JSON 响应', { retryable: true })
    }
  }

  let payload: unknown = null
  try {
    payload = JSON.parse(body)
  } catch {
    // 错误响应回 HTML(网关的 5xx 页面)很常见,那时按 HTTP 状态归一,不把上游正文回显。
  }
  throw upstreamError(response.status, errorMessage(payload) ?? `OpenRouter 返回 HTTP ${response.status}`)
}

export function createChatCompletion(
  input: z.infer<typeof createChatCompletionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  assertStreamingDisabled(input)
  const body = stripHeaderInputs(input)
  return request(ctx, {
    method: 'POST',
    path: '/chat/completions',
    headerSource: input,
    body: compact({
      ...body,
      // 给了新字段就不翻译 legacy 的那两个(新的优先),翻完旧字段一律不发。
      tools: body.tools ?? legacyTools(input.functions),
      tool_choice: body.tool_choice ?? legacyToolChoice(input.function_call),
      functions: undefined,
      function_call: undefined,
    }),
  })
}

export function createCoinbaseCharge(
  input: z.infer<typeof createCoinbaseChargeInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, {
    method: 'POST',
    path: '/credits/coinbase',
    headerSource: input,
    body: stripHeaderInputs(input),
  })
}

export function createMessage(input: z.infer<typeof createMessageInput>, ctx: ProviderContext): Promise<Json> {
  assertStreamingDisabled(input)
  return request(ctx, {
    method: 'POST',
    path: '/messages',
    headerSource: input,
    body: stripHeaderInputs(input),
  })
}

export function getCredits(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return request(ctx, { path: '/credits' })
}

export function getCurrentKey(input: z.infer<typeof getCurrentKeyInput>, ctx: ProviderContext): Promise<Json> {
  return request(ctx, { path: '/key', headerSource: input })
}

export function getGeneration(input: z.infer<typeof getGenerationInput>, ctx: ProviderContext): Promise<Json> {
  return request(ctx, { path: '/generation', query: { id: input.id } })
}

export function getModelsCount(input: z.infer<typeof getModelsCountInput>, ctx: ProviderContext): Promise<Json> {
  return request(ctx, {
    path: '/models/count',
    headerSource: input,
    query: { output_modalities: text(input.outputModalities) },
  })
}

export function listAvailableModels(
  input: z.infer<typeof listAvailableModelsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, {
    path: '/models',
    // 入参名是驼峰,query 名是下划线 —— 这一层改名是上游的,不是笔误。
    query: {
      category: text(input.category),
      supported_parameters: text(input.supportedParameters),
      output_modalities: text(input.outputModalities),
      use_rss: input.useRss,
      use_rss_chat_links: input.useRssChatLinks,
    },
    allowText: input.useRss === true,
  })
}

export function listEmbeddingModels(
  input: z.infer<typeof listEmbeddingModelsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, { path: '/embeddings/models', headerSource: input })
}

export function listModelEndpoints(
  input: z.infer<typeof listModelEndpointsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/models/${encodeURIComponent(input.author)}/${encodeURIComponent(input.slug)}/endpoints`
  return request(ctx, { path })
}

export function listProviders(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return request(ctx, { path: '/providers' })
}

export function listUserModels(input: z.infer<typeof listUserModelsInput>, ctx: ProviderContext): Promise<Json> {
  return request(ctx, { path: '/models/user', headerSource: input })
}

export function listZdrEndpoints(input: z.infer<typeof listZdrEndpointsInput>, ctx: ProviderContext): Promise<Json> {
  return request(ctx, { path: '/endpoints/zdr', headerSource: input })
}
