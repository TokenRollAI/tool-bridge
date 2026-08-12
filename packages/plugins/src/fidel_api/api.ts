/**
 * Fidel API 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/fidel_api/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * Fidel 的两个特点决定了这里的形状:
 * - 凭证走 **`Fidel-Key` 头**。
 * - 响应统一是 `{items, count, last, resource, status, execution}` 信封,**单条查询
 *   也走 items 数组**(取第 0 个)。上游把每条记录逐字段定型成 `string|null` 等,
 *   这里照搬 —— 生成的 outputSchema 就是按这个定型写的,少一个字段就对不上。
 *
 * 上游那套「404/422 压成 400、validate 阶段把 401 压成 400」的自有映射没有搬:
 * 状态码归一现在统一走 `upstreamError`,404 因此落在 not_found。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getBrandInput,
  getCardInput,
  getTransactionInput,
  listBrandsInput,
  listCardsInput,
  listTransactionsInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'fidel_api'
const API_BASE = 'https://api.fidel.uk/v1'

type Json = Record<string, unknown>

interface FidelResponse {
  path: string
  payload: unknown
  status: number
}

function asRecord(value: unknown): Json | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : undefined
}

/** 上游 `optionalString` 的口径:trim 后非空才算有值。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function textOrNull(value: unknown): null | string {
  return text(value) ?? null
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function numberOrNull(value: unknown): null | number {
  return typeof value === 'number' ? value : null
}

function intOrNull(value: unknown): null | number {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function looseObjectOrNull(value: unknown): Json | null {
  return asRecord(value) ?? null
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

/**
 * Fidel 的错误文案埋得很深:body 可能是一段 JSON 字符串,里面又有个 `body` 字段
 * 装着另一段 JSON 字符串。上游逐层剥,这里照搬。
 */
function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') {
    const trimmed = payload.trim()
    if (trimmed === '') return undefined
    const parsed = tryParseJson(trimmed)
    return parsed === undefined ? trimmed : (errorMessage(parsed) ?? trimmed)
  }

  const record = asRecord(payload)
  if (record === undefined) return undefined

  const body = text(record.body)
  if (body !== undefined) {
    const nested = errorMessage(tryParseJson(body))
    if (nested !== undefined) return nested
  }

  const error = asRecord(record.error)
  return text(error?.message)
    ?? text(error?.detail)
    ?? text(error?.title)
    ?? text(record.message)
    ?? text(record.detail)
    ?? text(record.title)
}

/** Fidel 在边缘错误上会回空体或纯文本;纯文本原样带走,交给 errorMessage 逐层剥。 */
async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text().catch(() => '')
  if (body.trim() === '') return null
  const parsed = tryParseJson(body)
  return parsed === undefined ? body : parsed
}

async function request(
  ctx: ProviderContext,
  path: string,
  query: Record<string, number | string | undefined> = {},
): Promise<FidelResponse> {
  const url = new URL(path.startsWith('/') ? path.slice(1) : path, `${API_BASE}/`)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  let response: Response
  let payload: unknown
  try {
    response = await guardedFetch(url.toString(), {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'fidel-key': requireApiKey(ctx, SERVICE),
      },
    })
    payload = await readPayload(response)
  } catch (error) {
    if (error instanceof TBError) throw error
    throw new TBError(
      'unavailable',
      error instanceof Error ? `Fidel 请求失败: ${error.message}` : 'Fidel 请求失败',
      { retryable: true },
    )
  }

  if (!response.ok) {
    throw upstreamError(response.status, errorMessage(payload) ?? 'Fidel API request failed')
  }
  return { payload, status: response.status, path }
}

// —— 信封 ——

function envelopeOf(response: FidelResponse): Json {
  const record = asRecord(response.payload)
  if (record === undefined) {
    throw new TBError('unavailable', 'Fidel 返回了非对象响应', { retryable: true })
  }
  return record
}

function envelopeItems(envelope: Json): unknown[] {
  if (!Array.isArray(envelope.items)) {
    throw new TBError('unavailable', 'Fidel 响应里没有 items 数组', { retryable: true })
  }
  return envelope.items
}

/** 上游的 resource 缺省值:把请求路径补成 /v1/ 开头。 */
function envelopeResource(envelope: Json, path: string): string {
  const resource = text(envelope.resource)
  if (resource !== undefined) return resource
  return path.startsWith('/v1/') ? path : `/v1${path.startsWith('/') ? path : `/${path}`}`
}

/** 分页游标可能是字符串,也可能是个对象(复合游标);后者序列化后原样回传。 */
function nextCursor(value: unknown): null | string {
  const asText = text(value)
  if (asText !== undefined) return asText
  const record = asRecord(value)
  return record === undefined ? null : JSON.stringify(record)
}

/** 列表类响应共有的信封字段。 */
function envelopeMeta(envelope: Json, response: FidelResponse): Json {
  return {
    resource: envelopeResource(envelope, response.path),
    status: intOrNull(envelope.status) ?? response.status,
    executionMs: numberOrNull(envelope.execution),
  }
}

/** 单条查询也走 items 数组;空数组说明上游没给数据,不是调用方的错。 */
function singleItem(envelope: Json, label: string): unknown {
  const items = envelopeItems(envelope)
  if (items.length === 0) {
    throw new TBError('unavailable', `Fidel 没有返回任何 ${label}`, { retryable: true })
  }
  return items[0]
}

function requireRecord(value: unknown, label: string): Json {
  const record = asRecord(value)
  if (record === undefined) {
    throw new TBError('unavailable', `Fidel 返回了不合法的 ${label}`, { retryable: true })
  }
  return record
}

function requireId(value: unknown, field: string): string {
  const id = text(value)
  if (id === undefined) {
    throw new TBError('unavailable', `Fidel 响应缺少 ${field}`, { retryable: true })
  }
  return id
}

// —— 记录定型 ——

function normalizeBrand(value: unknown): Json {
  const record = requireRecord(value, 'brand')
  return {
    id: requireId(record.id, 'brand.id'),
    accountId: textOrNull(record.accountId),
    created: textOrNull(record.created),
    updated: textOrNull(record.updated),
    name: textOrNull(record.name),
    metadata: looseObjectOrNull(record.metadata),
    // Fidel 对 URL 字段的大小写不统一(logoUrl / logoURL),两种都收。
    logoUrl: textOrNull(record.logoUrl ?? record.logoURL),
    live: boolOrNull(record.live),
    consent: boolOrNull(record.consent),
    websiteUrl: textOrNull(record.websiteUrl ?? record.websiteURL),
  }
}

function normalizeCard(value: unknown): Json {
  const record = requireRecord(value, 'card')
  return {
    id: requireId(record.id, 'card.id'),
    accountId: textOrNull(record.accountId),
    countryCode: textOrNull(record.countryCode),
    created: textOrNull(record.created),
    expYear: intOrNull(record.expYear),
    expDate: textOrNull(record.expDate),
    live: boolOrNull(record.live),
    lastNumbers: textOrNull(record.lastNumbers),
    expMonth: intOrNull(record.expMonth),
    updated: textOrNull(record.updated),
    programId: textOrNull(record.programId),
    firstNumbers: textOrNull(record.firstNumbers),
    scheme: textOrNull(record.scheme),
    type: textOrNull(record.type),
  }
}

function normalizeTransactionCard(value: unknown): Json {
  const record = asRecord(value)
  return {
    id: textOrNull(record?.id),
    firstNumbers: textOrNull(record?.firstNumbers),
    lastNumbers: textOrNull(record?.lastNumbers),
    scheme: textOrNull(record?.scheme),
  }
}

function normalizeTransactionLocation(value: unknown): Json {
  const record = asRecord(value)
  const geolocation = asRecord(record?.geolocation)
  return {
    id: textOrNull(record?.id),
    address: textOrNull(record?.address),
    city: textOrNull(record?.city),
    countryCode: textOrNull(record?.countryCode),
    geolocation: geolocation === undefined
      ? null
      : {
          latitude: numberOrNull(geolocation.latitude),
          longitude: numberOrNull(geolocation.longitude),
        },
    postcode: textOrNull(record?.postcode),
    state: textOrNull(record?.state),
    timezone: textOrNull(record?.timezone),
    metadata: looseObjectOrNull(record?.metadata),
  }
}

function normalizeTransactionBrand(value: unknown): Json {
  const record = asRecord(value)
  return {
    id: textOrNull(record?.id),
    name: textOrNull(record?.name),
    logoUrl: textOrNull(record?.logoUrl ?? record?.logoURL),
    metadata: looseObjectOrNull(record?.metadata),
  }
}

function normalizeTransactionIdentifiers(value: unknown): Json {
  const record = asRecord(value)
  return {
    amexApprovalCode: textOrNull(record?.amexApprovalCode),
    mastercardAuthCode: textOrNull(record?.mastercardAuthCode),
    mastercardRefNumber: textOrNull(record?.mastercardRefNumber),
    mastercardTransactionSequenceNumber: textOrNull(record?.mastercardTransactionSequenceNumber),
    mid: textOrNull(record?.mid ?? record?.MID),
    visaAuthCode: textOrNull(record?.visaAuthCode),
  }
}

function normalizeTransaction(value: unknown): Json {
  const record = requireRecord(value, 'transaction')
  return {
    id: requireId(record.id, 'transaction.id'),
    programId: textOrNull(record.programId),
    accountId: textOrNull(record.accountId),
    created: textOrNull(record.created),
    updated: textOrNull(record.updated),
    amount: numberOrNull(record.amount),
    currency: textOrNull(record.currency),
    // 各卡组织的授权码字段名不同,归一成一个 authorizationCode。
    authorizationCode: textOrNull(record.approvalCode ?? record.authCode),
    auth: boolOrNull(record.auth),
    cleared: boolOrNull(record.cleared),
    wallet: looseObjectOrNull(record.wallet),
    offer: looseObjectOrNull(record.offer),
    datetime: textOrNull(record.datetime),
    card: normalizeTransactionCard(record.card),
    location: normalizeTransactionLocation(record.location),
    brand: normalizeTransactionBrand(record.brand),
    identifiers: normalizeTransactionIdentifiers(record.identifiers),
    cardPresent: boolOrNull(record.cardPresent),
  }
}

/** 三个 list action 的共同整形:items 逐条定型 + count/nextCursor + 信封元数据。 */
function listResult(
  response: FidelResponse,
  key: string,
  normalize: (value: unknown) => Json,
): Json {
  const envelope = envelopeOf(response)
  const items = envelopeItems(envelope).map(normalize)
  return {
    // 上游给的 count 是总数,可能大于本页条数;拿不到才退回本页长度。
    count: intOrNull(envelope.count) ?? items.length,
    [key]: items,
    nextCursor: nextCursor(envelope.last),
    ...envelopeMeta(envelope, response),
  }
}

function singleResult(
  response: FidelResponse,
  key: string,
  normalize: (value: unknown) => Json,
): Json {
  const envelope = envelopeOf(response)
  return {
    [key]: normalize(singleItem(envelope, key)),
    ...envelopeMeta(envelope, response),
  }
}

export async function listBrands(
  input: z.infer<typeof listBrandsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const response = await request(ctx, '/brands', {
    limit: input.limit,
    start: input.start,
    order: input.order,
    name: input.name,
  })
  return listResult(response, 'brands', normalizeBrand)
}

export async function getBrand(
  input: z.infer<typeof getBrandInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const response = await request(ctx, `/brands/${encodeURIComponent(input.brandId)}`)
  return singleResult(response, 'brand', normalizeBrand)
}

export async function listCards(
  input: z.infer<typeof listCardsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const response = await request(ctx, `/programs/${encodeURIComponent(input.programId)}/cards`, {
    limit: input.limit,
    start: input.start,
    order: input.order,
  })
  return listResult(response, 'cards', normalizeCard)
}

export async function getCard(
  input: z.infer<typeof getCardInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const response = await request(ctx, `/cards/${encodeURIComponent(input.cardId)}`)
  return singleResult(response, 'card', normalizeCard)
}

export async function listTransactions(
  input: z.infer<typeof listTransactionsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/programs/${encodeURIComponent(input.programId)}/transactions`
  const response = await request(ctx, path, {
    limit: input.limit,
    start: input.start,
    order: input.order,
    from: input.from,
    to: input.to,
  })
  return listResult(response, 'transactions', normalizeTransaction)
}

export async function getTransaction(
  input: z.infer<typeof getTransactionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const response = await request(ctx, `/transactions/${encodeURIComponent(input.transactionId)}`)
  return singleResult(response, 'transaction', normalizeTransaction)
}
