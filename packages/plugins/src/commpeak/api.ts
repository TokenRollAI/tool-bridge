/**
 * CommPeak (TextPeak) 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/commpeak/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * CommPeak 的几个特点决定了这里的形状:
 * - **凭证是 `Authorization` 头的裸值**,没有 `Bearer ` 前缀。
 * - **两级凭证**:API key 只能打管理类端点;发消息要先用 API key 换取该 stream 的
 *   短期 token(`GET /streams/{id}/token`),再拿它当 Authorization 去 POST。
 *   `send_sms` 因此是**两跳**请求。
 * - **失败可以 HTTP 200 + `{status:false}` 返回**,状态码不足以判成败。
 * - 上游对每个响应做了 camelCase 归一 + `raw` 全量保留,outputSchema 按归一后的形状生成,
 *   故这些 `normalizeXxx` 必须照搬(`nullable` 而非 `optional`:缺失一律落成 null)。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getStreamInput,
  getStreamTokenInput,
  listDomainsInput,
  listIncomingMessagesInput,
  listMessagesInput,
  listSendersInput,
  listStreamsInput,
  sendSmsInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'commpeak'
const API_BASE = 'https://gw.commpeak.com/textpeak'
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024

type Json = Record<string, unknown>

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 上游 `optionalString`:trim 后非空才算有值。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 归一形状里所有可空字段的口径:取不到就是 null,不是 undefined。 */
function nullableText(value: unknown): string | null {
  return text(value) ?? null
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** 归一化的前提是拿到对象;拿不到说明上游契约破了。 */
function requireObject(value: unknown): Json {
  const body = record(value)
  if (body === undefined) throw upstreamError(502, 'CommPeak response must be an object')
  return body
}

/**
 * 边读边计数,超限立刻断流 —— 先 `text()` 再判大小等于把上限交给对端决定,
 * 一个谎报 content-length 的响应就能让插件把内存吃干。
 */
async function readBoundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isSafeInteger(declared) && declared > MAX_RESPONSE_BYTES) {
    throw upstreamError(502, `CommPeak 响应超过 ${MAX_RESPONSE_BYTES} 字节上限`)
  }
  if (response.body === null) return response.text()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw upstreamError(502, `CommPeak 响应超过 ${MAX_RESPONSE_BYTES} 字节上限`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function errorMessage(payload: unknown, response: Response): string {
  if (typeof payload === 'string' && payload.trim() !== '') return payload
  const body = record(payload)
  if (body !== undefined) {
    const found = text(body.message) ?? text(body.error) ?? text(body.detail) ?? text(body.title)
    if (found !== undefined) return found
  }
  return text(response.statusText) ?? 'CommPeak request failed'
}

interface RequestInput {
  body?: Json
  method?: 'GET' | 'POST'
  path: string
  query?: Record<string, number | string | undefined>
  /** Authorization 头的裸值:管理端点用 API key,消息端点用 stream token。 */
  token: string
}

async function request(input: RequestInput): Promise<unknown> {
  const url = new URL(`${API_BASE}${input.path}`)
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    // 裸值,不加 Bearer 前缀 —— CommPeak 就是这么收的。
    authorization: input.token,
  }
  if (input.body !== undefined) headers['content-type'] = 'application/json'

  let response: Response
  let payload: unknown = null
  try {
    response = await guardedFetch(url.toString(), {
      method: input.method ?? 'GET',
      headers,
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    })
    const raw = await readBoundedText(response)
    if (raw.trim() !== '') {
      try {
        payload = JSON.parse(raw)
      } catch {
        // 错误体常是纯文本;留给消息提取。
        payload = raw
      }
    }
  } catch (error) {
    if (error instanceof TBError) throw error
    const message = error instanceof Error ? `CommPeak request failed: ${error.message}` : 'CommPeak request failed'
    throw upstreamError(502, message)
  }

  // `{status:false}` 是 CommPeak 表达失败的第二条路径,HTTP 状态可能仍是 200。
  const failed = !response.ok || record(payload)?.status === false
  if (failed) throw upstreamError(response.ok ? 502 : response.status, errorMessage(payload, response))
  return payload
}

function getJson(ctx: ProviderContext, path: string, query?: Record<string, number | string | undefined>) {
  return request({ path, token: requireApiKey(ctx, SERVICE), query })
}

/** 列表端点的分页参数名与其他端点不同:页码是 `_page` 而非 `page`。 */
function listQuery(input: { itemsPerPage?: number, page?: number }): Record<string, number | undefined> {
  return { _page: input.page, itemsPerPage: input.itemsPerPage }
}

function normalizeStreamTag(value: unknown): Json {
  const item = requireObject(value)
  return { id: nullableNumber(item.id), value: nullableText(item.value) }
}

function normalizeStream(value: unknown): Json {
  const item = requireObject(value)
  return {
    id: nullableNumber(item.id),
    streamUid: nullableText(item.streamUid),
    name: nullableText(item.name),
    description: nullableText(item.description),
    type: nullableText(item.type),
    callerId: nullableText(item.callerId),
    ipAcl: nullableText(item.ipAcl),
    state: nullableText(item.state),
    streamTags: array(item.streamTags).map(normalizeStreamTag),
    raw: item,
  }
}

function normalizeSender(value: unknown): Json {
  const item = requireObject(value)
  return {
    id: nullableNumber(item.id),
    name: nullableText(item.name),
    value: nullableText(item.value),
    dailyLimit: nullableNumber(item.dailyLimit),
    stream: nullableText(item.stream),
    senderType: nullableText(item.senderType),
    status: nullableText(item.status),
    raw: item,
  }
}

function normalizeDomain(value: unknown): Json {
  const item = requireObject(value)
  return {
    id: nullableNumber(item.id),
    name: nullableText(item.name),
    ip: nullableText(item.ip),
    status: nullableText(item.status),
    raw: item,
  }
}

function normalizeOutgoingMessage(value: unknown): Json {
  const item = requireObject(value)
  const content = record(item.content)
  return {
    type: nullableText(item.type),
    messageUuid: nullableText(item.message_uuid),
    externalKey: nullableText(item.external_key),
    sentAt: nullableText(item.sent_at),
    deliveredAt: nullableText(item.delivered_at),
    status: nullableText(item.status),
    sourceNumber: nullableText(item.source_number),
    sourceName: nullableText(item.source_name),
    destinationNumber: nullableText(item.destination_number),
    countryCode: nullableText(item.country_code),
    countryIso: nullableText(item.country_iso),
    countryName: nullableText(item.country_name),
    cost: nullableNumber(item.cost),
    channel: nullableText(item.channel),
    content: content === undefined
      ? null
      : { type: nullableText(content.type), text: nullableText(content.text) },
    conversationUuid: nullableText(item.conversation_uuid),
    streamId: nullableText(item.stream_id),
    campaignId: nullableText(item.campaign_id),
    raw: item,
  }
}

function normalizeIncomingMessage(value: unknown): Json {
  const item = requireObject(value)
  return {
    messageUuid: nullableText(item.message_uuid),
    receivedAt: nullableText(item.received_at),
    sourceNumber: nullableText(item.source_number),
    destinationNumber: nullableText(item.destination_number),
    contactName: nullableText(item.contact_name),
    countryCode: nullableText(item.country_code),
    countryIso: nullableText(item.country_iso),
    countryName: nullableText(item.country_name),
    text: nullableText(item.text),
    length: nullableNumber(item.length),
    conversationUuid: nullableText(item.conversation_uuid),
    streamId: nullableText(item.stream_id),
    raw: item,
  }
}

function normalizeSendResult(value: unknown): Json {
  const item = requireObject(value)
  return {
    internalId: nullableText(item.internal_id),
    messageUuid: nullableText(item.message_uuid),
    conversationUuid: nullableText(item.conversation_uuid),
    error: nullableText(item.error),
    details: nullableText(item.details),
    raw: item,
  }
}

/** 分页信封:总数键名上游给过三种写法,依次尝试。 */
function readPage(payload: unknown): { items: unknown[], totalItems: number | null } {
  const body = record(payload)
  return {
    items: array(body?.items),
    totalItems: nullableNumber(body?.totalItems ?? body?.total_items ?? body?.total),
  }
}

/** 拿 API key 换该 stream 的短期 token;消息端点只认它。 */
async function streamToken(streamId: number, ctx: ProviderContext): Promise<string> {
  const payload = await getJson(ctx, `/streams/${streamId}/token`)
  const token = text(requireObject(payload).token)
  if (token === undefined) throw upstreamError(502, 'CommPeak did not return a stream token')
  return token
}

export async function listStreams(
  input: z.infer<typeof listStreamsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await getJson(ctx, '/streams', listQuery(input))
  return { streams: array(payload).map(normalizeStream) }
}

export async function getStream(
  input: z.infer<typeof getStreamInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await getJson(ctx, `/streams/${input.streamId}`)
  return { stream: normalizeStream(requireObject(payload)) }
}

export async function getStreamToken(
  input: z.infer<typeof getStreamTokenInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return { token: await streamToken(input.streamId, ctx) }
}

export async function listSenders(
  input: z.infer<typeof listSendersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await getJson(ctx, '/senders', listQuery(input))
  return { senders: array(payload).map(normalizeSender) }
}

export async function listDomains(
  input: z.infer<typeof listDomainsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await getJson(ctx, '/domains', listQuery(input))
  return { domains: array(payload).map(normalizeDomain) }
}

export async function listMessages(
  input: z.infer<typeof listMessagesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await getJson(ctx, '/streams/messages', {
    type: input.type,
    status: input.status,
    streamId: input.streamId,
    phone: input.phone,
    startDate: input.startDate,
    endDate: input.endDate,
    page: input.page,
    itemsPerPage: input.itemsPerPage,
  })
  const page = readPage(payload)
  return {
    items: page.items.map(normalizeOutgoingMessage),
    page: { totalItems: page.totalItems, raw: record(payload) ?? {} },
  }
}

export async function listIncomingMessages(
  input: z.infer<typeof listIncomingMessagesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await getJson(ctx, '/streams/incoming_messages', {
    streamId: input.streamId,
    sender: input.sender,
    destination: input.destination,
    startDate: input.startDate,
    endDate: input.endDate,
    page: input.page,
    itemsPerPage: input.itemsPerPage,
  })
  const page = readPage(payload)
  return {
    items: page.items.map(normalizeIncomingMessage),
    page: { totalItems: page.totalItems, raw: record(payload) ?? {} },
  }
}

export async function sendSms(
  input: z.infer<typeof sendSmsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 入参是 camelCase,TextPeak 的 body 是 snake_case。
  const messages = input.messages.map(message => ({
    ...(message.internalId === undefined ? {} : { internal_id: message.internalId }),
    ...(message.sender === undefined ? {} : { sender: message.sender }),
    recipient_phone: message.recipientPhone,
    message_content: message.messageContent,
  }))
  // "顶层 sender 与逐条 sender 至少有一个"是 schema 表达不了的条件必填。
  if (input.sender === undefined && messages.some(message => message.sender === undefined)) {
    throw new TBError('invalid_argument', 'sender is required on every message when top-level sender is omitted')
  }

  const token = await streamToken(input.streamId, ctx)
  const payload = await request({
    path: '/streams/simple_send',
    method: 'POST',
    token,
    body: {
      ...(input.sender === undefined ? {} : { sender: input.sender }),
      messages,
    },
  })
  const body = requireObject(payload)

  return {
    status: body.status === true,
    taskId: nullableText(body.task_id),
    messages: array(body.messages).map(normalizeSendResult),
    raw: body,
  }
}
