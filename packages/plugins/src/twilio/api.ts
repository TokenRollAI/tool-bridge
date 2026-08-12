/**
 * Twilio 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/twilio/runtime.ts`,语义等价、写法本地化:
 * 凭证经 `ctx.credentials` 取(多字段),出站走 `guardedFetch`,错误抛 `TBError` 七码。
 * 凭证走 `Authorization: Basic` 请求头,**不进 URL** —— 但注意 accountSid 会出现在
 * **路径段**里(Twilio 的 REST 设计就是 `/Accounts/{sid}/...`)。accountSid 不是密钥
 * (definition.ts 里 `secret: false`),authToken 才是,后者只在 Basic 头里。
 *
 * 凭证是**两个字段**(与上游 `definition.ts` 的 `auth[0].fields` 逐字一致):
 * `accountSid`(账户标识,进路径)与 `authToken`(进 Basic 的密码位)。
 *
 * 四处上游细节决定了这里的形状:
 * - **HTTP Basic 而非 Bearer**:`base64(accountSid + ':' + authToken)`。上游用 `node:buffer`
 *   做 base64,这里换成 `btoa` —— 插件要能在 Workers 里跑。
 * - **写操作的请求体是 form-encoded**(`application/x-www-form-urlencoded`),不是 JSON。
 *   Twilio 收到 JSON body 会当成空参数并报 21604「missing Body」,是个很难查的失败。
 * - **query 参数名是 PascalCase**(`To` / `From` / `PageSize` / `PageToken` / `Category` /
 *   `StartDate` / `EndDate`),而入参是 camelCase,两侧不能直接透传。
 * - 错误体带**稳定的数字业务码**(`code`,如 21211 号码非法),上游把它附在消息末尾的括号里;
 *   保留这个做法 —— 那个码是查 Twilio 文档的唯一线索,HTTP 状态本身区分不出来。
 *
 * 与上游的有意偏离:
 * - 上游 `optionalPositiveInteger(pageSize)` 的"必须为正整数"断言不再重复实现 ——
 *   `schema.ts` 的 `z.int().min(1)` 在入参校验期就拦下了,重复一遍只是死代码。
 * - 上游 2xx 上直接 `response.json()`,非 JSON 会抛裸错并冒成 `internal` 500;这里判形状后
 *   归成 `unavailable`(上游坏了,不是插件崩了)。
 * - 上游 `phase: 'validate'` 把 401 压成 400,那只服务于凭证校验流程;本层只有 execute 路径,
 *   401 照常归 `permission_denied`。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getMessageInput,
  listMessagesInput,
  listUsageRecordsInput,
  sendMessageInput,
} from './schema'
import { type ProviderContext, requireCredential } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'twilio'
const API_BASE = 'https://api.twilio.com/2010-04-01'

type Json = Record<string, unknown>
type QueryValue = number | string | undefined

/** 上游 `optionalString` 的等价物:去空白后仍非空才算有值。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

/**
 * 上游 `requiredString`:Zod 的 `min(1)` 拦不住纯空白串,而空白的 To/Body 打到 Twilio
 * 是一次必然失败的计费请求(send_message 尤其),故这层必须保留。
 */
function requireText(value: unknown, field: string): string {
  const result = text(value)
  if (result === undefined) throw new TBError('invalid_argument', `${field} is required.`)
  return result
}

/** 上游用 `node:buffer` 做 base64,这里换成 `btoa` —— 插件要能在 Workers 里跑。 */
function basicAuthHeader(ctx: ProviderContext): string {
  const accountSid = requireCredential(ctx, SERVICE, 'accountSid')
  const authToken = requireCredential(ctx, SERVICE, 'authToken')
  // authToken 理论上是 ASCII,但走 TextEncoder 再逐字节转,免得非 ASCII 的值让 btoa 直接抛。
  const bytes = new TextEncoder().encode(`${accountSid}:${authToken}`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

/**
 * Twilio 的错误文案:先 message、再 detail,末尾附上数字业务码。
 * 拿不到 JSON 就退回原文,原文也空则用状态兜底。
 */
function errorMessage(payload: unknown, raw: string, status: number): string {
  const body = record(payload)
  if (body === undefined) {
    const trimmed = raw.trim()
    return trimmed === '' ? `Twilio request failed with ${status}` : trimmed
  }
  const message = text(body.message) ?? text(body.detail) ?? `Twilio request failed with ${status}`
  const code = text(body.code) ?? integer(body.code)?.toString()
  return code === undefined ? message : `${message} (${code})`
}

interface RequestOptions {
  /** form-encoded 的请求体;给了它就走 POST 并带 content-type。 */
  form?: URLSearchParams
  path: string
  query?: Record<string, QueryValue>
}

async function request(ctx: ProviderContext, options: RequestOptions): Promise<unknown> {
  const url = new URL(`${API_BASE}${options.path}`)
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: basicAuthHeader(ctx),
  }
  if (options.form !== undefined) headers['content-type'] = 'application/x-www-form-urlencoded'

  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method: options.form === undefined ? 'GET' : 'POST',
      headers,
      ...(options.form === undefined ? {} : { body: options.form.toString() }),
    })
  } catch (error) {
    // guardedFetch 拦下的出站(EgressBlockedError)已经是 TBError,原样冒上去。
    if (error instanceof TBError) throw error
    throw upstreamError(
      502,
      error instanceof Error ? `Twilio request failed: ${error.message}` : 'Twilio request failed',
    )
  }

  const raw = await response.text().catch(() => '')
  let payload: unknown = null
  if (raw.trim() !== '') {
    try {
      payload = JSON.parse(raw) as unknown
    } catch {
      // 2xx 上回非 JSON 只能是上游坏了;错误响应上回 HTML 错误页却很常见,那时按 HTTP
      // 状态归一比报"响应不是 JSON"准得多。
      if (response.ok) throw new TBError('unavailable', 'Twilio 返回了非 JSON 响应', { retryable: true })
    }
  }

  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, raw, response.status))
  return payload
}

/** accountSid 缺失时 `requireCredential` 会抛,故这里拿到的一定是非空串。 */
function accountPath(ctx: ProviderContext, suffix: string): string {
  const accountSid = requireCredential(ctx, SERVICE, 'accountSid')
  return `/Accounts/${encodeURIComponent(accountSid)}${suffix}`
}

/**
 * 出参整形照搬上游:字段缺失时 sid 类字段兜底成空串(出参 schema 里它们不可为 null),
 * 其余兜底成 `null`。
 *
 * 注意 `count` / `usage` / `price` 走的是 **`optionalString`**:Twilio 这几个字段确实回字符串,
 * 但真回了数字就会被整形成 `null` 而不是转成串 —— 这是上游的口径,出参 schema
 * (`z.string().nullable()`)也是照它声明的,故照搬不改。
 */
function normalizeAccount(payload: unknown): Json {
  const account = record(payload) ?? {}
  return {
    accountSid: text(account.sid) ?? '',
    friendlyName: text(account.friendly_name) ?? null,
    status: text(account.status) ?? null,
    type: text(account.type) ?? null,
  }
}

function normalizeUsageRecord(value: unknown): Json {
  const usage = record(value) ?? {}
  return {
    accountSid: text(usage.account_sid) ?? null,
    category: text(usage.category) ?? null,
    count: text(usage.count) ?? null,
    countUnit: text(usage.count_unit) ?? null,
    usage: text(usage.usage) ?? null,
    usageUnit: text(usage.usage_unit) ?? null,
    price: text(usage.price) ?? null,
    priceUnit: text(usage.price_unit) ?? null,
    startDate: text(usage.start_date) ?? null,
    endDate: text(usage.end_date) ?? null,
  }
}

function normalizeMessage(payload: unknown): Json {
  const message = record(payload) ?? {}
  return {
    messageSid: text(message.sid) ?? '',
    accountSid: text(message.account_sid) ?? null,
    status: text(message.status) ?? null,
    to: text(message.to) ?? null,
    from: text(message.from) ?? null,
    body: text(message.body) ?? null,
  }
}

/** 上游对缺失/非数组的列表一律兜底成空数组,不报错。 */
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export async function getAccount(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return normalizeAccount(await request(ctx, { path: accountPath(ctx, '.json') }))
}

export async function listUsageRecords(
  input: z.infer<typeof listUsageRecordsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = record(await request(ctx, {
    path: accountPath(ctx, '/Usage/Records.json'),
    query: {
      Category: text(input.category),
      StartDate: text(input.startDate),
      EndDate: text(input.endDate),
      PageSize: input.pageSize,
    },
  })) ?? {}

  return {
    usageRecords: list(payload.usage_records).map(item => normalizeUsageRecord(item)),
    page: integer(payload.page) ?? null,
    pageSize: integer(payload.page_size) ?? null,
    nextPageUri: text(payload.next_page_uri) ?? null,
  }
}

export async function listMessages(
  input: z.infer<typeof listMessagesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = record(await request(ctx, {
    path: accountPath(ctx, '/Messages.json'),
    query: {
      To: text(input.to),
      From: text(input.from),
      PageSize: input.pageSize,
      PageToken: text(input.pageToken),
    },
  })) ?? {}

  return {
    messages: list(payload.messages).map(item => normalizeMessage(item)),
    nextPageUri: text(payload.next_page_uri) ?? null,
  }
}

export async function getMessage(
  input: z.infer<typeof getMessageInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const messageSid = requireText(input.messageSid, 'messageSid')
  return normalizeMessage(await request(ctx, {
    path: accountPath(ctx, `/Messages/${encodeURIComponent(messageSid)}.json`),
  }))
}

export async function sendMessage(
  input: z.infer<typeof sendMessageInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 三个字段都在拼 body 前先校验,免得半途才失败(Twilio 侧不会有半成品,但错误消息更准)。
  const form = new URLSearchParams()
  form.append('To', requireText(input.to, 'to'))
  form.append('From', requireText(input.from, 'from'))
  form.append('Body', requireText(input.body, 'body'))
  return normalizeMessage(await request(ctx, {
    path: accountPath(ctx, '/Messages.json'),
    form,
  }))
}
