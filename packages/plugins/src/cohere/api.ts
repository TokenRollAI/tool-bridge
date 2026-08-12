/**
 * Cohere 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/cohere/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 三个 action 是同一形状:把入参**原样**作为 JSON body POST 给对应端点(Cohere 的请求体
 * 字段名与 action 入参一一对应,不需要重映射),响应原样透出。
 *
 * 上游的两处入参断言(`stream=true` 不支持、embed 只收 texts)这里没有重写:生成的
 * schema 是 `strictObject` 且不含 `stream`/`images`/`inputs` 这几个键,envelope 在调用
 * handler 之前就把它们挡成 400 了。
 *
 * 上游错误映射带一个 `mode` 轴(校验凭证阶段把 401/403/498 压成 400),tool-bridge 没有
 * "校验凭证"这一相(探针就是一次真实调用),故不保留;其余状态交给 `upstreamError` 归一。
 */

import type { z } from 'zod/v4'
import type { chatInput, embedTextsInput, rerankDocumentsInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'cohere'
const API_BASE = 'https://api.cohere.com'

type Json = Record<string, unknown>

/** 上游 `optionalString`:非字符串、或去空白后为空,一律当作"没给"。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/**
 * Cohere 的错误体有两种嵌套(`{message}` 与 `{error:{message}}`),两种都要能读;
 * 非 JSON 的错误页则把原文当消息。上游还会取一个 `id`(Cohere 的请求 id),
 * TBError 没有承载它的位置,故丢弃。
 */
function errorMessage(body: string, status: number): string {
  const fallback = text(body) ?? `cohere request failed with ${status}`
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return fallback
  }
  const root = record(payload)
  return text(record(root?.error)?.message) ?? text(root?.message) ?? fallback
}

/**
 * Cohere 用 498 表示"token 无效",公共归一表不认识这个码会把它压成 invalid_argument,
 * 那会让调用方以为是自己参数写错了。这里覆盖成 401 的语义。
 */
function cohereError(status: number, body: string): ReturnType<typeof upstreamError> {
  return upstreamError(status === 498 ? 401 : status, errorMessage(body, status))
}

/** 入参原样作请求体:`JSON.stringify` 本就会丢掉值为 undefined 的键(上游 `compactObject`)。 */
async function post(ctx: ProviderContext, path: string, body: object): Promise<Json> {
  const response = await guardedFetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'authorization': `Bearer ${requireApiKey(ctx, SERVICE)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const raw = await response.text().catch(() => '')
  if (!response.ok) throw cohereError(response.status, raw)

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    throw upstreamError(502, 'cohere returned an invalid JSON response')
  }
  const result = record(payload)
  if (result === undefined) throw upstreamError(502, 'cohere returned an invalid JSON response')
  return result
}

export async function chat(input: z.infer<typeof chatInput>, ctx: ProviderContext): Promise<Json> {
  return post(ctx, '/v2/chat', input)
}

export async function embedTexts(
  input: z.infer<typeof embedTextsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return post(ctx, '/v2/embed', input)
}

export async function rerankDocuments(
  input: z.infer<typeof rerankDocumentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return post(ctx, '/v2/rerank', input)
}
