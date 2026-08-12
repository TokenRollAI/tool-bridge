/**
 * ChatBotKit 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/chatbotkit/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * ChatBotKit 的 API 形状很规整,27 个 action 收敛成三种模板:
 * - **GET + 路径**(fetch/download):路径带资源 id,无 body。
 * - **GET + 分页 query**(list):`take`/`cursor`/`order`,外加 `meta` 展开成 `meta[key]=v`。
 * - **POST + body**(create/update/search/attach/…):把**整个入参**去掉路径参数后当 body。
 *   多数写入类入参是 looseObject —— 白名单会把调用方多传的字段悄悄吃掉,故照搬上游的
 *   "去掉路径参数,其余全发"。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  attachDatasetFileInput,
  completeConversationInput,
  createBotInput,
  createConversationInput,
  createConversationMessageInput,
  createDatasetInput,
  createDatasetRecordInput,
  createFileInput,
  detachDatasetFileInput,
  downloadFileInput,
  fetchBotInput,
  fetchConversationInput,
  fetchDatasetInput,
  fetchFileInput,
  fetchUsageInput,
  listBotsInput,
  listConversationMessagesInput,
  listConversationsInput,
  listDatasetFilesInput,
  listDatasetRecordsInput,
  listDatasetsInput,
  listFilesInput,
  searchDatasetInput,
  syncFileInput,
  updateBotInput,
  updateDatasetInput,
  uploadFileInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'chatbotkit'
const API_BASE = 'https://api.chatbotkit.com/api/v1'

type Json = Record<string, unknown>

function asRecord(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined
}

/** 上游 `optionalString` 的语义:先 trim,空则视为缺失。 */
function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * 路径参数在几个 action 的 schema 里是 optional(生成器照搬了上游 action 定义),
 * 但拼进 URL 前必须非空,否则会打出 `/bot/undefined/update`。
 */
function requirePathSegment(value: unknown, field: string): string {
  const text = optionalText(value)
  if (text === undefined) throw new TBError('invalid_argument', `${field} 不能为空`)
  return encodeURIComponent(text)
}

/** 上游 `queryParams`:`undefined`/`null`/空串都不发,其余一律 String 化。 */
function appendQuery(url: URL, query: Json): void {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(key, String(value))
  }
}

/** 上游 `compactJson`:递归丢掉值为 `undefined` 的键。 */
function compactJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => compactJson(item))
  const record = asRecord(value)
  if (record === undefined) return value
  return Object.fromEntries(
    Object.entries(record)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, compactJson(child)]),
  )
}

/**
 * 成功时非 JSON 算上游破契约(502);失败时非 JSON 就把原文当消息 ——
 * 错误页是 HTML 的情况下,那段 HTML 比"invalid JSON"有诊断价值。
 */
async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.trim() === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    if (!response.ok) return text
    throw upstreamError(502, 'ChatBotKit 返回了非法 JSON')
  }
}

interface RequestInput {
  body?: unknown
  method?: 'GET' | 'POST'
  query?: Json
}

async function request(ctx: ProviderContext, path: string, input: RequestInput = {}): Promise<unknown> {
  const apiKey = requireApiKey(ctx, SERVICE)
  const url = new URL(`${API_BASE}${path}`)
  appendQuery(url, input.query ?? {})

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${apiKey}`,
  }
  if (input.body !== undefined) headers['content-type'] = 'application/json'

  let response: Response
  let payload: unknown
  try {
    response = await guardedFetch(url.toString(), {
      method: input.method ?? 'GET',
      headers,
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    })
    payload = await readPayload(response)
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障,还丢掉唯一有诊断价值的那句消息。
    if (error instanceof TBError) throw error
    throw upstreamError(
      502,
      error instanceof Error ? `ChatBotKit 请求失败: ${error.message}` : 'ChatBotKit 请求失败',
    )
  }

  if (!response.ok) {
    const record = asRecord(payload)
    throw upstreamError(
      response.status,
      optionalText(record?.message)
      ?? optionalText(record?.error)
      ?? optionalText(payload)
      ?? (response.statusText || `ChatBotKit 请求失败(HTTP ${response.status})`),
    )
  }
  return payload
}

/** 分页 query:`meta` 展开成 `meta[key]=value`(ChatBotKit 的元数据过滤约定)。 */
function listQuery(input: Json): Json {
  const meta = asRecord(input.meta) ?? {}
  return {
    take: input.take,
    cursor: input.cursor,
    order: input.order,
    ...Object.fromEntries(Object.entries(meta).map(([key, value]) => [`meta[${key}]`, value])),
  }
}

/** 去掉路径参数后把**其余入参整体**当 body 发(上游 `postWithout`)。 */
function postBody(input: Json, omit: readonly string[] = []): unknown {
  return compactJson(Object.fromEntries(
    Object.entries(input).filter(([key]) => !omit.includes(key)),
  ))
}

export async function fetchUsage(
  _input: z.infer<typeof fetchUsageInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, '/usage/fetch')
}

export async function listBots(
  input: z.infer<typeof listBotsInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, '/bot/list', { query: listQuery(input) })
}

export async function fetchBot(
  input: z.infer<typeof fetchBotInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, `/bot/${requirePathSegment(input.botId, 'botId')}/fetch`)
}

export async function createBot(
  input: z.infer<typeof createBotInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, '/bot/create', { method: 'POST', body: postBody(input) })
}

export async function updateBot(
  input: z.infer<typeof updateBotInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  const botId = requirePathSegment(input.botId, 'botId')
  return request(ctx, `/bot/${botId}/update`, { method: 'POST', body: postBody(input, ['botId']) })
}

export async function listConversations(
  input: z.infer<typeof listConversationsInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, '/conversation/list', { query: listQuery(input) })
}

export async function fetchConversation(
  input: z.infer<typeof fetchConversationInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  const id = requirePathSegment(input.conversationId, 'conversationId')
  return request(ctx, `/conversation/${id}/fetch`)
}

export async function createConversation(
  input: z.infer<typeof createConversationInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, '/conversation/create', { method: 'POST', body: postBody(input) })
}

export async function listConversationMessages(
  input: z.infer<typeof listConversationMessagesInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  const id = requirePathSegment(input.conversationId, 'conversationId')
  return request(ctx, `/conversation/${id}/message/list`, { query: listQuery(input) })
}

export async function createConversationMessage(
  input: z.infer<typeof createConversationMessageInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  const id = requirePathSegment(input.conversationId, 'conversationId')
  return request(ctx, `/conversation/${id}/message/create`, {
    method: 'POST',
    body: postBody(input, ['conversationId']),
  })
}

export async function completeConversation(
  input: z.infer<typeof completeConversationInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  const id = requirePathSegment(input.conversationId, 'conversationId')
  return request(ctx, `/conversation/${id}/complete`, {
    method: 'POST',
    body: postBody(input, ['conversationId']),
  })
}

export async function listDatasets(
  input: z.infer<typeof listDatasetsInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, '/dataset/list', { query: listQuery(input) })
}

export async function fetchDataset(
  input: z.infer<typeof fetchDatasetInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, `/dataset/${requirePathSegment(input.datasetId, 'datasetId')}/fetch`)
}

export async function createDataset(
  input: z.infer<typeof createDatasetInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, '/dataset/create', { method: 'POST', body: postBody(input) })
}

export async function updateDataset(
  input: z.infer<typeof updateDatasetInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  const datasetId = requirePathSegment(input.datasetId, 'datasetId')
  return request(ctx, `/dataset/${datasetId}/update`, {
    method: 'POST',
    body: postBody(input, ['datasetId']),
  })
}

export async function listDatasetRecords(
  input: z.infer<typeof listDatasetRecordsInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  const datasetId = requirePathSegment(input.datasetId, 'datasetId')
  return request(ctx, `/dataset/${datasetId}/record/list`, { query: listQuery(input) })
}

export async function createDatasetRecord(
  input: z.infer<typeof createDatasetRecordInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  const datasetId = requirePathSegment(input.datasetId, 'datasetId')
  return request(ctx, `/dataset/${datasetId}/record/create`, {
    method: 'POST',
    body: postBody(input, ['datasetId']),
  })
}

export async function searchDataset(
  input: z.infer<typeof searchDatasetInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  const datasetId = requirePathSegment(input.datasetId, 'datasetId')
  // effect 是 read,但上游端点是 POST(检索条件放 body)—— 不是笔误。
  return request(ctx, `/dataset/${datasetId}/search`, {
    method: 'POST',
    body: postBody(input, ['datasetId']),
  })
}

export async function listFiles(
  input: z.infer<typeof listFilesInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, '/file/list', { query: listQuery(input) })
}

export async function fetchFile(
  input: z.infer<typeof fetchFileInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, `/file/${requirePathSegment(input.fileId, 'fileId')}/fetch`)
}

export async function createFile(
  input: z.infer<typeof createFileInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, '/file/create', { method: 'POST', body: postBody(input) })
}

export async function uploadFile(
  input: z.infer<typeof uploadFileInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  const fileId = requirePathSegment(input.fileId, 'fileId')
  return request(ctx, `/file/${fileId}/upload`, {
    method: 'POST',
    body: postBody(input, ['fileId']),
  })
}

export async function downloadFile(
  input: z.infer<typeof downloadFileInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  // 这个端点回的是 JSON 描述(不是文件字节),故与其他 GET 一视同仁。
  return request(ctx, `/file/${requirePathSegment(input.fileId, 'fileId')}/download`)
}

export async function syncFile(
  input: z.infer<typeof syncFileInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  const fileId = requirePathSegment(input.fileId, 'fileId')
  return request(ctx, `/file/${fileId}/sync`, { method: 'POST', body: postBody(input, ['fileId']) })
}

export async function listDatasetFiles(
  input: z.infer<typeof listDatasetFilesInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  const datasetId = requirePathSegment(input.datasetId, 'datasetId')
  return request(ctx, `/dataset/${datasetId}/file/list`, { query: listQuery(input) })
}

export async function attachDatasetFile(
  input: z.infer<typeof attachDatasetFileInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  const datasetId = requirePathSegment(input.datasetId, 'datasetId')
  const fileId = requirePathSegment(input.fileId, 'fileId')
  return request(ctx, `/dataset/${datasetId}/file/${fileId}/attach`, {
    method: 'POST',
    body: postBody(input, ['datasetId', 'fileId']),
  })
}

export async function detachDatasetFile(
  input: z.infer<typeof detachDatasetFileInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  const datasetId = requirePathSegment(input.datasetId, 'datasetId')
  const fileId = requirePathSegment(input.fileId, 'fileId')
  return request(ctx, `/dataset/${datasetId}/file/${fileId}/detach`, {
    method: 'POST',
    body: postBody(input, ['datasetId', 'fileId']),
  })
}
