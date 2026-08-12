/**
 * Exa 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const searchInput = z.strictObject({
  query: z.string().min(1).describe('The search query to send to Exa.'),
  additionalQueries: z.array(z.string().min(1)).min(1).describe('Additional query variations to use with deep or deep-reasoning search.').optional(),
  type: z.enum(['neural', 'fast', 'auto', 'deep', 'deep-reasoning', 'instant']).describe('The Exa search mode to execute.').optional(),
  category: z.enum(['company', 'research paper', 'news', 'pdf', 'github', 'personal site', 'people', 'financial report']).describe('The Exa category used to narrow search results.').optional(),
  numResults: z.int().min(1).max(100).describe('The number of search results to return, up to 100.').optional(),
  userLocation: z.string().min(2).max(2).describe('A two-letter ISO country code used to localize search results.').optional(),
  includeDomains: z.array(z.string().min(1)).min(1).describe('Only return results from these domains.').optional(),
  excludeDomains: z.array(z.string().min(1)).min(1).describe('Exclude results from these domains.').optional(),
  startCrawlDate: z.iso.datetime({ offset: true }).describe('Only return results crawled after this timestamp.').optional(),
  endCrawlDate: z.iso.datetime({ offset: true }).describe('Only return results crawled before this timestamp.').optional(),
  startPublishedDate: z.iso.datetime({ offset: true }).describe('Only return results published after this timestamp.').optional(),
  endPublishedDate: z.iso.datetime({ offset: true }).describe('Only return results published before this timestamp.').optional(),
  includeText: z.array(z.string().min(1)).min(1).describe('Phrases that must appear in the result text.').optional(),
  excludeText: z.array(z.string().min(1)).min(1).describe('Phrases that must not appear in the result text.').optional(),
  moderation: z.boolean().describe('Whether Exa should filter unsafe content from results.').optional(),
  contents: z.strictObject({
    text: z.union([z.boolean().describe('Whether Exa should return extracted text.'), z.strictObject({
      maxCharacters: z.int().min(1).describe('The maximum number of characters to return for extracted text.').optional(),
      includeHtmlTags: z.boolean().describe('Whether Exa should preserve HTML tags in extracted text.').optional(),
      verbosity: z.enum(['compact', 'standard', 'full']).describe('The verbosity level for extracted page text.').optional(),
      includeSections: z.array(z.enum(['header', 'navigation', 'banner', 'body', 'sidebar', 'footer', 'metadata']).describe('A semantic page section used by Exa content extraction.')).min(1).describe('Only include content from these semantic page sections.').optional(),
      excludeSections: z.array(z.enum(['header', 'navigation', 'banner', 'body', 'sidebar', 'footer', 'metadata']).describe('A semantic page section used by Exa content extraction.')).min(1).describe('Exclude content from these semantic page sections.').optional(),
    }).describe('Advanced configuration for Exa text extraction.')]).optional(),
    highlights: z.union([z.boolean().describe('Whether Exa should return highlights.'), z.strictObject({
      maxCharacters: z.int().min(1).describe('The maximum number of characters to return across highlights.').optional(),
      numSentences: z.int().min(1).describe('Deprecated by Exa. The number of sentences to include in each highlight snippet.').optional(),
      highlightsPerUrl: z.int().min(1).describe('Deprecated by Exa. The number of highlight snippets to return per URL.').optional(),
      query: z.string().min(1).describe('A custom query that guides Exa highlight selection.').optional(),
    }).describe('Advanced configuration for Exa highlights.')]).optional(),
    summary: z.strictObject({
      query: z.string().min(1).describe('A custom query that guides Exa summary generation.').optional(),
      schema: z.looseObject({}).describe('A JSON Schema object used for structured Exa summaries.').optional(),
    }).describe('Configuration for an Exa summary response.').optional(),
    livecrawlTimeout: z.int().min(0).describe('The livecrawl timeout in milliseconds.').optional(),
    maxAgeHours: z.union([z.literal(-1), z.int().min(0).describe('A non-negative cache age in hours.')]).describe('Maximum age of cached content in hours. Use -1 to always use cache, 0 to always livecrawl, or a positive integer to require fresher content.').optional(),
    subpages: z.int().min(0).describe('The maximum number of subpages Exa should crawl per result.').optional(),
    subpageTarget: z.union([z.string().min(1).describe('A single keyword used to locate relevant subpages.'), z.array(z.string().min(1)).min(1).describe('A list of keywords used to locate relevant subpages.')]).describe('Keywords Exa should use when selecting subpages.').optional(),
    extras: z.strictObject({
      links: z.int().min(0).describe('The maximum number of webpage links to return for each result.').optional(),
      imageLinks: z.int().min(0).describe('The maximum number of image links to return for each result.').optional(),
    }).describe('Additional Exa extraction options.').optional(),
  }).describe('The Exa contents request object.').optional(),
}).describe('The input payload for an Exa search request. includeDomains and excludeDomains cannot be provided together.')

export const searchOutput = z.strictObject({
  requestId: z.string().describe('The unique identifier for this Exa request.'),
  results: z.array(z.looseObject({
    id: z.string().describe('The temporary Exa document identifier.').optional(),
    url: z.string().describe('The result URL.').optional(),
    title: z.string().describe('The result title.').optional(),
    publishedDate: z.string().describe('The estimated publication timestamp for the result.').nullable().optional(),
    author: z.string().describe('The result author.').nullable().optional(),
    score: z.number().describe('The result relevance score.').nullable().optional(),
  }).describe('An Exa search or contents result object.')).describe('The Exa search results.'),
  searchType: z.string().describe('The search type Exa selected for the request.').optional(),
  output: z.looseObject({}).describe('The Exa deep search output object.').optional(),
  costDollars: z.looseObject({
    total: z.number().describe('The total request cost in US dollars.').optional(),
  }).describe('The Exa costDollars object.').optional(),
}).describe('The response payload for exa.search.')

export const getContentsInput = z.strictObject({
  urls: z.array(z.url().describe('One URL to retrieve content for.')).min(1).describe('The list of URLs to retrieve content for.'),
  ids: z.array(z.string().min(1)).min(1).describe('Deprecated. A backward-compatibility list of Exa document IDs.').optional(),
  text: z.union([z.boolean().describe('Whether Exa should return extracted text.'), z.strictObject({
    maxCharacters: z.int().min(1).describe('The maximum number of characters to return for extracted text.').optional(),
    includeHtmlTags: z.boolean().describe('Whether Exa should preserve HTML tags in extracted text.').optional(),
    verbosity: z.enum(['compact', 'standard', 'full']).describe('The verbosity level for extracted page text.').optional(),
    includeSections: z.array(z.enum(['header', 'navigation', 'banner', 'body', 'sidebar', 'footer', 'metadata']).describe('A semantic page section used by Exa content extraction.')).min(1).describe('Only include content from these semantic page sections.').optional(),
    excludeSections: z.array(z.enum(['header', 'navigation', 'banner', 'body', 'sidebar', 'footer', 'metadata']).describe('A semantic page section used by Exa content extraction.')).min(1).describe('Exclude content from these semantic page sections.').optional(),
  }).describe('Advanced configuration for Exa text extraction.')]).optional(),
  highlights: z.union([z.boolean().describe('Whether Exa should return highlights.'), z.strictObject({
    maxCharacters: z.int().min(1).describe('The maximum number of characters to return across highlights.').optional(),
    numSentences: z.int().min(1).describe('Deprecated by Exa. The number of sentences to include in each highlight snippet.').optional(),
    highlightsPerUrl: z.int().min(1).describe('Deprecated by Exa. The number of highlight snippets to return per URL.').optional(),
    query: z.string().min(1).describe('A custom query that guides Exa highlight selection.').optional(),
  }).describe('Advanced configuration for Exa highlights.')]).optional(),
  summary: z.strictObject({
    query: z.string().min(1).describe('A custom query that guides Exa summary generation.').optional(),
    schema: z.looseObject({}).describe('A JSON Schema object used for structured Exa summaries.').optional(),
  }).describe('Configuration for an Exa summary response.').optional(),
  livecrawlTimeout: z.int().min(0).describe('The livecrawl timeout in milliseconds.').optional(),
  maxAgeHours: z.union([z.literal(-1), z.int().min(0).describe('A non-negative cache age in hours.')]).describe('Maximum age of cached content in hours. Use -1 to always use cache, 0 to always livecrawl, or a positive integer to require fresher content.').optional(),
  subpages: z.int().min(0).describe('The maximum number of subpages Exa should crawl per result.').optional(),
  subpageTarget: z.union([z.string().min(1).describe('A single keyword used to locate relevant subpages.'), z.array(z.string().min(1)).min(1).describe('A list of keywords used to locate relevant subpages.')]).describe('Keywords Exa should use when selecting subpages.').optional(),
  extras: z.strictObject({
    links: z.int().min(0).describe('The maximum number of webpage links to return for each result.').optional(),
    imageLinks: z.int().min(0).describe('The maximum number of image links to return for each result.').optional(),
  }).describe('Additional Exa extraction options.').optional(),
}).describe('The input payload for fetching Exa contents by URL.')

export const getContentsOutput = z.strictObject({
  requestId: z.string().describe('The unique identifier for this Exa request.'),
  results: z.array(z.looseObject({
    id: z.string().describe('The temporary Exa document identifier.').optional(),
    url: z.string().describe('The result URL.').optional(),
    title: z.string().describe('The result title.').optional(),
    publishedDate: z.string().describe('The estimated publication timestamp for the result.').nullable().optional(),
    author: z.string().describe('The result author.').nullable().optional(),
    score: z.number().describe('The result relevance score.').nullable().optional(),
  }).describe('An Exa search or contents result object.')).describe('The Exa content results returned successfully.'),
  statuses: z.array(z.looseObject({}).describe('One Exa content status.')).describe('The fetch status for each requested input item.').optional(),
  costDollars: z.looseObject({
    total: z.number().describe('The total request cost in US dollars.').optional(),
  }).describe('The Exa costDollars object.').optional(),
}).describe('The response payload for exa.get_contents.')

export const answerInput = z.strictObject({
  query: z.string().min(1).describe('The question or prompt Exa should answer.'),
  text: z.boolean().describe('Whether citations should include the full source text.').optional(),
}).describe('The input payload for an Exa answer request.')

export const answerOutput = z.strictObject({
  answer: z.union([z.string().describe('The text answer returned by Exa.'), z.looseObject({}).describe('The structured answer returned by Exa.')]).optional(),
  citations: z.array(z.looseObject({}).describe('An Exa answer citation.')).describe('The citations supporting the Exa answer.'),
  costDollars: z.looseObject({
    total: z.number().describe('The total request cost in US dollars.').optional(),
  }).describe('The Exa costDollars object.').optional(),
}).describe('The response payload for exa.answer.')

export const findSimilarInput = z.strictObject({
  url: z.url().describe('The URL used to find similar pages.'),
  excludeSourceDomain: z.boolean().describe('Whether to exclude results from the same domain as the input URL.').optional(),
  numResults: z.int().min(1).max(100).describe('The number of similar results to return, up to 100.').optional(),
  includeDomains: z.array(z.string().min(1)).min(1).describe('Only return results from these domains.').optional(),
  excludeDomains: z.array(z.string().min(1)).min(1).describe('Exclude results from these domains.').optional(),
  startCrawlDate: z.iso.datetime({ offset: true }).describe('Only return results crawled after this timestamp.').optional(),
  endCrawlDate: z.iso.datetime({ offset: true }).describe('Only return results crawled before this timestamp.').optional(),
  startPublishedDate: z.iso.datetime({ offset: true }).describe('Only return results published after this timestamp.').optional(),
  endPublishedDate: z.iso.datetime({ offset: true }).describe('Only return results published before this timestamp.').optional(),
  includeText: z.array(z.string().min(1)).min(1).describe('Phrases that must appear in the result text.').optional(),
  excludeText: z.array(z.string().min(1)).min(1).describe('Phrases that must not appear in the result text.').optional(),
  moderation: z.boolean().describe('Whether Exa should filter unsafe content from results.').optional(),
  contents: z.strictObject({
    text: z.union([z.boolean().describe('Whether Exa should return extracted text.'), z.strictObject({
      maxCharacters: z.int().min(1).describe('The maximum number of characters to return for extracted text.').optional(),
      includeHtmlTags: z.boolean().describe('Whether Exa should preserve HTML tags in extracted text.').optional(),
      verbosity: z.enum(['compact', 'standard', 'full']).describe('The verbosity level for extracted page text.').optional(),
      includeSections: z.array(z.enum(['header', 'navigation', 'banner', 'body', 'sidebar', 'footer', 'metadata']).describe('A semantic page section used by Exa content extraction.')).min(1).describe('Only include content from these semantic page sections.').optional(),
      excludeSections: z.array(z.enum(['header', 'navigation', 'banner', 'body', 'sidebar', 'footer', 'metadata']).describe('A semantic page section used by Exa content extraction.')).min(1).describe('Exclude content from these semantic page sections.').optional(),
    }).describe('Advanced configuration for Exa text extraction.')]).optional(),
    highlights: z.union([z.boolean().describe('Whether Exa should return highlights.'), z.strictObject({
      maxCharacters: z.int().min(1).describe('The maximum number of characters to return across highlights.').optional(),
      numSentences: z.int().min(1).describe('Deprecated by Exa. The number of sentences to include in each highlight snippet.').optional(),
      highlightsPerUrl: z.int().min(1).describe('Deprecated by Exa. The number of highlight snippets to return per URL.').optional(),
      query: z.string().min(1).describe('A custom query that guides Exa highlight selection.').optional(),
    }).describe('Advanced configuration for Exa highlights.')]).optional(),
    summary: z.strictObject({
      query: z.string().min(1).describe('A custom query that guides Exa summary generation.').optional(),
      schema: z.looseObject({}).describe('A JSON Schema object used for structured Exa summaries.').optional(),
    }).describe('Configuration for an Exa summary response.').optional(),
    livecrawlTimeout: z.int().min(0).describe('The livecrawl timeout in milliseconds.').optional(),
    maxAgeHours: z.union([z.literal(-1), z.int().min(0).describe('A non-negative cache age in hours.')]).describe('Maximum age of cached content in hours. Use -1 to always use cache, 0 to always livecrawl, or a positive integer to require fresher content.').optional(),
    subpages: z.int().min(0).describe('The maximum number of subpages Exa should crawl per result.').optional(),
    subpageTarget: z.union([z.string().min(1).describe('A single keyword used to locate relevant subpages.'), z.array(z.string().min(1)).min(1).describe('A list of keywords used to locate relevant subpages.')]).describe('Keywords Exa should use when selecting subpages.').optional(),
    extras: z.strictObject({
      links: z.int().min(0).describe('The maximum number of webpage links to return for each result.').optional(),
      imageLinks: z.int().min(0).describe('The maximum number of image links to return for each result.').optional(),
    }).describe('Additional Exa extraction options.').optional(),
  }).describe('The Exa contents request object.').optional(),
}).describe('The input payload for an Exa findSimilar request. includeDomains and excludeDomains cannot be provided together.')

export const findSimilarOutput = z.strictObject({
  requestId: z.string().describe('The unique identifier for this Exa request.'),
  results: z.array(z.looseObject({
    id: z.string().describe('The temporary Exa document identifier.').optional(),
    url: z.string().describe('The result URL.').optional(),
    title: z.string().describe('The result title.').optional(),
    publishedDate: z.string().describe('The estimated publication timestamp for the result.').nullable().optional(),
    author: z.string().describe('The result author.').nullable().optional(),
    score: z.number().describe('The result relevance score.').nullable().optional(),
  }).describe('An Exa search or contents result object.')).describe('The Exa similar-page results.'),
  costDollars: z.looseObject({
    total: z.number().describe('The total request cost in US dollars.').optional(),
  }).describe('The Exa costDollars object.').optional(),
}).describe('The response payload for exa.find_similar.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const exaActions = {
  search: {
    description: 'Search the web with Exa and optionally enrich each result with contents.',
    effect: 'write',
    inputSchema: searchInput,
    outputSchema: z.toJSONSchema(searchOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_contents: {
    description: 'Fetch text, highlights, or summaries from Exa for URLs or document IDs.',
    effect: 'read',
    inputSchema: getContentsInput,
    outputSchema: z.toJSONSchema(getContentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  answer: {
    description: 'Generate a citation-backed answer from Exa search results.',
    effect: 'write',
    inputSchema: answerInput,
    outputSchema: z.toJSONSchema(answerOutput, { io: 'output', unrepresentable: 'any' }),
  },
  find_similar: {
    description: 'Find pages similar to a given URL and optionally enrich them with contents.',
    effect: 'read',
    inputSchema: findSimilarInput,
    outputSchema: z.toJSONSchema(findSimilarOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
