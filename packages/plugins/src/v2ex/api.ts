/**
 * V2EX 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/v2ex/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 * 凭证走 `Authorization: Bearer` 请求头,不进 URL。
 *
 * 四处上游细节决定了这里的形状:
 * - **两套 API 并存**。11 个 action 打 API 2.0(`/api/v2`,带 Bearer、响应是
 *   `{success, message, result}` 信封);`list_hot_topics` / `list_latest_topics` 打的是
 *   **legacy API**(`/api/topics/*.json`),它**不带任何凭证头**、响应是**裸数组**没有信封。
 *   把 Bearer 加到 legacy 上不会失败但没有意义,把信封拆解套到 legacy 上会直接报错。
 * - **信封是错误的主要载体**:`success: false` 可以带 HTTP 200 回来,当成功返回就把一次
 *   失败悄悄变成了空结果;`result` 键缺席也要拦(否则整形函数拿到 undefined 静默出空)。
 * - **总数藏在 `message` 里**:通知列表的总数不在 `result` 上,而在形如 `"1/20"` 的
 *   `message` 字符串里 —— 取斜杠后面那段。取不到才退回 `result.length`(那只是本页条数)。
 * - **`duration` 是 query 参数**,不是请求体:`set-sticky` 是个 POST 但 body 为空。
 *
 * 与上游的有意偏离:
 * - 信封错误(`success:false`)上游归 502(= 可重试的 `unavailable`);这里归
 *   **`invalid_argument`**。信封里的 `success:false` 是 V2EX 在业务层拒绝了**这一个**请求
 *   (节点不存在、不是自己的主题、token 作用域不够),同一个请求重试多少次结果都一样,
 *   标成可重试只会让 agent 空转。传输层与形状层的故障仍归 `unavailable` + retryable。
 * - 上游 `phase: 'validate'` 那套把 401/403 压成 400 的分支只服务凭证校验流程,不迁。
 * - 不发 `user-agent`(上游报自己的 UA;本仓库的迁移产物统一不自报)。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  boostTopicInput,
  createTokenInput,
  deleteNotificationInput,
  getNodeInput,
  getTopicInput,
  listNodeTopicsInput,
  listNotificationsInput,
  listTopicRepliesInput,
  setTopicStickyInput,
} from './schema'
import {
  createProviderHttpClient,
  type ProviderHttpClient,
  type ProviderHttpRequest,
} from '../_runtime/providerHttp'
import { asJsonObject as record, trimmedText as text } from '../_runtime/jsonValue'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'v2ex'
const API_BASE = 'https://www.v2ex.com/api/v2'
/** legacy API 是另一条不带凭证、不带信封的路径。 */
const LEGACY_API_BASE = 'https://www.v2ex.com/api'
/** 照搬上游的 30s 单请求上限。 */
const REQUEST_TIMEOUT_MS = 30_000
const v2Http = createProviderHttpClient({ baseUrl: `${API_BASE}/`, service: SERVICE })
const legacyHttp = createProviderHttpClient({ baseUrl: `${LEGACY_API_BASE}/`, service: SERVICE })

type Json = Record<string, unknown>

/** 上游回的形状不符合契约 —— 是上游的问题,不是调用方的错。 */
function invalidResponse(message: string): TBError {
  return new TBError('unavailable', message, { retryable: true })
}

function requireRecord(value: unknown, label: string): Json {
  const result = record(value)
  if (result === undefined) throw invalidResponse(`${label} must be an object`)
  return result
}

/** 信封里 `message` / `error` / `errors[].detail` 依次找一条能给人看的文案。 */
function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') return text(payload)
  const body = record(payload)
  if (body === undefined) return undefined
  const direct = text(body.message) ?? text(body.error)
  if (direct !== undefined) return direct
  if (Array.isArray(body.errors)) {
    for (const item of body.errors) {
      const detail = text(record(item)?.detail) ?? text(record(item)?.message)
      if (detail !== undefined) return detail
    }
  }
  return undefined
}

/**
 * 信封说 `success: false`。归 `invalid_argument` 而不是上游的 502 —— 见文件顶部的偏离说明。
 */
function envelopeError(payload: unknown): TBError {
  return new TBError('invalid_argument', errorMessage(payload) ?? 'V2EX request failed')
}

interface RequestOptions {
  /** JSON 请求体;给了它就带 content-type。 */
  body?: Json
  method: 'DELETE' | 'GET' | 'POST'
  path: string
  query?: Record<string, number | string | undefined>
}

async function send(client: ProviderHttpClient, request: ProviderHttpRequest, label: string): Promise<unknown> {
  const response = await client.request({
    ...request,
    timeoutMs: REQUEST_TIMEOUT_MS,
    invalidJson: 'text',
    mapError: ({ data, status }) => upstreamError(status, errorMessage(data) ?? 'V2EX request failed'),
    mapTransportError: ({ kind, message }) => kind === 'timeout'
      ? upstreamError(504, `${label} request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds`)
      : upstreamError(502, message === undefined ? `${label} request failed` : `${label} request failed: ${message}`),
  })
  return response.bodyKind === 'empty' ? null : response.data
}

/** 打一次 API 2.0。凭证走 Bearer 头。 */
async function request(ctx: ProviderContext, options: RequestOptions): Promise<unknown> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
  }
  return send(v2Http, {
    method: options.method,
    path: options.path,
    // 上游连**空串**也当作"没给",不只是 undefined/null。
    query: Object.entries(options.query ?? {}).filter(([, value]) => value !== undefined && value !== ''),
    headers,
    ...(options.body === undefined ? {} : { json: options.body }),
  }, `V2EX ${options.path}`)
}

/**
 * 打一次 legacy API。**不带 Authorization** —— 上游这条路径压根不调 `buildV2exHeaders`,
 * 加上 Bearer 也没用。
 *
 * 但仍然先 `requireApiKey`:上游整个 provider 的 authType 是 `api_key`,没配凭证时
 * 连 context 都建不起来,这两个 action 一样调不通。这里保留那道闸 —— 否则"配了才能用"
 * 会因为迁移悄悄变成"这两个不用配",挂载语义就不一致了。
 */
async function legacyRequest(ctx: ProviderContext, path: string): Promise<unknown[]> {
  requireApiKey(ctx, SERVICE)
  const payload = await send(
    legacyHttp,
    { method: 'GET', path, headers: { accept: 'application/json' } },
    `V2EX legacy ${path}`,
  )
  // legacy 响应是裸数组,没有信封。
  if (!Array.isArray(payload)) {
    throw invalidResponse(`V2EX legacy ${path} response must be an array`)
  }
  return payload
}

interface Envelope {
  message: string | undefined
  result: unknown
}

/** 拆 `{success, message, result}` 信封。`success:false` 与 `result` 缺席都要拦。 */
function unwrapEnvelope(payload: unknown, label: string): Envelope {
  const envelope = requireRecord(payload, `V2EX ${label} response`)
  if (envelope.success === false) throw envelopeError(envelope)
  if (!('result' in envelope)) {
    throw invalidResponse(`V2EX ${label} response missing result`)
  }
  return { message: text(envelope.message), result: envelope.result }
}

/**
 * 只关心"被接受了没有"的那几个 action(delete / sticky / boost)。
 * 空响应体算接受(V2EX 的 DELETE 就不回体);既不是 true 也不是 false 则形状不对。
 */
function ensureAccepted(payload: unknown, label: string): void {
  if (payload === null) return
  const envelope = requireRecord(payload, `V2EX ${label} response`)
  if (envelope.success === false) throw envelopeError(envelope)
  if (envelope.success === true) return
  throw invalidResponse(`V2EX ${label} response missing success=true`)
}

function objectResult(envelope: Envelope, label: string): Json {
  return requireRecord(envelope.result, `V2EX ${label} result`)
}

function arrayResult(envelope: Envelope, label: string): unknown[] {
  if (!Array.isArray(envelope.result)) {
    throw invalidResponse(`V2EX ${label} result must be an array`)
  }
  return envelope.result
}

/**
 * 总数在 `message` 里,形如 `"1/20"` —— 取斜杠后面那段。
 * 拿不到就退回本页条数(上游口径;它只是个下界,不是真的总数)。
 */
function parseTotal(message: string | undefined, result: unknown): number {
  if (message !== undefined) {
    const slashIndex = message.indexOf('/')
    if (slashIndex >= 0) {
      const parsed = Number.parseInt(message.slice(slashIndex + 1), 10)
      if (Number.isInteger(parsed) && parsed >= 0) return parsed
    }
  }
  return Array.isArray(result) ? result.length : 0
}

export async function listNotifications(
  input: z.infer<typeof listNotificationsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const envelope = unwrapEnvelope(
    await request(ctx, { method: 'GET', path: '/notifications', query: { p: input.p } }),
    'notifications',
  )
  return {
    notifications: arrayResult(envelope, 'notifications'),
    total: parseTotal(envelope.message, envelope.result),
  }
}

export async function deleteNotification(
  input: z.infer<typeof deleteNotificationInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    method: 'DELETE',
    path: `/notifications/${input.notification_id}`,
  })
  ensureAccepted(payload, 'notification deletion')
  return { success: true }
}

export async function listHotTopics(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return { topics: await legacyRequest(ctx, '/topics/hot.json') }
}

export async function listLatestTopics(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return { topics: await legacyRequest(ctx, '/topics/latest.json') }
}

export async function getCurrentMember(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const envelope = unwrapEnvelope(await request(ctx, { method: 'GET', path: '/member' }), 'member')
  return { member: objectResult(envelope, 'member') }
}

export async function getCurrentToken(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const envelope = unwrapEnvelope(await request(ctx, { method: 'GET', path: '/token' }), 'token')
  return { token: objectResult(envelope, 'token') }
}

export async function createToken(
  input: z.infer<typeof createTokenInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const envelope = unwrapEnvelope(
    await request(ctx, {
      method: 'POST',
      path: '/tokens',
      body: { scope: input.scope, expiration: input.expiration },
    }),
    'token creation',
  )
  const token = text(objectResult(envelope, 'token creation').token)
  if (token === undefined) {
    // 新 token 的值只有这一次能拿到;信封说成功却没带上它,只能算上游坏了。
    throw invalidResponse('V2EX token creation response missing token')
  }
  return { token }
}

export async function getNode(
  input: z.infer<typeof getNodeInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const envelope = unwrapEnvelope(
    await request(ctx, { method: 'GET', path: `/nodes/${encodeURIComponent(input.node_name)}` }),
    'node',
  )
  return { node: objectResult(envelope, 'node') }
}

export async function listNodeTopics(
  input: z.infer<typeof listNodeTopicsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const envelope = unwrapEnvelope(
    await request(ctx, {
      method: 'GET',
      path: `/nodes/${encodeURIComponent(input.node_name)}/topics`,
      query: { p: input.p },
    }),
    'topics',
  )
  return { topics: arrayResult(envelope, 'topics') }
}

export async function getTopic(
  input: z.infer<typeof getTopicInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const envelope = unwrapEnvelope(
    await request(ctx, { method: 'GET', path: `/topics/${input.topic_id}` }),
    'topic',
  )
  return { topic: objectResult(envelope, 'topic') }
}

export async function listTopicReplies(
  input: z.infer<typeof listTopicRepliesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const envelope = unwrapEnvelope(
    await request(ctx, {
      method: 'GET',
      path: `/topics/${input.topic_id}/replies`,
      query: { p: input.p },
    }),
    'replies',
  )
  return { replies: arrayResult(envelope, 'replies') }
}

export async function setTopicSticky(
  input: z.infer<typeof setTopicStickyInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // duration 走 query,不是请求体 —— 这个 POST 的 body 是空的。
  const payload = await request(ctx, {
    method: 'POST',
    path: `/topics/${input.topic_id}/set-sticky`,
    query: { duration: input.duration },
  })
  ensureAccepted(payload, 'topic sticky')
  return { success: true }
}

export async function boostTopic(
  input: z.infer<typeof boostTopicInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, { method: 'POST', path: `/topics/${input.topic_id}/boost` })
  ensureAccepted(payload, 'topic boost')
  return { success: true }
}
