/**
 * Prerender 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const recacheUrlsInput = z.strictObject({
  urls: z.array(z.url().describe('One public URL to cache or recache.')).min(1).describe('The public URLs to cache or recache.'),
  adaptiveType: z.enum(['mobile', 'desktop']).describe('The Prerender adaptive cache type to target.').optional(),
}).describe('The input payload for queueing one or more Prerender recache URLs.')

export const recacheUrlsOutput = z.strictObject({
  accepted: z.boolean().describe('Whether Prerender accepted the request.').optional(),
  raw: z.unknown().describe('The raw Prerender response payload when one was returned.').nullable().optional(),
}).describe('The normalized result for a successful Prerender write request.')

export const addSitemapInput = z.strictObject({
  url: z.url().describe('The sitemap XML URL to submit to Prerender.').optional(),
}).describe('The input payload for submitting a sitemap to Prerender.')

export const addSitemapOutput = z.strictObject({
  accepted: z.boolean().describe('Whether Prerender accepted the request.').optional(),
  raw: z.unknown().describe('The raw Prerender response payload when one was returned.').nullable().optional(),
}).describe('The normalized result for a successful Prerender write request.')

export const clearCacheInput = z.strictObject({
  query: z.string().min(1).regex(new RegExp('\\S')).describe('The wildcard query used to match cached URLs to clear, such as https://example.com%.').optional(),
}).describe('The input payload for queueing a Prerender cache clear request.')

export const clearCacheOutput = z.strictObject({
  status: z.enum(['queued', 'in_progress']).describe('The cache clear job state reported by Prerender.').optional(),
  raw: z.unknown().describe('The raw Prerender response payload when one was returned.').nullable().optional(),
}).describe('The normalized result returned by the Prerender cache clear API.')

export const getCacheClearStatusInput = z.strictObject({}).describe('This action does not require any input parameters.')

export const getCacheClearStatusOutput = z.strictObject({
  status: z.enum(['idle', 'in_progress']).describe('The current cache clear job state reported by Prerender.').optional(),
  raw: z.unknown().describe('The raw Prerender response payload when one was returned.').nullable().optional(),
}).describe('The normalized Prerender cache clear status response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const prerenderActions = {
  recache_urls: {
    description: 'Queue one or more URLs for first-time caching or recaching with the Prerender recache API.',
    effect: 'write',
    inputSchema: recacheUrlsInput,
    outputSchema: z.toJSONSchema(recacheUrlsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  add_sitemap: {
    description: 'Submit a sitemap XML URL to Prerender so it can discover and cache new URLs from that sitemap.',
    effect: 'write',
    inputSchema: addSitemapInput,
    outputSchema: z.toJSONSchema(addSitemapOutput, { io: 'output', unrepresentable: 'any' }),
  },
  clear_cache: {
    description: 'Queue a Prerender cache clear request for URLs matching a wildcard query pattern.',
    effect: 'write',
    inputSchema: clearCacheInput,
    outputSchema: z.toJSONSchema(clearCacheOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_cache_clear_status: {
    description: 'Check whether a Prerender cache clear job is currently running for the authenticated account.',
    effect: 'read',
    inputSchema: getCacheClearStatusInput,
    outputSchema: z.toJSONSchema(getCacheClearStatusOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
