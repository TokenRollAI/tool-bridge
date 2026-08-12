/**
 * Cloudflare DNS 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/cloudflare_dns/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 凭证走 **`authorization: Bearer <API token>` 请求头**,不进 URL。
 *
 * 四处上游细节决定了这里的形状:
 * - Cloudflare 的响应是**信封**:`{success, result, errors, messages, result_info}`。
 *   `success: false` 可以和 **HTTP 200** 一起回来,故判失败要看 `!ok || success === false`
 *   两件事 —— 只看状态码会把一次失败当成功返回,还会拿信封当业务数据往下发。
 * - 错误消息藏在 `errors[].message`,拿不到再退 `messages[].message`,都没有才兜底状态码。
 * - 出参不是原样透传:字段从 snake_case 改名成 camelCase 并按 outputSchema 裁剪,
 *   `content` / `comment` 的 `null` 要留住(上游明确说"这条记录没有内容",与字段缺席不同)。
 * - 写请求体里 `content` 与 `comment` **原样发**(空串也发),而 `name` / `type` 先去空白 ——
 *   上游用 `typeof x === 'string'` 与 `optionalString` 区分了这两类,不是笔误:清空一条
 *   TXT 记录的 comment 靠的就是发空串。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  deleteDnsRecordInput,
  getDnsRecordInput,
  getZoneInput,
  listAccountsInput,
  listDnsRecordsInput,
  listZonesInput,
} from './schema'
import type { createDnsRecordInput, updateDnsRecordInput } from './schema.handwritten'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'cloudflare_dns'
const API_BASE = 'https://api.cloudflare.com/client/v4'

/** list_accounts 的分页缺省值,照抄上游 `requestCloudflareAccounts`。 */
const DEFAULT_ACCOUNTS_PAGE = 1
const DEFAULT_ACCOUNTS_PER_PAGE = 50

type Json = Record<string, unknown>
type QueryValue = boolean | number | string | undefined

interface Envelope {
  errors?: unknown
  messages?: unknown
  result?: unknown
  result_info?: unknown
  success?: unknown
}

interface RequestInput {
  body?: Json
  method?: 'DELETE' | 'GET' | 'PATCH' | 'POST'
  path: string
  query?: Record<string, QueryValue>
}

/** 上游 `optionalString` 的等价物:去空白后仍非空才算有值。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 上游写请求体里 `typeof x === 'string' ? x : undefined` 的等价物:空串与空白都原样保留。 */
function rawText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/** 出参里 `null` 与"字段缺席"是两回事:前者是上游明确说"这一项是空的"。 */
function nullableText(value: unknown): string | null | undefined {
  return value === null ? null : text(value)
}

/** 出参里的字符串数组:非字符串项丢掉(上游 `readOptionalStringArray`)。 */
function textArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === 'string')
}

/** 丢掉值为 undefined 的键(上游 `compactObject`);`null` 要留住。 */
function compact(input: Record<string, unknown>): Json {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

/** 契约说好是对象;不是就是上游出问题,不是调用方的错。 */
function requireRecord(value: unknown, label: string): Json {
  const result = record(value)
  if (result === undefined) throw new TBError('unavailable', `${label}不是对象`, { retryable: true })
  return result
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TBError('unavailable', `${label}不是数组`, { retryable: true })
  return value
}

/** 上游 `readRequiredString`:少了这个字段说明响应不完整,归 unavailable。 */
function requireText(source: Json, field: string, label: string): string {
  const value = text(source[field])
  if (value === undefined) {
    throw new TBError('unavailable', `${label}缺少 ${field}`, { retryable: true })
  }
  return value
}

/** 上游 `queryParams`:undefined / null / 空串一律不发。 */
function buildUrl(path: string, query: Record<string, QueryValue> | undefined): string {
  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

/** 信封里的错误消息:先 `errors[].message`,再 `messages[].message`,都没有才兜底状态码。 */
function errorMessage(envelope: Envelope, status: number): string {
  for (const source of [envelope.errors, envelope.messages]) {
    for (const entry of Array.isArray(source) ? source : []) {
      const message = text(record(entry)?.message)
      if (message !== undefined) return message
    }
  }
  return `Cloudflare 返回 HTTP ${status}`
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<Envelope> {
  const hasBody = input.body !== undefined
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
  }
  if (hasBody) headers['content-type'] = 'application/json'

  const response = await guardedFetch(buildUrl(input.path, input.query), {
    method: input.method ?? 'GET',
    headers,
    body: hasBody ? JSON.stringify(input.body) : undefined,
  })

  const body = await response.text().catch(() => '')
  let envelope: Envelope | undefined
  if (body !== '') {
    try {
      envelope = requireRecord(JSON.parse(body), 'Cloudflare 响应') as Envelope
    } catch (error) {
      if (error instanceof TBError) throw error
      // 上游把「解析不了」压成一个 success:false 的假信封,再按 HTTP 状态归一 —— 于是
      // 2xx 上回来一页 HTML 会变成 status 200 的错误。这里改成:2xx 上的非 JSON 归
      // unavailable(上游/CDN 出问题,可重试),错误响应上的非 JSON 仍按 HTTP 状态归一
      // (那时状态码比"响应不是 JSON"这句话准得多)。
      if (response.ok) {
        throw new TBError('unavailable', 'Cloudflare 返回了非 JSON 响应', { retryable: true })
      }
    }
  }
  const result = envelope ?? {}

  // 两件事都要看:HTTP 200 + `success: false` 是 Cloudflare 表达失败的常规方式之一。
  // 200 落到公共归一表上是 invalid_argument —— 请求被拒且重试不会变,正是该给的语义。
  if (!response.ok || result.success === false) {
    throw upstreamError(response.status, errorMessage(result, response.status))
  }
  return result
}

function normalizeAccount(value: unknown): Json {
  const account = requireRecord(value, 'Cloudflare 账户')
  return compact({
    id: requireText(account, 'id', 'Cloudflare 账户'),
    name: text(account.name),
    type: text(account.type),
  })
}

function normalizeZoneAccount(value: unknown): Json | undefined {
  const account = record(value)
  if (account === undefined) return undefined
  return compact({
    id: text(account.id),
    name: text(account.name),
    type: text(account.type),
  })
}

function normalizeZone(value: unknown): Json {
  const zone = requireRecord(value, 'Cloudflare zone')
  return compact({
    id: requireText(zone, 'id', 'Cloudflare zone'),
    name: requireText(zone, 'name', 'Cloudflare zone'),
    status: text(zone.status),
    type: text(zone.type),
    paused: boolean(zone.paused),
    createdOn: text(zone.created_on),
    modifiedOn: text(zone.modified_on),
    nameServers: textArray(zone.name_servers),
    originalNameServers: textArray(zone.original_name_servers),
    account: normalizeZoneAccount(zone.account),
    meta: record(zone.meta),
  })
}

function normalizeDnsRecord(value: unknown): Json {
  const dns = requireRecord(value, 'Cloudflare DNS 记录')
  return compact({
    id: requireText(dns, 'id', 'Cloudflare DNS 记录'),
    zoneId: text(dns.zone_id),
    zoneName: text(dns.zone_name),
    type: requireText(dns, 'type', 'Cloudflare DNS 记录'),
    name: requireText(dns, 'name', 'Cloudflare DNS 记录'),
    content: nullableText(dns.content),
    ttl: integer(dns.ttl),
    proxied: boolean(dns.proxied),
    proxiable: boolean(dns.proxiable),
    priority: integer(dns.priority),
    comment: nullableText(dns.comment),
    tags: textArray(dns.tags),
    createdOn: text(dns.created_on),
    modifiedOn: text(dns.modified_on),
    commentModifiedOn: text(dns.comment_modified_on),
    tagsModifiedOn: text(dns.tags_modified_on),
    data: record(dns.data),
    meta: record(dns.meta),
    settings: record(dns.settings),
  })
}

function normalizeResultInfo(value: unknown): Json | undefined {
  const info = record(value)
  if (info === undefined) return undefined
  return compact({
    page: integer(info.page),
    perPage: integer(info.per_page),
    count: integer(info.count),
    totalCount: integer(info.total_count),
    totalPages: integer(info.total_pages),
  })
}

/** create 与 update 共用的写请求体(上游 `buildDnsRecordMutationBody`)。 */
function mutationBody(input: z.infer<typeof createDnsRecordInput> | z.infer<typeof updateDnsRecordInput>): Json {
  return compact({
    type: text(input.type),
    name: text(input.name),
    // content / comment 原样发:清空一个字段靠的就是发空串,trim 掉就没法表达"清空"。
    content: rawText(input.content),
    data: record(input.data),
    ttl: integer(input.ttl),
    proxied: boolean(input.proxied),
    priority: integer(input.priority),
    comment: rawText(input.comment),
    tags: input.tags,
    settings: record(input.settings),
  })
}

export async function listAccounts(
  input: z.infer<typeof listAccountsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const envelope = await request(ctx, {
    path: '/accounts',
    // 这两个参数上游总是发(带缺省值),不是"没给就不发"。
    query: {
      page: input.page ?? DEFAULT_ACCOUNTS_PAGE,
      per_page: input.perPage ?? DEFAULT_ACCOUNTS_PER_PAGE,
    },
  })
  return compact({
    accounts: requireArray(envelope.result, 'Cloudflare 账户列表').map(item => normalizeAccount(item)),
    resultInfo: normalizeResultInfo(envelope.result_info),
  })
}

export async function listZones(input: z.infer<typeof listZonesInput>, ctx: ProviderContext): Promise<Json> {
  const envelope = await request(ctx, {
    path: '/zones',
    query: {
      'page': input.page,
      'per_page': input.perPage,
      'name': text(input.name),
      'status': text(input.status),
      // 上游的过滤键就叫 `account.id`,带点,不是笔误。
      'account.id': text(input.accountId),
      'match': input.match,
      'order': text(input.order),
      'direction': input.direction,
    },
  })
  return compact({
    zones: requireArray(envelope.result, 'Cloudflare zone 列表').map(item => normalizeZone(item)),
    resultInfo: normalizeResultInfo(envelope.result_info),
  })
}

export async function getZone(input: z.infer<typeof getZoneInput>, ctx: ProviderContext): Promise<Json> {
  const envelope = await request(ctx, { path: `/zones/${encodeURIComponent(input.zoneId)}` })
  return { zone: normalizeZone(envelope.result) }
}

export async function listDnsRecords(
  input: z.infer<typeof listDnsRecordsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const envelope = await request(ctx, {
    path: `/zones/${encodeURIComponent(input.zoneId)}/dns_records`,
    query: {
      page: input.page,
      per_page: input.perPage,
      type: input.type,
      name: text(input.name),
      content: text(input.content),
      proxied: input.proxied,
      match: input.match,
      order: text(input.order),
      direction: input.direction,
    },
  })
  return compact({
    records: requireArray(envelope.result, 'Cloudflare DNS 记录列表').map(item => normalizeDnsRecord(item)),
    resultInfo: normalizeResultInfo(envelope.result_info),
  })
}

export async function getDnsRecord(
  input: z.infer<typeof getDnsRecordInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const envelope = await request(ctx, {
    path: `/zones/${encodeURIComponent(input.zoneId)}/dns_records/${encodeURIComponent(input.dnsRecordId)}`,
  })
  return { record: normalizeDnsRecord(envelope.result) }
}

/** `content` 与 `data` 二选一由 schema 的 refine 拦(见 schema.handwritten.ts)。 */
export async function createDnsRecord(
  input: z.infer<typeof createDnsRecordInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const envelope = await request(ctx, {
    method: 'POST',
    path: `/zones/${encodeURIComponent(input.zoneId)}/dns_records`,
    body: mutationBody(input),
  })
  return { record: normalizeDnsRecord(envelope.result) }
}

/** "至少改一个字段"由 schema 的 refine 拦(见 schema.handwritten.ts)。 */
export async function updateDnsRecord(
  input: z.infer<typeof updateDnsRecordInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const envelope = await request(ctx, {
    method: 'PATCH',
    path: `/zones/${encodeURIComponent(input.zoneId)}/dns_records/${encodeURIComponent(input.dnsRecordId)}`,
    body: mutationBody(input),
  })
  return { record: normalizeDnsRecord(envelope.result) }
}

export async function deleteDnsRecord(
  input: z.infer<typeof deleteDnsRecordInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await request(ctx, {
    method: 'DELETE',
    path: `/zones/${encodeURIComponent(input.zoneId)}/dns_records/${encodeURIComponent(input.dnsRecordId)}`,
  })
  // 删除成功上游只回一个 `{ id }`,这里按 outputSchema 回一个明确的确认。
  return { id: input.dnsRecordId, deleted: true }
}
