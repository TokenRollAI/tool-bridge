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
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'anthropic'
const API_BASE = 'https://api.anthropic.com'
/** 上游 API 的版本契约:每个请求都要带,值变了就是换了一套响应形状。 */
const API_VERSION = '2023-06-01'

type Json = Record<string, unknown>

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 上游 `optionalString` 的等价物:去空白后仍非空才算有值。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 上游 `requiredString`:schema 没标 required 的字段,必填断言落在这里。 */
function requireText(value: unknown, field: string): string {
  const result = text(value)
  if (result === undefined) throw new TBError('invalid_argument', `${field} 不能为空`)
  return result
}

/** 上游 `compactObject`:丢掉值为 undefined 的键(`null` 是有意义的值,要留住)。 */
function compact(input: Json): Json {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
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
function errorMessage(status: number, body: string): string {
  const fallback = `anthropic request failed with ${status}`
  try {
    const nested = record(record(JSON.parse(body))?.error)
    const message = text(nested?.message)
    if (message !== undefined) return message
  } catch {
    // 非 JSON 错误体(网关回的 HTML、空体)走下面的原文兜底。
  }
  return text(body) ?? fallback
}

interface RequestInput {
  body?: Json
  method?: 'GET' | 'POST'
  path: string
  query?: Json
}

function buildUrl(path: string, query: Json | undefined): string {
  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)
  const method = input.method ?? 'GET'

  let response: Response
  try {
    response = await guardedFetch(buildUrl(input.path, input.query), {
      method,
      headers: headers(apiKey),
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障。EgressBlockedError 本身是 TBError
    // (invalid_argument),它该原样冒上去而不是被说成上游故障。
    if (error instanceof TBError) throw error
    const message = error instanceof Error ? error.message : 'unknown network error'
    throw upstreamError(502, `anthropic ${method} ${input.path} failed before receiving response: ${message}`)
  }

  const raw = await response.text().catch(() => '')
  if (!response.ok) throw upstreamError(response.status, errorMessage(response.status, raw))
  try {
    return JSON.parse(raw)
  } catch {
    throw upstreamError(502, 'anthropic returned malformed JSON')
  }
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
