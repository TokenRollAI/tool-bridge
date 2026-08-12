/**
 * OpenSea 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/opensea/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(走 `x-api-key` 头),出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 上游的 `credentialValidators.apiKey`(打 `/api/v2/collections?limit=1` 试凭证)没有迁 ——
 * 平台侧凭证由 authRef 注入,没有"验证凭证"这个动作。连带上游 `phase: 'validate'` 那条
 * 「401/403 压成 400」的分支也一并去掉:9 个 action 全走 execute 口径。
 *
 * OpenSea 的 API 全是 GET + query,没有请求体;response 整形集中在几个 normalize 函数里,
 * 它们一律**保留 `raw` 原始对象**,归一字段只是给调用方省事,不吞信息。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getBestNftListingInput,
  getBestNftOfferInput,
  getCollectionInput,
  getCollectionStatsInput,
  getNftInput,
  listCollectionNftsInput,
  listCollectionOffersInput,
  listCollectionTraitsInput,
  searchInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'opensea'
const API_BASE = 'https://api.opensea.io'

type Json = Record<string, unknown>

/**
 * 上游 `optionalString` 的口径:非字符串或纯空白都算"没有",拿到的一律 trim 过。
 *
 * 归一字段一律以 `?? null` 收尾,而不是照抄上游那个 `nullableString(a) ?? nullableString(b)`
 * ——后者在"两个来源都缺"时求值成 `undefined`,JSON 序列化后整个键消失,在"来源显式为 null"
 * 时才是 `null`,同一字段两种形状。schema 把这些字段声明成 `.nullable()`,统一成 null 更好用。
 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 上游 `optionalRecord` 的口径:null 与数组都不算对象。 */
function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 响应契约说好是对象;不是就是上游出了问题,不是调用方的错。 */
function requireObject(payload: unknown): Json {
  const body = record(payload)
  if (body === undefined) {
    throw new TBError('unavailable', 'OpenSea 返回了非对象响应', { retryable: true })
  }
  return body
}

/**
 * Zod 的 `min(1)` 拦不住纯空白串,而上游对所有必填串都走 trim-非空 的口径。
 * 保留这道校验:少了它,`slug: '  '` 会拼出 `/collections/%20%20` 这种必然 404 的地址。
 */
function requireText(value: string, field: string): string {
  const trimmed = value.trim()
  if (trimmed === '') throw new TBError('invalid_argument', `${field} 不能为空`)
  return trimmed
}

function pathSegment(value: string, field: string): string {
  return encodeURIComponent(requireText(value, field))
}

/** 上游会把数组里的空白项滤掉,全空则整个参数不发(而不是发一个空数组)。 */
function textArray(value: readonly string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined
  const items = value.filter(item => item.trim() !== '')
  return items.length > 0 ? items : undefined
}

/** 上游可能回空体或纯文本(网关层错误),按 空 → JSON → 原文 的顺序尽力解析。 */
async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text().catch(() => '')
  if (body.trim() === '') return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    return body
  }
}

/** OpenSea 的错误体形状不统一:message / detail / errors[] / error 都出现过,逐个试。 */
function errorMessage(status: number, payload: unknown): string {
  const plain = text(payload)
  if (plain !== undefined) return plain

  const body = record(payload)
  const fallback = `OpenSea 返回 HTTP ${status}`
  if (body === undefined) return fallback

  const direct = text(body.message) ?? text(body.detail)
  if (direct !== undefined) return direct

  const errors = Array.isArray(body.errors) ? body.errors : []
  const messages = errors.filter((item): item is string => typeof item === 'string')
  if (messages.length > 0) return messages.join('; ')

  return text(body.error) ?? text(record(body.error)?.message) ?? fallback
}

/**
 * 所有 action 共用的一次 GET。
 *
 * query 值的处理照搬上游:`undefined`/`null`/空串跳过,数组**重复同名键**
 * (`chains=ethereum&chains=base`)而不是逗号拼接 —— OpenSea 只认前者。
 */
async function request(ctx: ProviderContext, path: string, query?: Json): Promise<unknown> {
  const url = new URL(path, API_BASE)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item))
      continue
    }
    url.searchParams.set(key, String(value))
  }

  // 取凭证放在 try 外:缺 authRef 是配置问题(503),不该被下面的传输层 catch 改写成"上游故障"。
  const apiKey = requireApiKey(ctx, SERVICE)

  let response: Response
  let payload: unknown
  try {
    response = await guardedFetch(url.toString(), {
      headers: { 'accept': 'application/json', 'x-api-key': apiKey },
    })
    payload = await readPayload(response)
  } catch (error) {
    // 上游把传输层失败一律归成 502,这里对齐成可重试的 unavailable:连不上不是调用方的错。
    throw new TBError(
      'unavailable',
      error instanceof Error ? `OpenSea 请求失败: ${error.message}` : 'OpenSea 请求失败',
      { retryable: true },
    )
  }

  if (!response.ok) throw upstreamError(response.status, errorMessage(response.status, payload))
  return payload
}

function normalizeCollection(payload: unknown): Json {
  const body = requireObject(payload)
  return {
    slug: text(body.collection) ?? text(body.slug) ?? null,
    name: text(body.name) ?? null,
    description: text(body.description) ?? null,
    imageUrl: text(body.image_url) ?? null,
    bannerImageUrl: text(body.banner_image_url) ?? null,
    owner: text(body.owner) ?? null,
    raw: body,
  }
}

function normalizeNft(payload: unknown): Json {
  const body = requireObject(payload)
  const contract = record(body.contract)
  return {
    identifier: text(body.identifier) ?? null,
    name: text(body.name) ?? null,
    description: text(body.description) ?? null,
    imageUrl: text(body.image_url) ?? null,
    collection: text(body.collection) ?? null,
    // contract 在不同端点上有时是对象({address}),有时直接是地址串。
    contract: text(contract?.address) ?? text(body.contract) ?? null,
    chain: text(body.chain) ?? null,
    raw: body,
  }
}

function normalizeOrder(payload: unknown): Json {
  const body = requireObject(payload)
  const price = record(body.price) ?? record(body.current_price)
  const maker = record(body.maker)
  const taker = record(body.taker)
  const paymentToken = record(price?.currency) ?? record(body.payment_token)
  return {
    orderHash: text(body.order_hash) ?? null,
    type: text(body.type) ?? text(body.order_type) ?? null,
    // price.value 是数字时 text() 返回 undefined,退回顶层 price;归一后的 price 恒为字符串或 null。
    price: text(price?.value) ?? text(body.price) ?? null,
    currency: text(paymentToken?.symbol) ?? text(body.currency) ?? null,
    maker: text(maker?.address) ?? text(body.maker) ?? null,
    taker: text(taker?.address) ?? text(body.taker) ?? null,
    raw: body,
  }
}

function normalizePagination(body: Json): Json {
  return {
    next: text(body.next) ?? null,
    previous: text(body.previous) ?? null,
  }
}

export async function search(input: z.infer<typeof searchInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, '/api/v2/search', {
    query: requireText(input.query, 'query'),
    chains: textArray(input.chains),
    asset_types: textArray(input.assetTypes),
    limit: input.limit,
  })
  const body = requireObject(payload)

  return {
    // search 的结果是异构的(collection / nft / token / account 混在一起),
    // 上游不归一、原样透出,这里保持一致:形状由 OpenSea 决定。
    results: Array.isArray(body.results) ? body.results : [],
    raw: body,
  }
}

export async function getCollection(
  input: z.infer<typeof getCollectionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, `/api/v2/collections/${pathSegment(input.slug, 'slug')}`)

  return { collection: normalizeCollection(payload) }
}

export async function getCollectionStats(
  input: z.infer<typeof getCollectionStatsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, `/api/v2/collections/${pathSegment(input.slug, 'slug')}/stats`)

  // stats 原样透出(不过 requireObject):OpenSea 的统计结构还在变,归一只会把新字段吃掉。
  return { stats: payload }
}

export async function listCollectionNfts(
  input: z.infer<typeof listCollectionNftsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, `/api/v2/collection/${pathSegment(input.slug, 'slug')}/nfts`, {
    // trait 过滤器整个 JSON 序列化后当一个 query 值传,键名保持入参的 camelCase —— 照搬上游。
    'traits': input.traits === undefined ? undefined : JSON.stringify(input.traits),
    // 布尔值不做"假值即省略"处理:`false` 是一个有意义的过滤条件,跳过它会静默改变语义。
    'has_agent_binding': input.hasAgentBinding,
    'limit': input.limit,
    // 游标参数上游用的是 `next.value` 这个带点的键名,不是 `next`;原样保留。
    'next.value': input.next,
  })
  const body = requireObject(payload)

  return {
    nfts: (Array.isArray(body.nfts) ? body.nfts : []).map(normalizeNft),
    pagination: normalizePagination(body),
    raw: body,
  }
}

export async function listCollectionTraits(
  input: z.infer<typeof listCollectionTraitsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 注意路径是 /traits/<slug>,不在 /collections/ 下面。
  const payload = await request(ctx, `/api/v2/traits/${pathSegment(input.slug, 'slug')}`)

  return { traits: payload }
}

export async function listCollectionOffers(
  input: z.infer<typeof listCollectionOffersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, `/api/v2/offers/collection/${pathSegment(input.slug, 'slug')}`, {
    'limit': input.limit,
    'next.value': input.next,
  })
  const body = requireObject(payload)

  return {
    offers: (Array.isArray(body.offers) ? body.offers : []).map(normalizeOrder),
    pagination: normalizePagination(body),
    raw: body,
  }
}

export async function getBestNftListing(
  input: z.infer<typeof getBestNftListingInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const slug = pathSegment(input.slug, 'slug')
  const identifier = pathSegment(input.identifier, 'identifier')
  const payload = await request(ctx, `/api/v2/listings/collection/${slug}/nfts/${identifier}/best`, {
    include_private_listings: input.includePrivateListings,
  })

  return { listing: normalizeOrder(payload) }
}

export async function getBestNftOffer(
  input: z.infer<typeof getBestNftOfferInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const slug = pathSegment(input.slug, 'slug')
  const identifier = pathSegment(input.identifier, 'identifier')
  const payload = await request(ctx, `/api/v2/offers/collection/${slug}/nfts/${identifier}/best`)

  return { offer: normalizeOrder(payload) }
}

export async function getNft(input: z.infer<typeof getNftInput>, ctx: ProviderContext): Promise<Json> {
  const chain = pathSegment(input.chain, 'chain')
  const address = pathSegment(input.address, 'address')
  const identifier = pathSegment(input.identifier, 'identifier')
  const payload = await request(ctx, `/api/v2/chain/${chain}/contract/${address}/nfts/${identifier}`)
  const body = requireObject(payload)

  // 这个端点把 NFT 包在 `nft` 里,但个别路径直接回裸对象;两种都认。
  return { nft: normalizeNft(body.nft ?? body) }
}
