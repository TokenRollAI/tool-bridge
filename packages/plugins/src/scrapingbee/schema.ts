/**
 * ScrapingBee 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const fetchHtmlInput = z.strictObject({
  url: z.url().describe('The public URL to fetch with ScrapingBee.'),
  renderJs: z.boolean().describe('Whether ScrapingBee should render JavaScript before returning the page.').optional(),
  waitMs: z.int().min(0).describe('How many milliseconds ScrapingBee should wait before returning the page.').optional(),
  waitFor: z.string().min(1).describe('The CSS selector ScrapingBee should wait for before returning the page.').optional(),
  device: z.enum(['desktop', 'mobile']).describe('The device preset used for the request.').optional(),
  blockAds: z.boolean().describe('Whether ScrapingBee should block ads on the page.').optional(),
  blockResources: z.boolean().describe('Whether ScrapingBee should block images and CSS resources.').optional(),
  countryCode: z.string().min(2).max(2).describe('The two-letter country code used for request geolocation.').optional(),
  premiumProxy: z.boolean().describe('Whether ScrapingBee should use premium proxy routing.').optional(),
  stealthProxy: z.boolean().describe('Whether ScrapingBee should use stealth proxy routing.').optional(),
  transparentStatusCode: z.boolean().describe('Whether ScrapingBee should return the target page status code transparently.').optional(),
  retry: z.int().min(1).describe('How many times ScrapingBee should retry the request on failure.').optional(),
}).describe('The input payload for fetching page HTML with ScrapingBee.')

export const fetchHtmlOutput = z.strictObject({
  html: z.string().describe('The HTML content returned by ScrapingBee.'),
  statusCode: z.int().describe('The HTTP status code returned by ScrapingBee.'),
  contentType: z.string().describe('The content type returned by ScrapingBee.').optional(),
  initialStatusCode: z.int().describe('The original target page status code reported by ScrapingBee.').optional(),
  resolvedUrl: z.string().describe('The final resolved URL reported by ScrapingBee.').optional(),
  creditCost: z.number().describe('The request credit cost reported by ScrapingBee.').optional(),
}).describe('The output payload for fetching page HTML with ScrapingBee.')

export const extractDataInput = z.strictObject({
  url: z.url().describe('The public URL to extract data from with ScrapingBee.'),
  extractRules: z.record(z.string(), z.unknown().describe('A JSON-compatible value used in ScrapingBee extraction rules or responses.')).describe('The extraction rules object serialized into the extract_rules query parameter.'),
  renderJs: z.boolean().describe('Whether ScrapingBee should render JavaScript before returning the page.').optional(),
  waitMs: z.int().min(0).describe('How many milliseconds ScrapingBee should wait before returning the page.').optional(),
  waitFor: z.string().min(1).describe('The CSS selector ScrapingBee should wait for before returning the page.').optional(),
  device: z.enum(['desktop', 'mobile']).describe('The device preset used for the request.').optional(),
  blockAds: z.boolean().describe('Whether ScrapingBee should block ads on the page.').optional(),
  blockResources: z.boolean().describe('Whether ScrapingBee should block images and CSS resources.').optional(),
  countryCode: z.string().min(2).max(2).describe('The two-letter country code used for request geolocation.').optional(),
  premiumProxy: z.boolean().describe('Whether ScrapingBee should use premium proxy routing.').optional(),
  stealthProxy: z.boolean().describe('Whether ScrapingBee should use stealth proxy routing.').optional(),
  transparentStatusCode: z.boolean().describe('Whether ScrapingBee should return the target page status code transparently.').optional(),
  retry: z.int().min(1).describe('How many times ScrapingBee should retry the request on failure.').optional(),
}).describe('The input payload for extracting structured data with ScrapingBee.')

export const extractDataOutput = z.strictObject({
  data: z.record(z.string(), z.unknown().describe('A JSON-compatible value used in ScrapingBee extraction rules or responses.')).describe('The structured data object returned by ScrapingBee extract_rules.'),
  statusCode: z.int().describe('The HTTP status code returned by ScrapingBee.'),
  resolvedUrl: z.string().describe('The final resolved URL reported by ScrapingBee.').optional(),
  creditCost: z.number().describe('The request credit cost reported by ScrapingBee.').optional(),
}).describe('The output payload for extracting structured data with ScrapingBee.')

export const getUsageStatsInput = z.strictObject({}).describe('The input payload for retrieving ScrapingBee usage statistics.')

export const getUsageStatsOutput = z.strictObject({
  usage: z.strictObject({
    max_api_credit: z.int().describe('The maximum API credits available in the current billing period.').optional(),
    used_api_credit: z.int().describe('The API credits already consumed in the current billing period.').optional(),
    max_concurrency: z.int().describe('The maximum number of concurrent requests allowed.').optional(),
    current_concurrency: z.int().describe('The current number of concurrent requests in use.').optional(),
    renewal_subscription_date: z.string().describe('The renewal timestamp for the current subscription period.').optional(),
  }).describe('The current ScrapingBee usage snapshot.').optional(),
}).describe('The output payload for retrieving ScrapingBee usage statistics.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const scrapingbeeActions = {
  fetch_html: {
    description: 'Fetch HTML content from one public URL with optional rendering and proxy controls.',
    effect: 'read',
    inputSchema: fetchHtmlInput,
    outputSchema: z.toJSONSchema(fetchHtmlOutput, { io: 'output', unrepresentable: 'any' }),
  },
  extract_data: {
    description: 'Extract structured JSON data from one public URL with ScrapingBee extract_rules.',
    effect: 'write',
    inputSchema: extractDataInput,
    outputSchema: z.toJSONSchema(extractDataOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_usage_stats: {
    description: 'Retrieve the current ScrapingBee API usage and concurrency statistics.',
    effect: 'read',
    inputSchema: getUsageStatsInput,
    outputSchema: z.toJSONSchema(getUsageStatsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
