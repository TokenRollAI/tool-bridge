/**
 * Brave Search 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const webSearchInput = z.strictObject({
  q: z.string().min(1).max(400).describe('The user\'s search query term. Maximum of 400 characters.'),
  search_lang: z.string().min(2).describe('The preferred search result language code.').optional(),
  ui_lang: z.string().min(2).describe('The preferred user interface language for response formatting.').optional(),
  country: z.string().min(2).max(3).describe('The two-letter country code for result localization, or ALL for worldwide results.').optional(),
  safesearch: z.enum(['off', 'moderate', 'strict']).describe('Filters adult content from web results.').optional(),
  count: z.int().min(1).max(20).describe('The maximum number of web results to return.').optional(),
  offset: z.int().min(0).max(9).describe('The zero-based results page offset used for pagination.').optional(),
  spellcheck: z.boolean().describe('Whether Brave Search should spellcheck the query before searching.').optional(),
  freshness: z.union([z.enum(['pd', 'pw', 'pm', 'py']).describe('A predefined freshness window such as past day or past year.'), z.string().min(1).describe('A custom date range in the format YYYY-MM-DDtoYYYY-MM-DD.')]).describe('Filters web results by page age.').optional(),
  result_filter: z.string().min(1).describe('A comma-delimited list of result types to include, such as web,news,videos,locations,discussions,faq,infobox,mixed,summarizer or rich.').optional(),
  extra_snippets: z.boolean().describe('Whether Brave Search should return extra alternate snippets.').optional(),
  goggles: z.union([z.string().min(1).describe('One goggle URL or inline definition.'), z.array(z.string().min(1).describe('One goggle URL or inline definition.')).min(1).describe('Multiple goggles to apply to the search request.')]).describe('One or more Brave Search goggles used to rerank results.').optional(),
  text_decorations: z.boolean().describe('Whether display strings should include decoration markers such as highlights.').optional(),
  units: z.enum(['metric', 'imperial']).describe('The measurement units used for localized results.').optional(),
  operators: z.boolean().describe('Whether Brave Search should apply search operators.').optional(),
  include_fetch_metadata: z.boolean().describe('Whether Brave Search should include fetch metadata in results when available.').optional(),
}).describe('Input parameters for a Brave Search web search request.')

export const webSearchOutput = z.strictObject({
  type: z.string().describe('The Brave Search response type.'),
  query: z.looseObject({}).describe('Query metadata returned by Brave Search.').nullable().optional(),
  web: z.looseObject({}).describe('Web result payload returned by Brave Search.').nullable().optional(),
  news: z.looseObject({}).describe('News result payload returned by Brave Search.').nullable().optional(),
  videos: z.looseObject({}).describe('Video result payload returned by Brave Search.').nullable().optional(),
  locations: z.looseObject({}).describe('Location result payload returned by Brave Search.').nullable().optional(),
  discussions: z.looseObject({}).describe('Discussion clusters returned by Brave Search.').nullable().optional(),
  faq: z.looseObject({}).describe('Frequently asked questions returned by Brave Search.').nullable().optional(),
  infobox: z.looseObject({}).describe('Infobox payload returned by Brave Search.').nullable().optional(),
  mixed: z.looseObject({}).describe('Mixed ranking payload returned by Brave Search.').nullable().optional(),
  summarizer: z.looseObject({}).describe('Summary metadata returned by Brave Search.').nullable().optional(),
  rich: z.looseObject({}).describe('Rich result callback payload returned by Brave Search.').nullable().optional(),
}).describe('A normalized Brave Search web search response.')

export const newsSearchInput = z.strictObject({
  q: z.string().min(1).max(400).describe('The user\'s search query term. Maximum of 400 characters.'),
  search_lang: z.string().min(2).describe('The preferred search result language code.').optional(),
  ui_lang: z.string().min(2).describe('The preferred user interface language for response formatting.').optional(),
  country: z.string().min(2).max(3).describe('The two-letter country code for result localization, or ALL for worldwide results.').optional(),
  safesearch: z.enum(['off', 'moderate', 'strict']).describe('Filters adult content from news results.').optional(),
  count: z.int().min(1).max(50).describe('The maximum number of results to return.').optional(),
  offset: z.int().min(0).max(9).describe('The zero-based results page offset used for pagination.').optional(),
  spellcheck: z.boolean().describe('Whether Brave Search should spellcheck the query before searching.').optional(),
  freshness: z.union([z.enum(['pd', 'pw', 'pm', 'py']).describe('A predefined freshness window such as past day or past year.'), z.string().min(1).describe('A custom date range in the format YYYY-MM-DDtoYYYY-MM-DD.')]).describe('Filters news results by page age.').optional(),
  extra_snippets: z.boolean().describe('Whether Brave Search should return extra alternate snippets.').optional(),
  goggles: z.union([z.string().min(1).describe('One goggle URL or inline definition.'), z.array(z.string().min(1).describe('One goggle URL or inline definition.')).min(1).describe('Multiple goggles to apply to the search request.')]).describe('One or more Brave Search goggles used to rerank results.').optional(),
  operators: z.boolean().describe('Whether Brave Search should apply search operators.').optional(),
  include_fetch_metadata: z.boolean().describe('Whether Brave Search should include fetch metadata in results when available.').optional(),
}).describe('Input parameters for a Brave Search news request.')

export const newsSearchOutput = z.strictObject({
  type: z.string().describe('The Brave Search response type.'),
  query: z.looseObject({}).describe('Query metadata returned by Brave Search.').nullable().optional(),
  results: z.array(z.looseObject({}).describe('One news result item returned by Brave Search.')).describe('The list of news results returned by Brave Search.').optional(),
}).describe('A normalized Brave Search news response.')

export const videoSearchInput = z.strictObject({
  q: z.string().min(1).max(400).describe('The user\'s search query term. Maximum of 400 characters.'),
  search_lang: z.string().min(2).describe('The preferred search result language code.').optional(),
  ui_lang: z.string().min(2).describe('The preferred user interface language for response formatting.').optional(),
  country: z.string().min(2).max(3).describe('The two-letter country code for result localization, or ALL for worldwide results.').optional(),
  safesearch: z.enum(['off', 'moderate', 'strict']).describe('Filters adult content from video results.').optional(),
  count: z.int().min(1).max(50).describe('The maximum number of results to return.').optional(),
  offset: z.int().min(0).max(9).describe('The zero-based results page offset used for pagination.').optional(),
  spellcheck: z.boolean().describe('Whether Brave Search should spellcheck the query before searching.').optional(),
  freshness: z.union([z.enum(['pd', 'pw', 'pm', 'py']).describe('A predefined freshness window such as past day or past year.'), z.string().min(1).describe('A custom date range in the format YYYY-MM-DDtoYYYY-MM-DD.')]).describe('Filters video results by page age.').optional(),
  operators: z.boolean().describe('Whether Brave Search should apply search operators.').optional(),
  include_fetch_metadata: z.boolean().describe('Whether Brave Search should include fetch metadata in results when available.').optional(),
}).describe('Input parameters for a Brave Search video request.')

export const videoSearchOutput = z.strictObject({
  type: z.string().describe('The Brave Search response type.'),
  query: z.looseObject({}).describe('Query metadata returned by Brave Search.').nullable().optional(),
  results: z.array(z.looseObject({}).describe('One video result item returned by Brave Search.')).describe('The list of video results returned by Brave Search.').optional(),
  extra: z.looseObject({}).describe('Additional metadata returned with the video results.').nullable().optional(),
}).describe('A normalized Brave Search video response.')

export const imageSearchInput = z.strictObject({
  q: z.string().min(1).max(400).describe('The user\'s search query term. Maximum of 400 characters.'),
  search_lang: z.string().min(2).describe('The preferred search result language code.').optional(),
  country: z.string().min(2).max(3).describe('The two-letter country code for result localization, or ALL for worldwide results.').optional(),
  safesearch: z.enum(['off', 'strict']).describe('Filters adult content from image results.').optional(),
  count: z.int().min(1).max(200).describe('The maximum number of image results to return.').optional(),
  spellcheck: z.boolean().describe('Whether Brave Search should spellcheck the query before searching.').optional(),
}).describe('Input parameters for a Brave Search image request.')

export const imageSearchOutput = z.strictObject({
  type: z.string().describe('The Brave Search response type.'),
  query: z.looseObject({}).describe('Query metadata returned by Brave Search.').nullable().optional(),
  results: z.array(z.looseObject({}).describe('One image result item returned by Brave Search.')).describe('The list of image results returned by Brave Search.').optional(),
  extra: z.looseObject({}).describe('Additional metadata returned with the image results.').nullable().optional(),
}).describe('A normalized Brave Search image response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const braveSearchActions = {
  web_search: {
    description: 'Search the Brave Search web index and return the selected result families.',
    effect: 'write',
    inputSchema: webSearchInput,
    outputSchema: z.toJSONSchema(webSearchOutput, { io: 'output', unrepresentable: 'any' }),
  },
  news_search: {
    description: 'Search Brave\'s news index for recent articles related to a query.',
    effect: 'write',
    inputSchema: newsSearchInput,
    outputSchema: z.toJSONSchema(newsSearchOutput, { io: 'output', unrepresentable: 'any' }),
  },
  video_search: {
    description: 'Search Brave\'s video index for videos related to a query.',
    effect: 'write',
    inputSchema: videoSearchInput,
    outputSchema: z.toJSONSchema(videoSearchOutput, { io: 'output', unrepresentable: 'any' }),
  },
  image_search: {
    description: 'Search Brave\'s image index for images related to a query.',
    effect: 'write',
    inputSchema: imageSearchInput,
    outputSchema: z.toJSONSchema(imageSearchOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
