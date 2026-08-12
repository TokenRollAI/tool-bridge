/**
 * Langbase 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/langbase/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 上游的错误映射带一个 `phase` 轴(校验凭证阶段把 401/403 压成 400、执行阶段压成 401),
 * 还把 404/422 也压成 400。这里不保留:tool-bridge 没有"校验凭证"这一相,状态归一
 * 交给 `upstreamError` 统一口径(它的文件头点名了"有的把 404 压成 400"这类分歧)。
 * Langbase 没有稳定的自有错误码,故无需在本 provider 里覆盖。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { createMemoryInput, deleteMemoryInput, listMemoriesInput, retrieveMemoryInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'langbase'
const API_BASE = 'https://api.langbase.com'
const MEMORY_PATH = '/v1/memory'
const RETRIEVE_PATH = '/v1/memory/retrieve'

type Json = Record<string, unknown>

interface MemorySummary {
  chunkOverlap?: number
  chunkSize?: number
  description: string
  embeddingModel?: string
  name: string
  ownerLogin: string
  url: string
}

interface RetrieveMatch {
  meta: Record<string, string>
  similarity: number
  text: string
}

/** 上游 `optionalString` 的等价物:非字符串、或去空白后为空,一律当作"没给"。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 上游 `optionalNumber`:NaN / Infinity 与非数字都当作"没给"。 */
function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 上游 `optionalRecord`:数组和 null 都不算对象。 */
function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 上游 `compactObject`:丢掉值为 undefined 的键,不给上游发 `"x": null`。 */
function compact(input: Json): Json {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

/** Langbase 在边缘错误上会回空体或纯文本,两种都要能读;空体按 null 处理。 */
async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text().catch(() => '')
  if (body.trim() === '') return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    return body
  }
}

/** Langbase 的错误体没有稳定形状,按上游的优先级逐个候选位置找消息。 */
function errorMessage(payload: unknown, response: Response): string {
  if (typeof payload === 'string' && payload.trim() !== '') return payload.trim()
  const body = record(payload)
  const nested = record(body?.error)
  return text(body?.message)
    ?? text(body?.detail)
    ?? text(body?.error)
    ?? text(nested?.message)
    ?? text(nested?.detail)
    ?? text(nested?.error)
    ?? text(response.statusText)
    // 上游此处退回裸 `statusText`,而它可以是空串,消息就成了空的。改成带状态码的兜底。
    ?? `Langbase 返回 HTTP ${response.status}`
}

interface RequestInput {
  body?: Json
  method?: 'DELETE' | 'GET' | 'POST'
}

async function request(ctx: ProviderContext, path: string, input: RequestInput = {}): Promise<unknown> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
    accept: 'application/json',
  }
  if (input.body !== undefined) headers['content-type'] = 'application/json'

  const response = await guardedFetch(new URL(path, API_BASE).toString(), {
    method: input.method ?? 'GET',
    headers,
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  })

  const payload = await readPayload(response)
  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response))
  return payload
}

/** 契约说好是对象/数组;不是就是上游出问题,不是调用方的错(故 502 → unavailable)。 */
function ensureObject(value: unknown, label: string): Json {
  const object = record(value)
  if (object === undefined) throw upstreamError(502, `${label} is not an object`)
  return object
}

function ensureObjectArray(value: unknown, label: string): Json[] {
  if (!Array.isArray(value)) throw upstreamError(502, `${label} is not an array`)
  return value.map(item => ensureObject(item, label))
}

/**
 * Langbase 各端点的字段命名不一致(有的回 snake_case、有的回 camelCase),两种都收。
 * 四个必有字段缺失时补空串以满足出参契约;三个可选字段缺失时整个键省掉而不是填 null。
 */
function normalizeMemorySummary(payload: Json): MemorySummary {
  const chunkSize = num(payload.chunk_size) ?? num(payload.chunkSize)
  const chunkOverlap = num(payload.chunk_overlap) ?? num(payload.chunkOverlap)
  const embeddingModel = text(payload.embedding_model) ?? text(payload.embeddingModel)
  return {
    name: text(payload.name) ?? '',
    description: text(payload.description) ?? '',
    ownerLogin: text(payload.owner_login) ?? text(payload.ownerLogin) ?? '',
    url: text(payload.url) ?? '',
    ...(chunkSize === undefined ? {} : { chunkSize }),
    ...(chunkOverlap === undefined ? {} : { chunkOverlap }),
    ...(embeddingModel === undefined ? {} : { embeddingModel }),
  }
}

/** 出参契约要求 meta 的值全是 string,非字符串的值直接丢掉而非 String() 强转。 */
function normalizeStringRecord(value: unknown): Record<string, string> {
  const object = record(value)
  if (object === undefined) return {}
  return Object.fromEntries(
    Object.entries(object)
      .map(([key, child]) => [key, text(child)])
      .filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
}

export async function listMemories(
  _input: z.infer<typeof listMemoriesInput>,
  ctx: ProviderContext,
): Promise<{ memories: MemorySummary[] }> {
  const payload = await request(ctx, MEMORY_PATH)
  return { memories: ensureObjectArray(payload, 'Langbase memory list').map(normalizeMemorySummary) }
}

export async function createMemory(
  input: z.infer<typeof createMemoryInput>,
  ctx: ProviderContext,
): Promise<{ memory: MemorySummary }> {
  const payload = await request(ctx, MEMORY_PATH, {
    method: 'POST',
    // name/description 过一道 text():schema 只挡住了 name 的长度 0,纯空白仍能通过,
    // 而 Langbase 对空 name 报的错很含糊。description 给空白串同样视为没给。
    body: compact({
      name: text(input.name),
      description: text(input.description),
      embedding_model: input.embedding_model,
      chunk_size: input.chunk_size,
      chunk_overlap: input.chunk_overlap,
      top_k: input.top_k,
    }),
  })
  return { memory: normalizeMemorySummary(ensureObject(payload, 'Langbase created memory')) }
}

export async function deleteMemory(
  input: z.infer<typeof deleteMemoryInput>,
  ctx: ProviderContext,
): Promise<{ success: boolean }> {
  // memoryName 在生成的 schema 里是 optional —— 上游 `s.object` 只在有显式 optional 字段时
  // 才产 required 列表,单必填字段的对象就漏了 required,这个洞被等价地搬了过来。
  // 上游对缺失值做 `String(undefined)`,会打出 /v1/memory/undefined;这里挡在拼路径之前。
  const memoryName = text(input.memoryName)
  if (memoryName === undefined) {
    throw new TBError('invalid_argument', 'delete_memory 需要 memoryName')
  }
  const path = `${MEMORY_PATH}/${encodeURIComponent(memoryName)}`
  const payload = await request(ctx, path, { method: 'DELETE' })
  return { success: ensureObject(payload, 'Langbase delete response').success === true }
}

export async function retrieveMemory(
  input: z.infer<typeof retrieveMemoryInput>,
  ctx: ProviderContext,
): Promise<{ matches: RetrieveMatch[] }> {
  const payload = await request(ctx, RETRIEVE_PATH, {
    method: 'POST',
    // memory 原样转发:每项的 filters 是 Langbase 自己的过滤器 DSL(嵌套的 And/Or 树),
    // 结构由上游定义,这层不解释也不重排。
    body: compact({ query: text(input.query), memory: input.memory, topK: input.topK }),
  })
  return {
    matches: ensureObjectArray(payload, 'Langbase memory retrieve response').map(item => ({
      text: text(item.text) ?? '',
      similarity: num(item.similarity) ?? 0,
      meta: normalizeStringRecord(item.meta),
    })),
  }
}
