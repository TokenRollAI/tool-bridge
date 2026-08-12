/**
 * Brandfetch 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/brandfetch/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 两个 action 打的是不同端点,但**响应形状相同**(一个 brand 档案),故共用同一套
 * normalize。上游的信封不稳定:brand 可能在 `data`、`brand`,也可能就是顶层,
 * `extractBrand` 三种都收。
 *
 * 上游 `createBrandfetchError` 按"校验期/执行期"把 401 压成 400 的分支不保留:
 * 状态码归一由共用的 `upstreamError` 统一口径。保留的是 404 的兜底文案 ——
 * Brandfetch 找不到品牌时常常不给消息,只回一个空的 404。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { getBrandInput, getTransactionInfoInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'brandfetch'
const API_BASE = 'https://api.brandfetch.io'

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

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/** 丢掉值为 `undefined` 的键(上游 `compactObject`)。 */
function compact(input: Json): Json {
  const output: Json = {}
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) output[key] = value
  }
  return output
}

/** 非数组回 undefined(而非空数组):上游用"没这个键"与"空列表"区分未返回与返回了空。 */
function objectArray(value: unknown): Json[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map(item => asRecord(item)).filter((item): item is Json => item !== undefined)
}

/**
 * 逐项 normalize 后丢掉**全空**的项 —— 上游对每种数组都做这一步,免得把
 * `{}` 这种什么都没剩下的条目透给调用方。
 */
function normalizeArray(
  value: unknown,
  normalize: (item: Json) => Json,
): Json[] | undefined {
  return objectArray(value)?.map(normalize).filter(item => Object.keys(item).length > 0)
}

function normalizeFormats(value: unknown): Json[] | undefined {
  return normalizeArray(value, item => compact({
    src: optionalText(item.src),
    format: optionalText(item.format),
    width: optionalNumber(item.width),
    height: optionalNumber(item.height),
    size: optionalNumber(item.size),
    background: optionalText(item.background),
  }))
}

/**
 * 信封不稳定:brand 可能在 `data`、`brand`,也可能就是顶层。三种都收。
 */
function extractBrand(payload: unknown): Json {
  const wrapped = asRecord(payload)
  if (wrapped === undefined) throw upstreamError(502, 'Brandfetch 返回了非对象响应')
  return asRecord(wrapped.data) ?? asRecord(wrapped.brand) ?? wrapped
}

function normalizeBrand(record: Json): Json {
  return compact({
    id: optionalText(record.id),
    urn: optionalText(record.urn),
    name: optionalText(record.name),
    domain: optionalText(record.domain),
    claimed: optionalBoolean(record.claimed),
    description: optionalText(record.description),
    longDescription: optionalText(record.longDescription),
    qualityScore: optionalNumber(record.qualityScore),
    isNsfw: optionalBoolean(record.isNsfw),
    logos: normalizeArray(record.logos, item => compact({
      type: optionalText(item.type),
      theme: optionalText(item.theme),
      formats: normalizeFormats(item.formats),
    })),
    colors: normalizeArray(record.colors, item => compact({
      hex: optionalText(item.hex),
      type: optionalText(item.type),
      brightness: optionalNumber(item.brightness),
    })),
    fonts: normalizeArray(record.fonts, item => compact({
      name: optionalText(item.name),
      type: optionalText(item.type),
      origin: optionalText(item.origin),
      originId: optionalText(item.originId),
    })),
    images: normalizeArray(record.images, item => compact({
      type: optionalText(item.type),
      formats: normalizeFormats(item.formats),
    })),
    links: normalizeArray(record.links, item => compact({
      name: optionalText(item.name),
      url: optionalText(item.url),
    })),
    company: asRecord(record.company),
  })
}

/** 空体读成 `{}`,非 JSON 塞进 `message` —— 上游边缘层会回纯文本。 */
async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { message: text }
  }
}

interface RequestInput {
  body?: Json
  method: 'GET' | 'POST'
  path: string
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  const apiKey = requireApiKey(ctx, SERVICE)
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${apiKey}`,
  }
  if (input.body !== undefined) headers['content-type'] = 'application/json'

  let response: Response
  let payload: unknown
  try {
    response = await guardedFetch(new URL(input.path, API_BASE).toString(), {
      method: input.method,
      headers,
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    })
    payload = await readPayload(response)
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障,还丢掉唯一有诊断价值的那句消息。
    throw upstreamError(
      502,
      error instanceof Error ? `Brandfetch 请求失败: ${error.message}` : 'Brandfetch 请求失败',
    )
  }

  if (!response.ok) {
    const record = asRecord(payload)
    const message = optionalText(record?.message)
      ?? optionalText(record?.error)
      ?? optionalText(record?.details)
    if (response.status === 404) {
      // Brandfetch 找不到品牌时常常回一个空的 404,兜底文案比"HTTP 404"有用。
      throw upstreamError(404, message ?? 'Brandfetch 没有找到与输入匹配的品牌')
    }
    throw upstreamError(response.status, message ?? `Brandfetch 请求失败(HTTP ${response.status})`)
  }
  return payload
}

export async function getBrand(
  input: z.infer<typeof getBrandInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // identifier 在 schema 里是 optional(生成器照搬了上游 action 定义),但它要拼进路径,
  // 缺了会打出 `/v2/brands/undefined`。
  const identifier = optionalText(input.identifier)
  if (identifier === undefined) throw new TBError('invalid_argument', 'identifier 不能为空')

  const payload = await request(ctx, {
    method: 'GET',
    path: `/v2/brands/${encodeURIComponent(identifier)}`,
  })
  return normalizeBrand(extractBrand(payload))
}

export async function getTransactionInfo(
  input: z.infer<typeof getTransactionInfoInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const transactionLabel = optionalText(input.transactionLabel)
  const countryCode = optionalText(input.countryCode)
  if (transactionLabel === undefined || countryCode === undefined) {
    throw new TBError('invalid_argument', 'get_transaction_info 需要 transactionLabel 与 countryCode')
  }

  const payload = await request(ctx, {
    method: 'POST',
    path: '/v2/transactions',
    // 上游把国家码强制大写:Brandfetch 对小写的 `us` 回 400。
    body: { transactionLabel, countryCode: countryCode.toUpperCase() },
  })
  return normalizeBrand(extractBrand(payload))
}
