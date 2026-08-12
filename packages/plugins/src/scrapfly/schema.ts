/**
 * Scrapfly 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const scrapeInput = z.strictObject({
  url: z.url().describe('The public URL Scrapfly should scrape.'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'HEAD', 'OPTIONS']).describe('The HTTP method Scrapfly should use against the target URL.').optional(),
  body: z.string().describe('The raw request body Scrapfly should send to the target URL.').optional(),
  content_type: z.string().min(1).describe('The Content-Type header for the target request body.').optional(),
  format: z.string().min(1).describe('The content format Scrapfly should return.').optional(),
  country: z.string().min(2).describe('The proxy country selection accepted by Scrapfly, such as us, us,ca,mx, or -gb.').optional(),
  proxy_pool: z.enum(['public_datacenter_pool', 'public_residential_pool']).describe('The Scrapfly proxy pool to use for the scrape.').optional(),
  render_js: z.boolean().describe('Whether Scrapfly should render JavaScript before returning.').optional(),
  asp: z.boolean().describe('Whether Scrapfly should enable Anti Scraping Protection.').optional(),
  retry: z.boolean().describe('Whether Scrapfly should retry the scrape request.').optional(),
  timeout: z.int().min(1000).max(150000).describe('The scrape timeout in milliseconds.').optional(),
  wait_for_selector: z.string().min(1).describe('The CSS selector Scrapfly should wait for before returning content.').optional(),
  cache: z.boolean().describe('Whether Scrapfly should use cached scrape results when available.').optional(),
  cache_ttl: z.int().min(1).describe('The cache time-to-live in seconds.').optional(),
  cache_clear: z.boolean().describe('Whether Scrapfly should clear any matching cached result.').optional(),
  session: z.string().min(1).max(255).describe('The Scrapfly session name used to keep browsing state.').optional(),
  session_sticky_proxy: z.boolean().describe('Whether Scrapfly should keep the session proxy sticky.').optional(),
  headers: z.record(z.string(), z.string().describe('A target request header value.')).describe('Target request headers Scrapfly should send to the scraped website.').optional(),
  tags: z.array(z.string().min(1).describe('One Scrapfly monitoring tag.')).describe('Tags for grouping the scrape in Scrapfly monitoring.').optional(),
  correlation_id: z.string().min(1).describe('A caller-provided correlation identifier for monitoring.').optional(),
  debug: z.boolean().describe('Whether Scrapfly should expose debug data for the scrape.').optional(),
}).describe('The input payload for scraping a URL with Scrapfly.')

export const scrapeOutput = z.strictObject({
  result: z.looseObject({
    content: z.unknown().describe('The scraped content, a large object URL, or encoded binary content.'),
    status_code: z.int().describe('The HTTP status code returned by the target website.'),
    format: z.string().describe('The Scrapfly result content format.'),
  }).describe('The result object returned by Scrapfly.').optional(),
  config: z.looseObject({}).describe('The scrape configuration returned by Scrapfly.').optional(),
  context: z.looseObject({}).describe('Additional context returned by Scrapfly.').optional(),
  metadata: z.strictObject({
    status_code: z.int().describe('The HTTP status code returned by Scrapfly.').optional(),
    api_cost: z.int().describe('The API credit cost reported by Scrapfly.').nullable().optional(),
    remaining_api_credit: z.int().describe('Remaining API credit reported by Scrapfly.').nullable().optional(),
    reject_code: z.string().describe('The Scrapfly reject code when a scrape is rejected.').nullable().optional(),
    reject_description: z.string().describe('The Scrapfly reject documentation URL when a scrape is rejected.').nullable().optional(),
    reject_retryable: z.string().describe('Whether Scrapfly reported the rejection as retryable.').nullable().optional(),
  }).describe('Metadata collected from Scrapfly response headers.').optional(),
  headers: z.record(z.string(), z.string().describe('One response header value.')).describe('Response headers returned by Scrapfly.').optional(),
}).describe('The response returned when scraping with Scrapfly.')

export const getMonitoringMetricsInput = z.strictObject({
  aggregation: z.string().min(1).describe('The metrics aggregation list accepted by Scrapfly, such as account, project, or account,project,target.').optional(),
  period: z.enum(['last5m', 'last1h', 'last7d', 'last24h', 'subscription']).describe('The monitoring period to retrieve.').optional(),
  start: z.string().min(1).describe('The UTC start date accepted by Scrapfly when period is omitted.').optional(),
  end: z.string().min(1).describe('The UTC end date accepted by Scrapfly when period is omitted.').optional(),
  group_subdomain: z.boolean().describe('Whether target aggregation should group subdomains.').optional(),
}).describe('The input payload for retrieving Scrapfly monitoring metrics.')

export const getMonitoringMetricsOutput = z.strictObject({
  metrics: z.looseObject({}).describe('Monitoring metrics returned by Scrapfly.').optional(),
  metadata: z.strictObject({
    status_code: z.int().describe('The HTTP status code returned by Scrapfly.').optional(),
    api_cost: z.int().describe('The API credit cost reported by Scrapfly.').nullable().optional(),
    remaining_api_credit: z.int().describe('Remaining API credit reported by Scrapfly.').nullable().optional(),
    reject_code: z.string().describe('The Scrapfly reject code when a scrape is rejected.').nullable().optional(),
    reject_description: z.string().describe('The Scrapfly reject documentation URL when a scrape is rejected.').nullable().optional(),
    reject_retryable: z.string().describe('Whether Scrapfly reported the rejection as retryable.').nullable().optional(),
  }).describe('Metadata collected from Scrapfly response headers.').optional(),
  headers: z.record(z.string(), z.string().describe('One response header value.')).describe('Response headers returned by Scrapfly.').optional(),
}).describe('The response returned when retrieving Scrapfly monitoring metrics.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const scrapflyActions = {
  scrape: {
    description: 'Scrape one public URL through Scrapfly and return the documented JSON response envelope.',
    effect: 'write',
    inputSchema: scrapeInput,
    outputSchema: z.toJSONSchema(scrapeOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_monitoring_metrics: {
    description: 'Retrieve Scrapfly monitoring metrics for the connected API key.',
    effect: 'read',
    inputSchema: getMonitoringMetricsInput,
    outputSchema: z.toJSONSchema(getMonitoringMetricsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
