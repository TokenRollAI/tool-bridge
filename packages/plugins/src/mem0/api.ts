/**
 * Mem0 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/mem0/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 四处上游细节决定了这里的形状:
 * - 认证头是 `Authorization: Token <key>`,**不是** Bearer。
 * - 路径末尾的斜杠是**必需**的(`/v1/memories/`、`/v1/memories/{id}/`):Mem0 的后端会对
 *   无斜杠路径 301 到带斜杠版本,而 DELETE/PUT 跟随重定向会被降级成 GET(见 guardedFetch),
 *   于是"删除成功"其实什么都没删。逐条路径照抄,不要顺手去掉。
 * - 列事件走 `/v1/events/`(复数),取单个事件却走 `/v1/event/{id}/`(**单数**)—— 上游
 *   API 就是这么不对称的。
 * - 一批必填断言在上游 executor 里而不在 action 声明里(`memory_id`、`event_id` 在 schema
 *   里是 optional),另有三条跨字段约束:add 要 `memory` 或 `messages`、update 要 `text` 或
 *   `metadata`、get_users 的 `org_id`/`project_id` 必须同进同出。这些都保留在本层。
 *
 * 与上游的有意偏离:上游对 401/403 在"校验凭证"阶段压成 400,在业务调用阶段保持原状。
 * 本层只有业务调用这一种阶段(挂载期校验由平台的 credentialProbe 走同一条路径),故一律
 * 按原状态归一。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  addMemoriesInput,
  deleteMemoryInput,
  getEventInput,
  getEventsInput,
  getMemoriesInput,
  getMemoryHistoryInput,
  getMemoryInput,
  getUsersInput,
  searchMemoriesInput,
  updateMemoryInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'mem0'
const API_BASE = 'https://api.mem0.ai'

type Json = Record<string, unknown>
type QueryValue = number | string | undefined

interface RequestInput {
  body?: Json
  method?: 'DELETE' | 'GET' | 'POST' | 'PUT'
  path: string
  query?: Record<string, QueryValue>
}

/** 上游 `optionalString` 的等价物:去空白后仍非空才算有值。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 丢掉值为 undefined 的键(上游 `compactObject`)。 */
function compact(input: Record<string, unknown>): Json {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

/**
 * 上游 `requiredString` 的等价物。这些字段在生成的 schema 里是 optional(上游 action 声明
 * 没写 required),必填断言只存在于 executor 里 —— 迁移时保留在这层,而不是去改 schema。
 */
function requireText(value: unknown, field: string): string {
  const result = text(value)
  if (result === undefined) throw new TBError('invalid_argument', `${field} 是必填的`)
  return result
}

/** Mem0 的错误体形状不止一种:detail 可能是串、也可能是 FastAPI 的 [{msg}] 数组。 */
function errorMessage(body: string, status: number): string {
  if (body === '') return `Mem0 返回 HTTP ${status}`
  let payload: Json | undefined
  try {
    payload = record(JSON.parse(body))
  } catch {
    return body
  }
  if (payload === undefined) return body

  const detail = payload.detail
  if (typeof detail === 'string' && detail !== '') return detail
  if (Array.isArray(detail)) {
    const parts = detail
      .map(item => (typeof record(item)?.msg === 'string' ? (record(item)?.msg as string) : undefined))
      .filter((item): item is string => item !== undefined && item !== '')
    if (parts.length > 0) return parts.join('; ')
  }
  if (typeof payload.message === 'string' && payload.message !== '') return payload.message
  if (typeof payload.error === 'string' && payload.error !== '') return payload.error
  return body
}

function buildUrl(path: string, query: Record<string, QueryValue> | undefined): string {
  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

function rawRequest(ctx: ProviderContext, input: RequestInput): Promise<Response> {
  const headers: Record<string, string> = {
    // Token 而非 Bearer —— Mem0 用的是 DRF 的 TokenAuthentication。
    authorization: `Token ${requireApiKey(ctx, SERVICE)}`,
    accept: 'application/json',
  }
  if (input.body !== undefined) headers['content-type'] = 'application/json'
  return guardedFetch(buildUrl(input.path, input.query), {
    method: input.method ?? 'GET',
    headers,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  })
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  const response = await rawRequest(ctx, input)
  const body = await response.text()
  if (!response.ok) throw upstreamError(response.status, errorMessage(body, response.status))
  // 204 与空正文都按"成功但无内容"处理;非 JSON 正文原样兜住,不当成故障
  // (上游如此:这些接口偶尔回纯文本 ack,压成错误会让一次成功的写变成失败)。
  if (response.status === 204 || body === '') return {}
  try {
    return JSON.parse(body)
  } catch {
    return { raw: body }
  }
}

export function addMemories(input: z.infer<typeof addMemoriesInput>, ctx: ProviderContext): Promise<unknown> {
  const memory = text(input.memory)
  if (memory === undefined && !Array.isArray(input.messages)) {
    // schema 两个字段都是 optional,但空请求打上游必然 400;而且纯空白的 memory 能过
    // Zod 的 min(1),到这里才被 text() 判成缺失。
    throw new TBError('invalid_argument', '必须提供 memory 或 messages')
  }
  return request(ctx, {
    method: 'POST',
    path: '/v1/memories/',
    body: compact({
      memory,
      messages: input.messages,
      user_id: text(input.user_id),
      agent_id: text(input.agent_id),
      app_id: text(input.app_id),
      run_id: text(input.run_id),
      org_id: text(input.org_id),
      project_id: text(input.project_id),
      metadata: record(input.metadata),
      custom_categories: record(input.custom_categories),
      enable_graph: input.enable_graph,
      infer: input.infer,
      async_mode: input.async_mode,
      output_format: text(input.output_format),
      version: text(input.version),
      custom_instructions: text(input.custom_instructions),
      immutable: input.immutable,
      timestamp: input.timestamp,
      expiration_date: text(input.expiration_date),
      includes: text(input.includes),
      excludes: text(input.excludes),
    }),
  })
}

export function getMemories(input: z.infer<typeof getMemoriesInput>, ctx: ProviderContext): Promise<unknown> {
  // v2 的"列举"是 POST + body 里带 filters,不是 GET + query。
  return request(ctx, {
    method: 'POST',
    path: '/v2/memories/',
    body: compact({
      filters: record(input.filters),
      page: input.page,
      page_size: input.page_size,
      org_id: text(input.org_id),
      project_id: text(input.project_id),
    }),
  })
}

export function searchMemories(input: z.infer<typeof searchMemoriesInput>, ctx: ProviderContext): Promise<unknown> {
  return request(ctx, {
    method: 'POST',
    path: '/v2/memories/search/',
    body: compact({
      query: requireText(input.query, 'query'),
      filters: record(input.filters),
      top_k: input.top_k,
      rerank: input.rerank,
      threshold: input.threshold,
      fields: input.fields,
      keyword_search: input.keyword_search,
      filter_memories: input.filter_memories,
      org_id: text(input.org_id),
      project_id: text(input.project_id),
    }),
  })
}

export function getMemory(input: z.infer<typeof getMemoryInput>, ctx: ProviderContext): Promise<unknown> {
  const memoryId = requireText(input.memory_id, 'memory_id')
  return request(ctx, { path: `/v1/memories/${encodeURIComponent(memoryId)}/` })
}

export function updateMemory(input: z.infer<typeof updateMemoryInput>, ctx: ProviderContext): Promise<unknown> {
  const memoryId = requireText(input.memory_id, 'memory_id')
  const value = text(input.text)
  const metadata = record(input.metadata)
  if (value === undefined && metadata === undefined) {
    throw new TBError('invalid_argument', '必须提供 text 或 metadata')
  }
  return request(ctx, {
    method: 'PUT',
    path: `/v1/memories/${encodeURIComponent(memoryId)}/`,
    body: compact({ text: value, metadata }),
  })
}

export async function deleteMemory(input: z.infer<typeof deleteMemoryInput>, ctx: ProviderContext): Promise<Json> {
  const memoryId = requireText(input.memory_id, 'memory_id')
  const response = await rawRequest(ctx, {
    method: 'DELETE',
    path: `/v1/memories/${encodeURIComponent(memoryId)}/`,
  })
  const body = await response.text()
  if (!response.ok) throw upstreamError(response.status, errorMessage(body, response.status))

  // 删除的响应体形状不稳定(有时空、有时 {message}),但出参契约要求一个明确的回执:
  // 只回"上游没报错"给调用方,它分不清"删掉了"和"这次调用被吞了"。
  let payload: Json | undefined
  try {
    payload = body === '' ? undefined : record(JSON.parse(body))
  } catch {
    payload = undefined
  }
  return {
    memory_id: memoryId,
    deleted: true,
    message: text(payload?.message) ?? 'Memory deleted successfully!',
  }
}

export function getMemoryHistory(input: z.infer<typeof getMemoryHistoryInput>, ctx: ProviderContext): Promise<unknown> {
  const memoryId = requireText(input.memory_id, 'memory_id')
  return request(ctx, { path: `/v1/memories/${encodeURIComponent(memoryId)}/history/` })
}

export function getEvents(input: z.infer<typeof getEventsInput>, ctx: ProviderContext): Promise<unknown> {
  return request(ctx, {
    path: '/v1/events/',
    query: {
      event_type: text(input.event_type),
      start_date: text(input.start_date),
      end_date: text(input.end_date),
      page: input.page,
      page_size: input.page_size,
    },
  })
}

export function getEvent(input: z.infer<typeof getEventInput>, ctx: ProviderContext): Promise<unknown> {
  const eventId = requireText(input.event_id, 'event_id')
  // 单数 `/v1/event/`,不是列表用的 `/v1/events/`。
  return request(ctx, { path: `/v1/event/${encodeURIComponent(eventId)}/` })
}

export function getUsers(input: z.infer<typeof getUsersInput>, ctx: ProviderContext): Promise<unknown> {
  const orgId = text(input.org_id)
  const projectId = text(input.project_id)
  if ((orgId === undefined) !== (projectId === undefined)) {
    // 只给一半上游会静默忽略作用域、把**整个组织**的用户列出来,故在本层拒掉。
    throw new TBError('invalid_argument', 'org_id 与 project_id 必须同时提供或同时省略')
  }
  return request(ctx, {
    path: '/v1/entities/',
    query: { entity_type: 'user', org_id: orgId, project_id: projectId },
  })
}
