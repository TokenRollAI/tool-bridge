/**
 * OpenGraph.io 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const extractSiteInput = z.strictObject({
  site: z.url().describe('The site URL to inspect.'),
  cacheOk: z.boolean().describe('Whether cached results may be returned when available.').optional(),
  fullRender: z.boolean().describe('Whether the page should be rendered in a browser before extraction.').optional(),
  useProxy: z.boolean().describe('Whether a proxy should be used for the request.').optional(),
  usePremium: z.boolean().describe('Whether a residential proxy should be used when available.').optional(),
  useSuperior: z.boolean().describe('Whether a mobile-grade proxy should be used when available.').optional(),
  useAi: z.boolean().describe('Whether AI-enhanced metadata extraction should be enabled.').optional(),
  maxCacheAge: z.int().min(0).describe('The maximum accepted cache age in seconds.').optional(),
  acceptLang: z.string().min(1).describe('The Accept-Language header value sent to the target site.').optional(),
  autoProxy: z.boolean().describe('Whether OpenGraph.io may automatically decide whether to use a proxy.').optional(),
  autoRender: z.boolean().describe('Whether OpenGraph.io may automatically decide whether full rendering is needed.').optional(),
  retry: z.boolean().describe('Whether OpenGraph.io should retry with fallback transport strategies.').optional(),
  maxRetries: z.int().min(0).describe('The maximum number of retry attempts.').optional(),
  retryEscalate: z.boolean().describe('Whether retries may escalate to more expensive fallback strategies.').optional(),
  proxyCountry: z.string().min(1).describe('The ISO 3166-1 alpha-2 country code to use for proxy egress.').optional(),
}).describe('The input payload for extracting OpenGraph.io site metadata.')

export const extractSiteOutput = z.looseObject({
  hybridGraph: z.looseObject({}).describe('A loose JSON object returned by OpenGraph.io.').optional(),
  openGraph: z.looseObject({}).describe('A loose JSON object returned by OpenGraph.io.').optional(),
  twitterCard: z.looseObject({}).describe('A loose JSON object returned by OpenGraph.io.').optional(),
  htmlInferred: z.looseObject({}).describe('A loose JSON object returned by OpenGraph.io.').optional(),
  oEmbed: z.looseObject({}).describe('A loose JSON object returned by OpenGraph.io.').optional(),
  requestUrl: z.string().describe('The final URL that OpenGraph.io resolved after redirects.').optional(),
  requestInfo: z.looseObject({
    host: z.string().describe('The host that responded to the request.').optional(),
    redirects: z.int().describe('The number of redirects followed while fetching the URL.').optional(),
    responseCode: z.int().describe('The HTTP response code returned upstream.').optional(),
    responseContentType: z.string().describe('The upstream response Content-Type header when available.').optional(),
  }).describe('Information about the upstream request performed by OpenGraph.io.').optional(),
  cached: z.boolean().describe('Whether the result came from cache.').optional(),
  createdAt: z.string().describe('The ISO 8601 timestamp when the cached result was created.').nullable().optional(),
  retryInfo: z.looseObject({}).describe('A loose JSON object returned by OpenGraph.io.').optional(),
  aiSafety: z.looseObject({}).describe('A loose JSON object returned by OpenGraph.io.').optional(),
  domain: z.string().describe('The domain extracted from the requested URL.').optional(),
  tags: z.array(z.looseObject({}).describe('A loose JSON object returned by OpenGraph.io.')).describe('Additional tag-level extraction results when returned by the API.').optional(),
}).describe('The normalized metadata payload returned by the OpenGraph.io Site endpoint.')

export const scrapeSiteInput = z.strictObject({
  site: z.url().describe('The site URL to inspect.'),
  cacheOk: z.boolean().describe('Whether cached results may be returned when available.').optional(),
  fullRender: z.boolean().describe('Whether the page should be rendered in a browser before extraction.').optional(),
  useProxy: z.boolean().describe('Whether a proxy should be used for the request.').optional(),
  usePremium: z.boolean().describe('Whether a residential proxy should be used when available.').optional(),
  useSuperior: z.boolean().describe('Whether a mobile-grade proxy should be used when available.').optional(),
  useAi: z.boolean().describe('Whether AI-enhanced metadata extraction should be enabled.').optional(),
  maxCacheAge: z.int().min(0).describe('The maximum accepted cache age in seconds.').optional(),
  acceptLang: z.string().min(1).describe('The Accept-Language header value sent to the target site.').optional(),
  autoProxy: z.boolean().describe('Whether OpenGraph.io may automatically decide whether to use a proxy.').optional(),
  autoRender: z.boolean().describe('Whether OpenGraph.io may automatically decide whether full rendering is needed.').optional(),
  retry: z.boolean().describe('Whether OpenGraph.io should retry with fallback transport strategies.').optional(),
  maxRetries: z.int().min(0).describe('The maximum number of retry attempts.').optional(),
  retryEscalate: z.boolean().describe('Whether retries may escalate to more expensive fallback strategies.').optional(),
  proxyCountry: z.string().min(1).describe('The ISO 3166-1 alpha-2 country code to use for proxy egress.').optional(),
  scrape: z.boolean().describe('A reserved compatibility flag. The current official Site endpoint does not expose a separate scrape mode, so this value is ignored.').optional(),
}).describe('The input payload for retrieving OpenGraph.io site metadata.')

export const scrapeSiteOutput = z.looseObject({
  hybridGraph: z.looseObject({}).describe('A loose JSON object returned by OpenGraph.io.').optional(),
  openGraph: z.looseObject({}).describe('A loose JSON object returned by OpenGraph.io.').optional(),
  twitterCard: z.looseObject({}).describe('A loose JSON object returned by OpenGraph.io.').optional(),
  htmlInferred: z.looseObject({}).describe('A loose JSON object returned by OpenGraph.io.').optional(),
  oEmbed: z.looseObject({}).describe('A loose JSON object returned by OpenGraph.io.').optional(),
  requestUrl: z.string().describe('The final URL that OpenGraph.io resolved after redirects.').optional(),
  requestInfo: z.looseObject({
    host: z.string().describe('The host that responded to the request.').optional(),
    redirects: z.int().describe('The number of redirects followed while fetching the URL.').optional(),
    responseCode: z.int().describe('The HTTP response code returned upstream.').optional(),
    responseContentType: z.string().describe('The upstream response Content-Type header when available.').optional(),
  }).describe('Information about the upstream request performed by OpenGraph.io.').optional(),
  cached: z.boolean().describe('Whether the result came from cache.').optional(),
  createdAt: z.string().describe('The ISO 8601 timestamp when the cached result was created.').nullable().optional(),
  retryInfo: z.looseObject({}).describe('A loose JSON object returned by OpenGraph.io.').optional(),
  aiSafety: z.looseObject({}).describe('A loose JSON object returned by OpenGraph.io.').optional(),
  domain: z.string().describe('The domain extracted from the requested URL.').optional(),
  tags: z.array(z.looseObject({}).describe('A loose JSON object returned by OpenGraph.io.')).describe('Additional tag-level extraction results when returned by the API.').optional(),
}).describe('The normalized metadata payload returned by the OpenGraph.io Site endpoint.')

export const scrapeUrlInput = z.strictObject({
  url: z.url().describe('The page URL to scrape for raw HTML.'),
  cacheOk: z.boolean().describe('Whether cached results may be returned when available.').optional(),
  fullRender: z.boolean().describe('Whether the page should be rendered in a browser before scraping.').optional(),
  useProxy: z.boolean().describe('Whether a proxy should be used for the request.').optional(),
  usePremium: z.boolean().describe('Whether a residential proxy should be used when available.').optional(),
  useSuperior: z.boolean().describe('Whether a mobile-grade proxy should be used when available.').optional(),
  acceptLang: z.string().min(1).describe('The Accept-Language header value sent to the target site.').optional(),
  autoProxy: z.boolean().describe('Whether OpenGraph.io may automatically decide whether to use a proxy.').optional(),
  autoRender: z.boolean().describe('Whether OpenGraph.io may automatically decide whether full rendering is needed.').optional(),
  retry: z.boolean().describe('Whether OpenGraph.io should retry with fallback transport strategies.').optional(),
}).describe('The input payload for scraping a URL with OpenGraph.io.')

export const scrapeUrlOutput = z.looseObject({
  htmlContent: z.string().describe('The raw HTML content returned for the page.').optional(),
  requestInfo: z.looseObject({
    host: z.string().describe('The host that responded to the request.').optional(),
    redirects: z.int().describe('The number of redirects followed while fetching the URL.').optional(),
    responseCode: z.int().describe('The HTTP response code returned upstream.').optional(),
    responseContentType: z.string().describe('The upstream response Content-Type header when available.').optional(),
  }).describe('Information about the upstream request performed by OpenGraph.io.').optional(),
  retryInfo: z.looseObject({}).describe('A loose JSON object returned by OpenGraph.io.').optional(),
}).describe('The normalized output payload returned by the OpenGraph.io Scrape endpoint.')

export const captureScreenshotInput = z.strictObject({
  url: z.url().describe('The page URL to capture as an image.'),
  format: z.enum(['jpeg', 'png', 'webp']).describe('The output image format.').optional(),
  quality: z.int().min(10).max(80).describe('The image quality from 10 to 80.').optional(),
  cacheOk: z.boolean().describe('Whether cached screenshots may be returned when available.').optional(),
  selector: z.string().min(1).describe('An optional CSS selector that limits the capture to a specific element.').optional(),
  darkMode: z.boolean().describe('Whether the page should be rendered with a dark color-scheme preference.').optional(),
  fullPage: z.boolean().describe('Whether the entire scrollable page should be captured.').optional(),
  useProxy: z.boolean().describe('Whether a proxy should be used for the request.').optional(),
  dimensions: z.enum(['xs', 'sm', 'md', 'lg']).describe('A viewport size preset.').optional(),
  captureDelay: z.int().min(0).max(10000).describe('The delay in milliseconds before taking the screenshot.').optional(),
  excludeSelectors: z.string().min(1).describe('Comma-separated CSS selectors for elements that should be hidden.').optional(),
  navigationTimeout: z.int().min(1000).max(60000).describe('The navigation timeout in milliseconds.').optional(),
  blockCookieBanner: z.boolean().describe('Whether known cookie consent banners should be blocked.').optional(),
}).describe('The input payload for capturing a screenshot with OpenGraph.io.')

export const captureScreenshotOutput = z.looseObject({
  screenshotUrl: z.url().describe('The URL of the generated screenshot image.').optional(),
  dimensions: z.strictObject({
    width: z.int().describe('The screenshot width in pixels.').optional(),
    height: z.int().describe('The screenshot height in pixels.').optional(),
  }).describe('The dimensions of the captured screenshot.').optional(),
  requestInfo: z.looseObject({
    host: z.string().describe('The host that responded to the request.').optional(),
    redirects: z.int().describe('The number of redirects followed while fetching the URL.').optional(),
    responseCode: z.int().describe('The HTTP response code returned upstream.').optional(),
    responseContentType: z.string().describe('The upstream response Content-Type header when available.').optional(),
  }).describe('Information about the upstream request performed by OpenGraph.io.').optional(),
}).describe('The normalized output payload returned by the OpenGraph.io Screenshot endpoint.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const opengraphIoActions = {
  extract_site: {
    description: 'Extract Open Graph, Twitter Card, oEmbed, and inferred metadata for a site through the OpenGraph.io Site endpoint.',
    effect: 'write',
    inputSchema: extractSiteInput,
    outputSchema: z.toJSONSchema(extractSiteOutput, { io: 'output', unrepresentable: 'any' }),
  },
  scrape_site: {
    description: 'Retrieve a site\'s metadata through the OpenGraph.io Site endpoint with cache, proxy, render, and retry controls.',
    effect: 'write',
    inputSchema: scrapeSiteInput,
    outputSchema: z.toJSONSchema(scrapeSiteOutput, { io: 'output', unrepresentable: 'any' }),
  },
  scrape_url: {
    description: 'Fetch the raw HTML for a page through the OpenGraph.io Scrape endpoint with optional render and proxy controls.',
    effect: 'write',
    inputSchema: scrapeUrlInput,
    outputSchema: z.toJSONSchema(scrapeUrlOutput, { io: 'output', unrepresentable: 'any' }),
  },
  capture_screenshot: {
    description: 'Capture a webpage screenshot through the OpenGraph.io Screenshot endpoint with configurable viewport, delay, and element selection.',
    effect: 'write',
    inputSchema: captureScreenshotInput,
    outputSchema: z.toJSONSchema(captureScreenshotOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
