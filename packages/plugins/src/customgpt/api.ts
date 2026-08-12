/**
 * CustomGPT.ai 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/customgpt/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 与上游有意偏离的两处:
 * - **错误映射交给共用的 `upstreamError`**。上游把 404/409/422 一律压成 400,抹平了
 *   "资源不存在"与"参数不合法"之别;共用映射把它们分别归到 not_found / conflict。
 * - **不迁 validate 阶段**(凭证校验是平台的事),只留 execute 口径。
 *
 * CustomGPT 的两个形状特点决定了这里的写法:
 * - 响应统一包一层 `{status, data}`,`unwrapData` 是剥它的唯一入口;
 * - `send_message` 的请求体是 **multipart form-data**(其余都是 JSON),
 *   且 labels 用 `labels[0][]` 这种下标固定为 0 的重复键(上游的 OR 标签组约定)。
 */

import type { z } from 'zod/v4'
import type {
  createConversationInput,
  getAgentInput,
  listAgentsInput,
  listConversationsInput,
  listDocumentsInput,
  listMessagesInput,
  sendMessageInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'customgpt'
const API_BASE = 'https://app.customgpt.ai'

type Json = Record<string, unknown>

function toRecord(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 上游 `optionalString` 的语义:非空白字符串才算数,且取 trim 后的值。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function readObject(value: unknown): Json {
  return toRecord(value) ?? {}
}

function readObjectArray(value: unknown): Json[] {
  return Array.isArray(value) ? value.map(readObject) : []
}

/** CustomGPT 的分页字段有时是数字、有时是数字字符串,两种都收。 */
function optionalInteger(value: unknown): number | undefined {
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isInteger(parsed) ? parsed : undefined
  }
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

function normalizePagination(input: Json): Json {
  return {
    currentPage: optionalInteger(input.current_page) ?? null,
    lastPage: optionalInteger(input.last_page) ?? null,
    perPage: optionalInteger(input.per_page) ?? null,
    total: optionalInteger(input.total) ?? null,
    nextPageUrl: text(input.next_page_url) ?? null,
    previousPageUrl: text(input.prev_page_url) ?? null,
  }
}

/** 响应统一包一层 `{status, data}`;没有 data 键就说明这层包装不存在,原样返回。 */
function unwrapData(payload: unknown): unknown {
  const root = toRecord(payload)
  if (root === undefined || !('data' in root)) return payload
  return root.data
}

async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text().catch(() => '')
  if (body.trim() === '') return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    return body
  }
}

function errorMessage(payload: unknown, response: Response): string {
  if (typeof payload === 'string' && payload.trim() !== '') return payload

  const root = toRecord(payload)
  const message = root === undefined
    ? undefined
    : text(root.message) ?? text(readObject(root.data).message) ?? text(readObject(root.error).message)

  // 上游退回 `response.statusText`,而 statusText 允许是空串 —— `??` 接不住它。
  return message ?? (response.statusText || `CustomGPT 返回 HTTP ${response.status}`)
}

interface RequestInput {
  body?: FormData | Json
  method?: 'GET' | 'POST'
  path: string
  query?: Record<string, unknown>
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  const url = new URL(input.path, API_BASE)
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
  }
  // FormData 的 content-type 必须带 boundary,交给 fetch 自己生成。
  if (input.body !== undefined && !(input.body instanceof FormData)) {
    headers['content-type'] = 'application/json'
  }

  const response = await guardedFetch(url.toString(), {
    method: input.method ?? 'GET',
    headers,
    ...(input.body === undefined
      ? {}
      : { body: input.body instanceof FormData ? input.body : JSON.stringify(input.body) }),
  })
  const payload = await readPayload(response)
  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response))
  return payload
}

export async function listAgents(
  input: z.infer<typeof listAgentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: '/api/v1/projects',
    // 上游把 camelCase 的 orderBy 原样当查询参数名发出去,不转 snake_case;照搬。
    query: {
      page: input.page,
      duration: input.duration,
      order: input.order,
      orderBy: input.orderBy,
      width: input.width,
      height: input.height,
      name: input.name,
    },
  })
  const raw = readObject(unwrapData(payload))
  return { agents: readObjectArray(raw.data), pagination: normalizePagination(raw), raw }
}

export async function getAgent(
  input: z.infer<typeof getAgentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/api/v1/projects/${input.projectId}`,
    query: { width: input.width, height: input.height },
  })
  const agent = readObject(unwrapData(payload))
  return { agent, raw: agent }
}

export async function listConversations(
  input: z.infer<typeof listConversationsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/api/v1/projects/${input.projectId}/conversations`,
    query: {
      page: input.page,
      order: input.order,
      orderBy: input.orderBy,
      userFilter: input.userFilter,
      name: input.name,
      lastUpdatedAfter: input.lastUpdatedAfter,
    },
  })
  const raw = readObject(unwrapData(payload))
  return { conversations: readObjectArray(raw.data), pagination: normalizePagination(raw), raw }
}

export async function createConversation(
  input: z.infer<typeof createConversationInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/api/v1/projects/${input.projectId}/conversations`,
    method: 'POST',
    body: input.name === undefined ? {} : { name: input.name },
  })
  const conversation = readObject(unwrapData(payload))
  return {
    conversation,
    sessionId: text(conversation.session_id) ?? null,
    raw: conversation,
  }
}

function buildSendMessageForm(input: z.infer<typeof sendMessageInput>): FormData {
  const form = new FormData()
  form.append('prompt', input.prompt)
  const optional: Array<[string, string | undefined]> = [
    ['custom_persona', input.customPersona],
    ['chatbot_model', input.chatbotModel],
    ['response_source', input.responseSource],
    ['custom_context', input.customContext],
    ['agent_capability', input.agentCapability],
  ]
  for (const [key, value] of optional) {
    const trimmed = text(value)
    if (trimmed !== undefined) form.append(key, trimmed)
  }
  // 下标固定为 0:CustomGPT 用 `labels[0][]` 表示"一个 OR 标签组",不是数组索引。
  for (const label of input.labels ?? []) {
    const trimmed = text(label)
    if (trimmed !== undefined) form.append('labels[0][]', trimmed)
  }
  if (input.labelsExclusive !== undefined) form.append('labels_exclusive', String(input.labelsExclusive))
  if (input.actionOverrides !== undefined) form.append('action_overrides', JSON.stringify(input.actionOverrides))
  return form
}

export async function sendMessage(
  input: z.infer<typeof sendMessageInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/api/v1/projects/${input.projectId}/conversations/${encodeURIComponent(input.sessionId)}/messages`,
    method: 'POST',
    query: { lang: input.lang, external_id: input.externalId },
    body: buildSendMessageForm(input),
  })
  const message = readObject(unwrapData(payload))
  return {
    message,
    messageId: optionalInteger(message.id) ?? null,
    response: text(message.openai_response) ?? null,
    citations: message.citations ?? null,
    raw: message,
  }
}

export async function listMessages(
  input: z.infer<typeof listMessagesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/api/v1/projects/${input.projectId}/conversations/${encodeURIComponent(input.sessionId)}/messages`,
    query: { page: input.page, order: input.order, includeInsights: input.includeInsights },
  })
  const raw = readObject(unwrapData(payload))
  return { messages: readObjectArray(raw.data), pagination: normalizePagination(raw), raw }
}

export async function listDocuments(
  input: z.infer<typeof listDocumentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/api/v1/projects/${input.projectId}/pages`,
    query: {
      page: input.page,
      limit: input.limit,
      order: input.order,
      search: input.search,
      crawl_status: input.crawlStatus,
      index_status: input.indexStatus,
    },
  })
  const raw = readObject(unwrapData(payload))
  // 文档列表比其他 list 多套一层 `pages`:分页元数据在 pages 上,不在 raw 上。
  const pages = readObject(raw.pages)
  return {
    project: toRecord(raw.project) ?? null,
    documents: readObjectArray(pages.data),
    pagination: normalizePagination(pages),
    raw,
  }
}
