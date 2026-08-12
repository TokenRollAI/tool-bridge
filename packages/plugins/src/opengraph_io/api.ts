/**
 * OpenGraph.io 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/opengraph_io/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * OpenGraph.io 的几个特点决定了这里的形状:
 * - **App ID 走 `app_id` query 参数**,不走 header。
 * - **目标 URL 整个塞进路径段**(`/api/1.1/site/{encodeURIComponent(url)}`),而这个 URL 是
 *   让 OpenGraph.io 去拉的地址、不是我们自己请求的,`guardedFetch` 管不到它 —— 不校验
 *   就等于把上游当开放代理去打内网,故显式过一遍同一层出站策略。
 * - 上游对每个响应做了 **camelCase / snake_case 双读 + 结构收窄**,outputSchema 按收窄后的
 *   形状生成,故这些 `normalizeXxx` 必须照搬。
 * - `extract_site` 与 `scrape_site` 在上游是**同一个 handler**(Site 端点没有独立的 scrape 模式),
 *   `scrape_site` 的 `scrape` 标记纯属兼容位,收下但不发。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  captureScreenshotInput,
  extractSiteInput,
  scrapeSiteInput,
  scrapeUrlInput,
} from './schema'
import { assertPublicHttpUrl, guardedFetch } from '../_runtime/guardedFetch'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'opengraph_io'
const API_BASE = 'https://opengraph.io'

type Json = Record<string, unknown>
type QueryValue = boolean | number | string | undefined

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

function flag(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/** 丢掉值为 undefined 的键:上游 `compactObject` 的等价物。 */
function compact(input: Json): Json {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

function errorMessage(payload: unknown): string {
  if (typeof payload === 'string' && payload.trim() !== '') return payload
  const body = record(payload)
  if (body === undefined) return 'OpenGraph.io request failed'
  for (const key of ['error_description', 'error_message', 'error', 'message', 'detail']) {
    const found = text(body[key])
    if (found !== undefined) return found
  }
  return 'OpenGraph.io request failed'
}

async function request(
  ctx: ProviderContext,
  path: string,
  query: Record<string, QueryValue>,
): Promise<unknown> {
  const url = new URL(path, API_BASE)
  url.searchParams.set('app_id', requireApiKey(ctx, SERVICE))
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  let response: Response
  let payload: unknown = null
  try {
    response = await guardedFetch(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
    const raw = await response.text()
    // 解析失败就把原文当 payload:OpenGraph.io 的错误体常是纯文本,
    // 让"非法 JSON"的 502 顶掉真实的 401/429 会丢掉可归类的信息。
    if (raw !== '') {
      try {
        payload = JSON.parse(raw)
      } catch {
        payload = raw
      }
    }
  } catch (error) {
    const message = error instanceof Error
      ? `OpenGraph.io request failed: ${error.message}`
      : 'OpenGraph.io request failed'
    throw upstreamError(502, message)
  }

  if (!response.ok) throw upstreamError(response.status, errorMessage(payload))
  return payload
}

/** `{successful, data}` 信封在时剥掉外层;其余原样。 */
function unwrap(payload: unknown): unknown {
  const body = record(payload)
  if (body === undefined) return payload
  return typeof body.successful === 'boolean' && body.data !== undefined ? body.data : payload
}

function requireObject(payload: unknown, context: string): Json {
  const body = record(unwrap(payload))
  if (body === undefined) throw upstreamError(502, `OpenGraph.io ${context} response was not a JSON object`)
  return body
}

/** 字段全空时返回 undefined,免得透出一个空的 requestInfo 对象。 */
function normalizeRequestInfo(payload: unknown): Json | undefined {
  const body = record(payload)
  if (body === undefined) return undefined
  const normalized = compact({
    host: text(body.host),
    redirects: count(body.redirects),
    responseCode: count(body.responseCode ?? body.response_code),
    responseContentType: text(body.responseContentType ?? body.response_content_type),
  })
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function normalizeSiteResult(payload: unknown): Json {
  const body = requireObject(payload, 'site')
  const tags = Array.isArray(body.tags)
    ? body.tags.map(item => record(item)).filter((item): item is Json => item !== undefined)
    : undefined
  return compact({
    hybridGraph: record(body.hybridGraph ?? body.hybrid_graph),
    openGraph: record(body.openGraph ?? body.open_graph),
    twitterCard: record(body.twitterCard ?? body.twitter_card),
    htmlInferred: record(body.htmlInferred ?? body.html_inferred),
    oEmbed: record(body.oEmbed ?? body.oembed),
    requestUrl: text(body.requestUrl ?? body.request_url),
    requestInfo: normalizeRequestInfo(body.requestInfo ?? body.request_info),
    cached: flag(body.cached),
    // createdAt 的 null 是有信息的("非缓存结果"),不能被 compact 当缺失丢掉。
    createdAt: (body.createdAt ?? body.created_at) === null ? null : text(body.createdAt ?? body.created_at),
    retryInfo: record(body.retryInfo ?? body.retry_info),
    aiSafety: record(body.aiSafety ?? body.ai_safety ?? body.AI_SAFETY),
    domain: text(body.domain),
    tags: tags !== undefined && tags.length > 0 ? tags : undefined,
  })
}

/** URL 是让 OpenGraph.io 去拉的,故先过一遍我们自己的出站策略(转发型 SSRF)。 */
function targetPath(family: 'screenshot' | 'scrape' | 'site', target: string, field: string): string {
  let normalized: string
  try {
    normalized = assertPublicHttpUrl(target).toString()
  } catch {
    throw new TBError('invalid_argument', `${field} 必须是公网可达的 http(s) 地址`)
  }
  return `/api/1.1/${family}/${encodeURIComponent(normalized)}`
}

type SiteInput = z.infer<typeof extractSiteInput> | z.infer<typeof scrapeSiteInput>

function siteQuery(input: SiteInput): Record<string, QueryValue> {
  return {
    cache_ok: input.cacheOk,
    full_render: input.fullRender,
    use_proxy: input.useProxy,
    use_premium: input.usePremium,
    use_superior: input.useSuperior,
    use_ai: input.useAi,
    max_cache_age: input.maxCacheAge,
    accept_lang: input.acceptLang,
    auto_proxy: input.autoProxy,
    auto_render: input.autoRender,
    retry: input.retry,
    max_retries: input.maxRetries,
    retry_escalate: input.retryEscalate,
    proxy_country: input.proxyCountry,
  }
}

async function extractSiteMetadata(input: SiteInput, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, targetPath('site', input.site, 'site'), siteQuery(input))
  return normalizeSiteResult(payload)
}

export async function extractSite(
  input: z.infer<typeof extractSiteInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return extractSiteMetadata(input, ctx)
}

export async function scrapeSite(
  input: z.infer<typeof scrapeSiteInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return extractSiteMetadata(input, ctx)
}

export async function scrapeUrl(
  input: z.infer<typeof scrapeUrlInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, targetPath('scrape', input.url, 'url'), {
    cache_ok: input.cacheOk,
    full_render: input.fullRender,
    use_proxy: input.useProxy,
    use_premium: input.usePremium,
    use_superior: input.useSuperior,
    accept_lang: input.acceptLang,
    auto_proxy: input.autoProxy,
    auto_render: input.autoRender,
    retry: input.retry,
  })

  // Scrape 端点可能直接回一段裸 HTML 文本而非 JSON 对象。
  const unwrapped = unwrap(payload)
  if (typeof unwrapped === 'string') return { htmlContent: unwrapped }

  const body = requireObject(unwrapped, 'scrape')
  const htmlContent = text(body.htmlContent ?? body.html_content ?? body.html)
  if (htmlContent === undefined) {
    throw upstreamError(502, 'OpenGraph.io scrape response did not include html content')
  }
  return compact({
    htmlContent,
    requestInfo: normalizeRequestInfo(body.requestInfo ?? body.request_info),
    retryInfo: record(body.retryInfo ?? body.retry_info),
  })
}

export async function captureScreenshot(
  input: z.infer<typeof captureScreenshotInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, targetPath('screenshot', input.url, 'url'), {
    format: input.format,
    quality: input.quality,
    cache_ok: input.cacheOk,
    selector: input.selector,
    dark_mode: input.darkMode,
    full_page: input.fullPage,
    use_proxy: input.useProxy,
    dimensions: input.dimensions,
    capture_delay: input.captureDelay,
    exclude_selectors: input.excludeSelectors,
    navigation_timeout: input.navigationTimeout,
    block_cookie_banner: input.blockCookieBanner,
  })

  const body = requireObject(payload, 'screenshot')
  const screenshotUrl = text(body.screenshotUrl ?? body.screenshot_url)
  if (screenshotUrl === undefined) {
    throw upstreamError(502, 'OpenGraph.io screenshot response did not include screenshotUrl')
  }
  const dimensions = record(body.dimensions)
  const width = count(dimensions?.width)
  const height = count(dimensions?.height)
  if (width === undefined || height === undefined) {
    throw upstreamError(502, 'OpenGraph.io screenshot response did not include dimensions')
  }
  return compact({
    screenshotUrl,
    dimensions: { width, height },
    requestInfo: normalizeRequestInfo(body.requestInfo ?? body.request_info),
  })
}
