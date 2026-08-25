/**
 * Telnyx 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/telnyx/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 与上游有意偏离的两处:
 * - **错误映射交给共用的 `upstreamError`**。上游把 404/409/422 一律压成 400,抹平了
 *   "资源不存在"与"参数不合法"之别;共用映射把它们分别归到 not_found / conflict。
 * - **不迁 validate 阶段**。上游用 phase 区分凭证校验与正常调用(校验时把 401/403 降成
 *   400,好让"key 不对"表现为用户填错而非无权),本仓的凭证校验是平台的事,这里只留
 *   execute 口径。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  listMessagingProfilesInput,
  retrieveMessageInput,
  retrieveMessagingProfileInput,
  sendMessageInput,
} from './schema'
import { trimmedText as text, asJsonObject as toRecord } from '../_runtime/jsonValue'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { createProviderHttpClient } from '../_runtime/providerHttp'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'telnyx'
const API_BASE = 'https://api.telnyx.com/v2'
const http = createProviderHttpClient({ baseUrl: `${API_BASE}/`, service: SERVICE })

type Json = Record<string, unknown>

/**
 * Telnyx 的错误体是 JSON:API 风格的 `{errors:[{code,detail,title}]}`,但边缘层(网关、
 * 限流)会回扁平的 `{message}`/`{detail}` 甚至纯文本,故两种形状都认。
 */
function errorMessage(payload: unknown, status: number, statusText: string): string {
  if (typeof payload === 'string' && payload.trim() !== '') return payload

  const record = toRecord(payload)
  const errors = Array.isArray(record?.errors) ? record.errors : []
  const first = errors.map(toRecord).find(Boolean)
  const message = first === undefined
    ? text(record?.detail) ?? text(record?.message) ?? text(record?.error) ?? text(record?.title)
    : text(first.detail) ?? text(first.title) ?? text(first.code)

  // 上游这里退回 `response.statusText`,而 statusText 允许是空串 ——
  // `??` 接不住它,消息就成了空。用 `||` 保证调用方至少拿到状态码。
  return message ?? (statusText || `Telnyx 返回 HTTP ${status}`)
}

interface RequestInput {
  body?: Json
  method?: 'GET' | 'POST'
  /** 用数组而非对象:Telnyx 的筛选键是 `filter[name][eq]` 这种嵌套字面量,不是嵌套对象。 */
  query?: Array<[string, boolean | number | string | null | undefined]>
}

async function request(ctx: ProviderContext, path: string, input: RequestInput = {}): Promise<Json> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
  }
  const response = await http.request({
    method: input.method ?? 'GET',
    path,
    // 空串不进 query:Telnyx 会把 `filter[name]=` 读成"匹配空名字",而调用方省略一个
    // 可选筛选时想要的是"不筛选"。
    query: (input.query ?? []).filter(([, value]) => value !== undefined && value !== null && value !== ''),
    headers,
    // JSON.stringify 自己会丢掉值为 undefined 的键,故不必复制上游的 removeUndefined;
    // 但 null 必须留住 —— schema 允许 sendAt 显式传 null,那是要发给 Telnyx 的值。
    ...(input.body === undefined ? {} : { json: input.body }),
    invalidJsonMessage: 'Telnyx 返回了非 JSON 响应',
    mapError: ({ bodyKind, data, status, statusText }) => bodyKind === 'invalid-json'
      ? upstreamError(status === 429 ? 429 : 502, 'Telnyx 返回了非 JSON 响应')
      : upstreamError(status, errorMessage(bodyKind === 'empty' ? null : data, status, statusText)),
    mapTransportError: ({ message }) => upstreamError(
      502,
      message === undefined ? 'telnyx request failed' : `telnyx request failed: ${message}`,
    ),
  })
  const record = toRecord(response.bodyKind === 'empty' ? null : response.data)
  if (record === undefined) {
    // 契约说好是 `{data:...}`;不是就是上游出问题,不是调用方的错。
    throw upstreamError(502, 'Telnyx 的成功响应不是一个对象')
  }
  return record
}

export async function sendMessage(
  input: z.infer<typeof sendMessageInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 以下四条是跨字段约束,Zod schema 表达不了;Telnyx 服务端也会拒,但错误信息含糊。
  if (input.from === undefined && input.messagingProfileId === undefined) {
    throw new TBError('invalid_argument', 'send_message 需要 from 或 messagingProfileId')
  }
  if (input.type === 'SMS' && input.text === undefined) {
    throw new TBError('invalid_argument', 'type 为 SMS 时需要 text')
  }
  if (input.type === 'MMS' && input.mediaUrls === undefined) {
    throw new TBError('invalid_argument', 'type 为 MMS 时需要 mediaUrls')
  }
  if (input.type === undefined && input.text === undefined && input.mediaUrls === undefined) {
    throw new TBError('invalid_argument', 'send_message 需要 text 或 mediaUrls')
  }

  return request(ctx, '/messages', {
    method: 'POST',
    body: {
      // 上游对每个字符串字段都过一遍 optionalString(即 trim)再发。这里只对自由文本
      // 字段保留 trim —— 其余字段的 schema(uuid / url / datetime)要么本就不接受带空白的
      // 值,要么 Zod 已经替我们 trim 过,再调一次是死代码。
      // 这几个字段 schema 都要求 `\S`,故 trim 后不会变成空。
      to: input.to.trim(),
      from: input.from?.trim(),
      messaging_profile_id: input.messagingProfileId,
      text: input.text?.trim(),
      subject: input.subject?.trim(),
      media_urls: input.mediaUrls,
      webhook_url: input.webhookUrl,
      webhook_failover_url: input.webhookFailoverUrl,
      use_profile_webhooks: input.useProfileWebhooks,
      type: input.type,
      auto_detect: input.autoDetect,
      // null 与 undefined 在这里语义不同:null 是"清掉排期,立刻发",要原样发给 Telnyx;
      // undefined 是没给,由 JSON.stringify 丢掉整个键。
      send_at: input.sendAt,
      encoding: input.encoding,
    },
  })
}

export async function retrieveMessage(
  input: z.infer<typeof retrieveMessageInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, `/messages/${encodeURIComponent(input.id)}`)
}

export async function listMessagingProfiles(
  input: z.infer<typeof listMessagingProfilesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, '/messaging_profiles', {
    query: [
      ['filter[name]', input.filterName],
      ['filter[name][eq]', input.filterNameEq],
      ['filter[name][contains]', input.filterNameContains],
      ['page[number]', input.pageNumber],
      ['page[size]', input.pageSize],
    ],
  })
}

export async function retrieveMessagingProfile(
  input: z.infer<typeof retrieveMessagingProfileInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, `/messaging_profiles/${encodeURIComponent(input.id)}`)
}
