/**
 * Riveter 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getAccountInput = z.strictObject({}).describe('The input payload for retrieving the Riveter account.')

export const getAccountOutput = z.strictObject({
  account: z.strictObject({
    uuid: z.uuid().describe('The unique identifier for the account.').optional(),
    name: z.string().describe('The account name.').optional(),
    plan: z.enum(['free', 'starter', 'advanced', 'pro', 'enterprise']).describe('The current billing plan.').optional(),
    credit: z.strictObject({
      count: z.int().describe('The current credit count.').optional(),
      max: z.int().describe('The maximum credits available.').optional(),
      balance: z.int().describe('The remaining credit balance.').optional(),
    }).describe('The Riveter credit balance for the account.').optional(),
  }).describe('The Riveter account associated with the API key.').optional(),
  api_key_info: z.strictObject({
    name: z.string().describe('The name of the API key.').optional(),
    last_used_at: z.iso.datetime({ offset: true }).describe('When the API key was last used.').nullable().optional(),
    created_by: z.strictObject({
      uuid: z.uuid().describe('The user\'s unique identifier.').optional(),
      name: z.string().describe('The user\'s full name.').optional(),
      email: z.email().describe('The user\'s email address.').optional(),
    }).describe('The Riveter user who created the API key.').optional(),
  }).describe('Details about the Riveter API key used for this request.').optional(),
}).describe('The Riveter account response.')

export const scrapeInput = z.strictObject({
  url: z.url().describe('The public webpage URL to scrape.'),
  proxy_country_code: z.string().regex(new RegExp('^[a-z]{2}$')).describe('The two-character country code for proxy routing.').optional(),
  skip_cache: z.boolean().describe('Whether to bypass cached scrape results and fetch fresh content.').optional(),
}).describe('The input payload for scraping a webpage with Riveter.')

export const scrapeOutput = z.strictObject({
  request_status: z.enum(['success', 'error']).describe('The status of the scrape request.').optional(),
  message: z.string().describe('The human-readable response message.').optional(),
  run_key: z.string().describe('The unique identifier for this scrape run.').optional(),
  data: z.strictObject({
    url: z.url().describe('The URL that was scraped.'),
    text: z.string().describe('The extracted text content from the webpage.'),
    base_url_for_links: z.url().describe('The base URL for resolving relative links.'),
    status_code: z.int().describe('The HTTP status code returned by the webpage server.').optional(),
    possibly_blocked: z.boolean().describe('Whether Riveter detected that the page may be blocked by anti-scraping measures.').optional(),
    credit_used: z.number().describe('The number of Riveter credits consumed by the scrape.'),
    riveter_app_link: z.url().describe('The direct link to view this scrape in the Riveter application.'),
    raw: z.looseObject({}).describe('The raw scrape data object returned by Riveter.'),
  }).describe('The extracted webpage payload returned by Riveter.').optional(),
}).describe('The Riveter scrape response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const riveterActions = {
  get_account: {
    description: 'Retrieve the Riveter account and API key details for the connected API key.',
    effect: 'read',
    inputSchema: getAccountInput,
    outputSchema: z.toJSONSchema(getAccountOutput, { io: 'output', unrepresentable: 'any' }),
  },
  scrape: {
    description: 'Scrape a public webpage with Riveter and return extracted text content.',
    effect: 'write',
    inputSchema: scrapeInput,
    outputSchema: z.toJSONSchema(scrapeOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
