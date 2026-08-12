/**
 * ScrapingBee 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/scrapingbee/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 三个上游特点决定了这里的形状:
 * - 凭证走 **query 参数 `api_key`** 而非 header —— ScrapingBee API 就这么设计的,不是迁移
 *   取舍。代价是凭证会进出站 URL(进而可能进日志),与 screenshot_fyi / ipqualityscore 同类。
 * - 所有请求参数都以**字符串**形式进 query,布尔与整数在这层显式 `String()`;上游的
 *   `readOptionalX` 系列本质就是"类型对得上才发",Zod 已保证类型,只留下"发不发"的判断。
 * - `fetch_html` 的诊断信息(实际状态码、解析后的 URL、信用点消耗)在**响应头** `spb-*` 上,
 *   不在 body 里 —— body 就是抓到的 HTML 原文。
 *
 * 上游错误映射带一个 `phase` 轴(校验凭证阶段把 400/401/403 压成 400),tool-bridge 没有
 * "校验凭证"这一相(探针就是一次真实调用),故不保留;状态交给 `upstreamError` 归一。
 */

import type { z } from 'zod/v4'
import type { extractDataInput, fetchHtmlInput, getUsageStatsInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'scrapingbee'
const API_BASE = 'https://app.scrapingbee.com/api/v1/'

type Json = Record<string, unknown>

interface Usage {
  current_concurrency: number
  max_api_credit: number
  max_concurrency: number
  renewal_subscription_date: string
  used_api_credit: number
}

interface FetchOptions {
  blockAds?: boolean
  blockResources?: boolean
  countryCode?: string
  device?: string
  premiumProxy?: boolean
  renderJs?: boolean
  retry?: number
  stealthProxy?: boolean
  transparentStatusCode?: boolean
  url: string
  waitFor?: string
  waitMs?: number
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 丢掉值为 undefined 的键(上游 `compactObject`);值类型透传给调用点。 */
function compact<T>(input: Record<string, T | undefined>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, T] => entry[1] !== undefined),
  )
}

/** 上游的 `readOptionalString`:空串当作没给(它不 trim,这里也不 trim)。 */
function str(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value
}

function bool(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : String(value)
}

function int(value: number | undefined): string | undefined {
  return value === undefined ? undefined : String(value)
}

function buildUrl(path: string, apiKey: string, params: Record<string, string | undefined>): string {
  const url = new URL(path, API_BASE)
  url.searchParams.set('api_key', apiKey)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value)
  }
  return url.toString()
}

/** ScrapingBee 的错误体形状不定:优先 `message`、再 `error`,都没有就把原文当消息。 */
function errorMessage(body: string, status: number): string {
  const trimmed = body.trim()
  if (trimmed === '') return `ScrapingBee request failed with status ${status}`
  try {
    const payload = record(JSON.parse(trimmed))
    const message = typeof payload?.message === 'string' ? payload.message.trim() : ''
    if (message !== '') return message
    const error = typeof payload?.error === 'string' ? payload.error.trim() : ''
    if (error !== '') return error
  } catch {
    // 非 JSON 的错误页(nginx / 代理层)直接回原文,和上游一致。
  }
  return trimmed
}

/** `spb-cost` 允许小数(信用点可以是 0.5),故只要求有限数。 */
function headerNumber(headers: Headers, name: string): number | undefined {
  const value = headers.get(name)
  if (value === null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * `spb-initial-status-code` 必须是**严格整数串**:上游专门写了逐字符判定,
 * 因为 `Number(' 200 ')`、`Number('2e2')` 都能过 `Number.isInteger`,而它们不是状态码。
 */
function headerInteger(headers: Headers, name: string): number | undefined {
  const value = headers.get(name)
  if (value === null || value === '') return undefined
  const trimmed = value.trim()
  if (!/^-?\d+$/.test(trimmed)) return undefined
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) ? parsed : undefined
}

/** 出参契约要求这几个字段必有;上游缺字段时按"上游坏了"处理(502 → unavailable)。 */
function requireInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw upstreamError(502, `scrapingbee response missing ${field}`)
  }
  return value
}

function requireStr(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    throw upstreamError(502, `scrapingbee response missing ${field}`)
  }
  return value
}

/** 抓取类 action 共用的参数集合;`extract_data` 在它之上再加 `extract_rules`。 */
function fetchParams(input: FetchOptions): Record<string, string | undefined> {
  return compact({
    url: input.url,
    render_js: bool(input.renderJs),
    wait: int(input.waitMs),
    wait_for: str(input.waitFor),
    device: str(input.device),
    block_ads: bool(input.blockAds),
    block_resources: bool(input.blockResources),
    country_code: str(input.countryCode),
    premium_proxy: bool(input.premiumProxy),
    stealth_proxy: bool(input.stealthProxy),
    transparent_status_code: bool(input.transparentStatusCode),
    retry: int(input.retry),
  })
}

async function requestText(
  ctx: ProviderContext,
  path: string,
  params: Record<string, string | undefined>,
): Promise<{ body: string, response: Response }> {
  const response = await guardedFetch(buildUrl(path, requireApiKey(ctx, SERVICE), params), { method: 'GET' })
  const body = await response.text()
  if (!response.ok) throw upstreamError(response.status, errorMessage(body, response.status))
  return { body, response }
}

export async function fetchHtml(
  input: z.infer<typeof fetchHtmlInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const { body, response } = await requestText(ctx, '', fetchParams(input))
  return compact({
    html: body,
    statusCode: response.status,
    contentType: response.headers.get('content-type') ?? undefined,
    initialStatusCode: headerInteger(response.headers, 'spb-initial-status-code'),
    resolvedUrl: response.headers.get('spb-resolved-url') ?? undefined,
    creditCost: headerNumber(response.headers, 'spb-cost'),
  })
}

export async function extractData(
  input: z.infer<typeof extractDataInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const { body, response } = await requestText(ctx, '', {
    ...fetchParams(input),
    extract_rules: JSON.stringify(input.extractRules),
  })

  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    throw upstreamError(502, 'scrapingbee extract_data response is not valid JSON')
  }
  const data = record(payload)
  if (data === undefined) throw upstreamError(502, 'scrapingbee extract_data response must be a JSON object')

  return compact({
    data: { ...data },
    statusCode: response.status,
    resolvedUrl: response.headers.get('spb-resolved-url') ?? undefined,
    creditCost: headerNumber(response.headers, 'spb-cost'),
  })
}

export async function getUsageStats(
  _input: z.infer<typeof getUsageStatsInput>,
  ctx: ProviderContext,
): Promise<{ usage: Usage }> {
  const { body } = await requestText(ctx, 'usage', {})

  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    throw upstreamError(502, 'scrapingbee usage response is not valid JSON')
  }
  const usage = record(payload)
  if (usage === undefined) throw upstreamError(502, 'scrapingbee usage response must be an object')

  return {
    usage: {
      max_api_credit: requireInt(usage.max_api_credit, 'max_api_credit'),
      used_api_credit: requireInt(usage.used_api_credit, 'used_api_credit'),
      max_concurrency: requireInt(usage.max_concurrency, 'max_concurrency'),
      current_concurrency: requireInt(usage.current_concurrency, 'current_concurrency'),
      renewal_subscription_date: requireStr(usage.renewal_subscription_date, 'renewal_subscription_date'),
    },
  }
}
