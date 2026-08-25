/**
 * Postmark 的业务逻辑(12 个 action:发信、模板、退信与出站消息检索)。
 *
 * 迁移自 open-connector `src/providers/postmark/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(走 `X-Postmark-Server-Token` 头,不是 Bearer),
 * 出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 三处上游细节决定了这里的形状:
 * - **ErrorCode 比 HTTP 状态准**。Postmark 把"令牌无效""模板不存在""账号不许发信"统统压在
 *   HTTP 422 上,真正的原因在 body 的 `ErrorCode` 里。只看状态的话,一个配错的 server token
 *   会呈现为"你的参数有问题",调用方永远找不到症结。故先查码表、再退回状态归一。
 * - **发信类 action 的请求体就是入参本身**(去掉 undefined 键)。schema 是 strictObject,
 *   多余的键在校验期就被拒了,故这里不需要再挑字段 —— 但 `edit_template` 例外:它的
 *   `templateIdOrAlias` 是**路径参数**,必须从 body 里摘掉,漏摘会被上游当成改别名的请求。
 * - **metadata 过滤器要摊平成 `metadata_<key>` 查询参数**,不是一个 JSON 对象。
 *
 * 没有分页 cursor:Postmark 用 count/offset,原样透传。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createTemplateInput,
  editTemplateInput,
  getBouncesInput,
  getOutboundMessageDetailsInput,
  getTemplateInput,
  listTemplatesInput,
  searchOutboundMessagesInput,
  sendBatchWithTemplatesInput,
  sendEmailInput,
  sendEmailWithTemplateInput,
  validateTemplateInput,
} from './schema'
import { compactDefined as compact, asJsonObject as record, trimmedText as text } from '../_runtime/jsonValue'
import { createProviderHttpClient, type ProviderQuery } from '../_runtime/providerHttp'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'postmark'
const API_BASE = 'https://api.postmarkapp.com'
const http = createProviderHttpClient({ baseUrl: API_BASE, service: SERVICE })

type Json = Record<string, unknown>
type QueryValue = boolean | number | string | undefined

/** 令牌不可用。Postmark 常以 HTTP 422 + 这个码回复,状态本身看不出是凭证问题。 */
const INVALID_TOKEN_CODE = 10
/** 上游归作"目标不存在"的一组码(消息 id / 模板 id 打不中)。 */
const NOT_FOUND_CODES = new Set([12, 701, 1001, 1101])
/**
 * 账号状态导致的拒发(待审核、被停用、不允许发送)。上游把这组归成 502「provider side」,
 * 那在本仓库的七码里是 `unavailable` + retryable —— 而"账号待审核"不会因为重试而改变,
 * agent 会对一个永远不变的结果反复打。故改归 permission_denied:非可重试,且说的正是
 * "这个账号不被允许做这件事"。这是与上游的**有意偏离**。
 */
const ACCOUNT_BLOCKED_CODES = new Set([405, 412, 413])

/** 上游回的形状不符合契约 —— 是上游的问题,不是调用方的错。 */
function responseError(message: string): TBError {
  return new TBError('unavailable', message, { retryable: true })
}

/**
 * 必填断言。上游 34.3% 的 action 没在声明里写 `required`,但 executor 里有断言;
 * schema.ts 忠实反映声明(optional),必填就落在这一层。
 */
function required(value: unknown, field: string): string {
  const result = text(value)
  if (result === undefined) throw new TBError('invalid_argument', `${field} 是必填的`)
  return result
}

/** 路径参数既收正整数模板 ID 也收字符串别名(上游 `stringifyPathValue`)。 */
function pathValue(value: unknown, field: string): string {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return String(value)
  return required(value, field)
}

/** Postmark 错误 → TBError。稳定的 ErrorCode 优先,拿不到码再按 HTTP 状态走公共归一表。 */
function postmarkError(status: number, payload: Json): TBError {
  const message = text(payload.Message) ?? `Postmark 返回 HTTP ${status}`
  const code = typeof payload.ErrorCode === 'number' ? payload.ErrorCode : undefined
  if (code !== undefined) {
    if (code === INVALID_TOKEN_CODE) return upstreamError(401, message)
    if (NOT_FOUND_CODES.has(code)) return upstreamError(404, message)
    if (ACCOUNT_BLOCKED_CODES.has(code)) return upstreamError(403, message)
  }
  return upstreamError(status, message)
}

interface RequestInput {
  body?: unknown
  method?: 'GET' | 'POST' | 'PUT'
  path: string
  query?: Record<string, QueryValue>
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  const { data } = await http.request({
    path: input.path,
    method: input.method ?? 'GET',
    query: Object.entries(input.query ?? {}) satisfies ProviderQuery,
    headers: {
      'accept': 'application/json',
      'x-postmark-server-token': requireApiKey(ctx, SERVICE),
    },
    ...(input.body === undefined ? {} : { json: input.body }),
    invalidJsonMessage: 'Postmark 返回了非 JSON 响应',
    mapError: ({ bodyKind, data: payload, status }) => postmarkError(
      status,
      bodyKind === 'json'
        ? record(payload) ?? {}
        : (bodyKind === 'empty' ? {} : { Message: payload }),
    ),
  })
  if (data === undefined) throw responseError('Postmark 返回了非 JSON 响应')
  return data
}

export function getServer(_input: unknown, ctx: ProviderContext): Promise<unknown> {
  return request(ctx, { path: '/server' })
}

export function sendEmail(input: z.infer<typeof sendEmailInput>, ctx: ProviderContext): Promise<unknown> {
  // 入参就是请求体:schema 是 strictObject,多余的键在校验期已被拒。
  return request(ctx, { path: '/email', method: 'POST', body: compact({ ...input }) })
}

export function sendEmailWithTemplate(
  input: z.infer<typeof sendEmailWithTemplateInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, { path: '/email/withTemplate', method: 'POST', body: compact({ ...input }) })
}

export function sendBatchWithTemplates(
  input: z.infer<typeof sendBatchWithTemplatesInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  // 只发 Messages 这一个键(上游如此);它在声明里是 optional,上游也没有必填断言。
  return request(ctx, { path: '/email/batchWithTemplates', method: 'POST', body: { Messages: input.Messages } })
}

export function searchOutboundMessages(
  input: z.infer<typeof searchOutboundMessagesInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  const metadata = input.metadata ?? {}
  return request(ctx, {
    path: '/messages/outbound',
    query: {
      ...compact({
        count: input.count,
        offset: input.offset,
        recipient: text(input.recipient),
        fromemail: text(input.fromemail),
        tag: text(input.tag),
        status: text(input.status),
        todate: text(input.todate),
        fromdate: text(input.fromdate),
        subject: text(input.subject),
        messagestream: text(input.messagestream),
      }),
      // metadata 过滤器摊平成 metadata_<key>=<value>;空值的键整个不发。
      ...Object.fromEntries(
        Object.entries(metadata).flatMap(([key, value]) => {
          const item = text(value)
          return item === undefined ? [] : [[`metadata_${key}`, item]]
        }),
      ),
    },
  })
}

export function getOutboundMessageDetails(
  input: z.infer<typeof getOutboundMessageDetailsInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  const messageId = required(input.messageId, 'messageId')
  return request(ctx, { path: `/messages/outbound/${encodeURIComponent(messageId)}/details` })
}

export function getBounces(input: z.infer<typeof getBouncesInput>, ctx: ProviderContext): Promise<unknown> {
  return request(ctx, {
    path: '/bounces',
    query: compact({
      count: input.count,
      offset: input.offset,
      type: text(input.type),
      // `inactive: false` 是一个有意义的筛选值,不能被当成"没给"丢掉。
      inactive: input.inactive,
      emailFilter: text(input.emailFilter),
      messageID: text(input.messageID),
      mailboxHash: text(input.mailboxHash),
      tag: text(input.tag),
      todate: text(input.todate),
      fromdate: text(input.fromdate),
    }),
  })
}

export function listTemplates(input: z.infer<typeof listTemplatesInput>, ctx: ProviderContext): Promise<unknown> {
  return request(ctx, {
    path: '/templates',
    query: compact({
      count: input.count,
      offset: input.offset,
      TemplateType: text(input.TemplateType),
      LayoutTemplate: text(input.LayoutTemplate),
    }),
  })
}

export function getTemplate(input: z.infer<typeof getTemplateInput>, ctx: ProviderContext): Promise<unknown> {
  const id = pathValue(input.templateIdOrAlias, 'templateIdOrAlias')
  return request(ctx, { path: `/templates/${encodeURIComponent(id)}` })
}

export function createTemplate(input: z.infer<typeof createTemplateInput>, ctx: ProviderContext): Promise<unknown> {
  return request(ctx, { path: '/templates', method: 'POST', body: compact({ ...input }) })
}

export function editTemplate(input: z.infer<typeof editTemplateInput>, ctx: ProviderContext): Promise<unknown> {
  const { templateIdOrAlias, ...rest } = input
  const id = pathValue(templateIdOrAlias, 'templateIdOrAlias')
  // templateIdOrAlias 是**路径**参数:留在 body 里会被上游读成"把别名改成这个值"。
  return request(ctx, { path: `/templates/${encodeURIComponent(id)}`, method: 'PUT', body: compact({ ...rest }) })
}

export function validateTemplate(
  input: z.infer<typeof validateTemplateInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, { path: '/templates/validate', method: 'POST', body: compact({ ...input }) })
}
