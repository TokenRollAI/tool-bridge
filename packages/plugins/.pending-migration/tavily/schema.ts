/**
 * Tavily 各 action 的入参/出参 Zod schema 与语义标注。
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
  query: z.string().min(1).describe('The search query to execute with Tavily.'),
  search_depth: z.enum(['advanced', 'basic', 'fast', 'ultra-fast']).describe('Controls the latency-versus-relevance tradeoff for Tavily Search.').optional(),
  chunks_per_source: z.int().min(1).max(3).describe('The maximum number of chunks to return per source.').optional(),
  max_results: z.int().min(0).max(20).describe('The maximum number of search results to return.').optional(),
  topic: z.enum(['general', 'news', 'finance']).describe('The search category used by Tavily.').optional(),
  time_range: z.enum(['day', 'week', 'month', 'year', 'd', 'w', 'm', 'y']).describe('The date range shortcut used to filter results.').optional(),
  start_date: z.iso.date().describe('Only return results after this YYYY-MM-DD date.').optional(),
  end_date: z.iso.date().describe('Only return results before this YYYY-MM-DD date.').optional(),
  include_answer: z.union([z.boolean().describe('Whether to include an answer.'), z.enum(['basic', 'advanced']).describe('The answer detail level.')]).optional(),
  include_raw_content: z.union([z.boolean().describe('Whether to include raw content.'), z.enum(['markdown', 'text']).describe('The raw content format.')]).optional(),
  include_images: z.boolean().describe('Whether to include top-level and per-result images.').optional(),
  include_image_descriptions: z.boolean().describe('Whether to include descriptions for returned images.').optional(),
  include_favicon: z.boolean().describe('Whether to include favicons for returned results.').optional(),
  include_domains: z.array(z.string().min(1).describe('A domain name to include.')).min(1).describe('Domains that Tavily should include in the search results.').optional(),
  exclude_domains: z.array(z.string().min(1).describe('A domain name to exclude.')).min(1).describe('Domains that Tavily should exclude from the search results.').optional(),
  country: z.string().describe('A country name used to boost results for general searches.').optional(),
  auto_parameters: z.boolean().describe('Whether Tavily should auto-configure search parameters.').optional(),
  exact_match: z.boolean().describe('Whether Tavily should require quoted exact phrases to match exactly.').optional(),
  include_usage: z.boolean().describe('Whether to include credit usage details in the response.').optional(),
}).describe('The input payload for a Tavily Search request.')

export const searchOutput = z.looseObject({
  query: z.string().describe('The search query that was executed.'),
  results: z.array(z.looseObject({
    title: z.string().describe('The source title.').optional(),
    url: z.string().describe('The source URL.').optional(),
    content: z.string().describe('The extracted snippet or summary for the source.').optional(),
    score: z.number().describe('The relevance score of the source.').optional(),
    raw_content: z.string().describe('The cleaned page content when include_raw_content is enabled.').nullable().optional(),
    favicon: z.string().describe('The favicon URL for the result when include_favicon is enabled.').nullable().optional(),
    images: z.array(z.looseObject({
      url: z.string().describe('The image URL.').optional(),
      description: z.string().describe('A short description for the image.').optional(),
    }).describe('An image item returned by Tavily.')).describe('Images extracted from this result.').optional(),
    published_date: z.string().describe('The published date for the result when Tavily can determine it.').optional(),
  }).describe('A single Tavily search result.')).describe('The ranked search results returned by Tavily.'),
  response_time: z.union([z.number().describe('The total response time reported by Tavily.'), z.string().describe('The total response time reported by Tavily.')]),
  request_id: z.string().describe('A unique request identifier for Tavily support and debugging.'),
  answer: z.string().describe('A Tavily-generated answer for the query.'),
  images: z.array(z.looseObject({
    url: z.string().describe('The image URL.').optional(),
    description: z.string().describe('A short description for the image.').optional(),
  }).describe('An image item returned by Tavily.')).describe('Query-related images returned by Tavily.'),
  auto_parameters: z.looseObject({}).describe('Auto-selected parameters returned by Tavily when enabled.'),
  usage: z.looseObject({
    credits: z.number().describe('The number of API credits consumed by the request.').optional(),
  }).describe('Credit usage details returned by Tavily.'),
}).describe('The Tavily Search response payload.')

export const extractInput = z.strictObject({
  urls: z.array(z.url().describe('A source URL.')).min(1).describe('The URLs that Tavily should extract content from.'),
  query: z.string().describe('An optional query used to rerank extracted chunks.').optional(),
  chunks_per_source: z.int().min(1).max(5).describe('The maximum number of chunks to return per source when query is provided.').optional(),
  extract_depth: z.enum(['basic', 'advanced']).describe('Controls whether Tavily uses basic or advanced extraction.').optional(),
  include_images: z.boolean().describe('Whether to include images found on each page.').optional(),
  include_favicon: z.boolean().describe('Whether to include the favicon URL for each page.').optional(),
  format: z.enum(['markdown', 'text']).describe('The format of the extracted page content.').optional(),
  timeout: z.number().min(1).max(60).describe('The extraction timeout in seconds.').optional(),
  include_usage: z.boolean().describe('Whether to include credit usage details in the response.').optional(),
}).describe('The input payload for a Tavily Extract request.')

export const extractOutput = z.looseObject({
  results: z.array(z.looseObject({
    url: z.string().describe('The processed source URL.').optional(),
    raw_content: z.string().describe('The extracted page content in the selected format.').optional(),
    images: z.array(z.looseObject({
      url: z.string().describe('The image URL.').optional(),
      description: z.string().describe('A short description for the image.').optional(),
    }).describe('An image item returned by Tavily.')).describe('Images extracted from the source.').optional(),
    favicon: z.string().describe('The favicon URL for the source when include_favicon is enabled.').optional(),
  }).describe('An extracted Tavily result item.')).describe('The successful extraction results returned by Tavily.'),
  failed_results: z.array(z.looseObject({
    url: z.string().describe('The source URL that failed.').optional(),
    error: z.string().describe('The failure reason returned by Tavily.').optional(),
  }).describe('A failed Tavily extraction result.')).describe('URLs that Tavily could not extract successfully.'),
  response_time: z.number().describe('The total response time reported by Tavily.'),
  request_id: z.string().describe('A unique request identifier for Tavily support and debugging.'),
  usage: z.looseObject({
    credits: z.number().describe('The number of API credits consumed by the request.').optional(),
  }).describe('Credit usage details returned by Tavily.'),
}).describe('The Tavily Extract response payload.')

export const mapInput = z.strictObject({
  url: z.url().describe('The root URL that Tavily should map.'),
  instructions: z.string().describe('Natural-language instructions that guide the mapping.').optional(),
  max_depth: z.int().min(1).max(5).describe('The maximum mapping depth.').optional(),
  max_breadth: z.int().min(1).max(500).describe('The maximum number of links to follow per level.').optional(),
  limit: z.int().min(1).describe('The maximum number of links Tavily should process.').optional(),
  select_paths: z.array(z.string().min(1).describe('A path selection pattern.')).min(1).describe('Regex patterns used to include only matching URL paths.').optional(),
  select_domains: z.array(z.string().min(1).describe('A domain selection pattern.')).min(1).describe('Regex patterns used to include only matching domains.').optional(),
  exclude_paths: z.array(z.string().min(1).describe('A path exclusion pattern.')).min(1).describe('Regex patterns used to exclude matching URL paths.').optional(),
  exclude_domains: z.array(z.string().min(1).describe('A domain exclusion pattern.')).min(1).describe('Regex patterns used to exclude matching domains.').optional(),
  allow_external: z.boolean().describe('Whether external domain links can appear in the results.').optional(),
  timeout: z.number().min(10).max(150).describe('The mapping timeout in seconds.').optional(),
  include_usage: z.boolean().describe('Whether to include credit usage details in the response.').optional(),
}).describe('The input payload for a Tavily Map request.')

export const mapOutput = z.looseObject({
  base_url: z.string().describe('The base URL that Tavily mapped.'),
  results: z.array(z.string().min(1)).describe('The URLs discovered during the mapping operation.'),
  response_time: z.number().describe('The total response time reported by Tavily.'),
  request_id: z.string().describe('A unique request identifier for Tavily support and debugging.'),
  usage: z.looseObject({
    credits: z.number().describe('The number of API credits consumed by the request.').optional(),
  }).describe('Credit usage details returned by Tavily.'),
}).describe('The Tavily Map response payload.')

export const crawlInput = z.strictObject({
  url: z.url().describe('The root URL that Tavily should crawl.'),
  instructions: z.string().describe('Natural-language instructions that guide the crawl.').optional(),
  max_depth: z.int().min(1).max(5).describe('The maximum crawl depth.').optional(),
  max_breadth: z.int().min(1).max(500).describe('The maximum number of links to follow per crawl level.').optional(),
  limit: z.int().min(1).describe('The maximum number of links Tavily should process.').optional(),
  select_paths: z.array(z.string().min(1).describe('A path selection pattern.')).min(1).describe('Regex patterns used to include only matching URL paths.').optional(),
  select_domains: z.array(z.string().min(1).describe('A domain selection pattern.')).min(1).describe('Regex patterns used to include only matching domains.').optional(),
  exclude_paths: z.array(z.string().min(1).describe('A path exclusion pattern.')).min(1).describe('Regex patterns used to exclude matching URL paths.').optional(),
  exclude_domains: z.array(z.string().min(1).describe('A domain exclusion pattern.')).min(1).describe('Regex patterns used to exclude matching domains.').optional(),
  allow_external: z.boolean().describe('Whether external domain links can appear in the results.').optional(),
  include_images: z.boolean().describe('Whether to include images in crawled results.').optional(),
  extract_depth: z.enum(['basic', 'advanced']).describe('Controls whether Tavily uses basic or advanced extraction.').optional(),
  format: z.enum(['markdown', 'text']).describe('The format of the extracted page content.').optional(),
  include_favicon: z.boolean().describe('Whether to include a favicon URL for each crawled result.').optional(),
  timeout: z.number().min(10).max(150).describe('The crawl timeout in seconds.').optional(),
  include_usage: z.boolean().describe('Whether to include credit usage details in the response.').optional(),
}).describe('The input payload for a Tavily Crawl request.')

export const crawlOutput = z.looseObject({
  base_url: z.string().describe('The base URL that Tavily crawled.'),
  results: z.array(z.looseObject({
    url: z.string().describe('The processed source URL.').optional(),
    raw_content: z.string().describe('The extracted page content in the selected format.').optional(),
    images: z.array(z.looseObject({
      url: z.string().describe('The image URL.').optional(),
      description: z.string().describe('A short description for the image.').optional(),
    }).describe('An image item returned by Tavily.')).describe('Images extracted from the source.').optional(),
    favicon: z.string().describe('The favicon URL for the source when include_favicon is enabled.').optional(),
  }).describe('An extracted Tavily result item.')).describe('The extracted results returned by Tavily Crawl.'),
  response_time: z.number().describe('The total response time reported by Tavily.'),
  request_id: z.string().describe('A unique request identifier for Tavily support and debugging.'),
  usage: z.looseObject({
    credits: z.number().describe('The number of API credits consumed by the request.').optional(),
  }).describe('Credit usage details returned by Tavily.'),
}).describe('The Tavily Crawl response payload.')

export const createResearchInput = z.strictObject({
  input: z.string().min(1).describe('The research task or question to investigate.'),
  model: z.enum(['mini', 'pro', 'auto']).describe('Research model to use.').optional(),
  stream: z.literal(false).describe('Must be false or omitted. Tavily SSE streaming is not supported.').optional(),
  output_schema: z.looseObject({}).describe('JSON Schema for structured research output.').optional(),
  citation_format: z.enum(['numbered', 'mla', 'apa', 'chicago']).describe('The format for citations in the research report.').optional(),
  include_domains: z.array(z.string().min(1).describe('A domain to prioritize.')).max(20).describe('Soft source preference domains.').optional(),
  exclude_domains: z.array(z.string().min(1).describe('A domain to exclude.')).max(20).describe('Hard source blocklist domains.').optional(),
  output_length: z.enum(['short', 'standard', 'long']).describe('The target research response length.').optional(),
  files: z.array(z.strictObject({
    name: z.string().min(1).describe('The file name, including extension.'),
    data: z.string().min(1).describe('The base64-encoded file contents.'),
    type: z.literal('base64').describe('The encoded file content type.'),
  }).describe('A base64-encoded .txt, .md, or .json file attached to a Tavily Research request.')).min(1).max(5).describe('Up to 5 .txt, .md, or .json files to use as additional research sources.').optional(),
}).describe('The input payload for creating a Tavily Research task.')

export const createResearchOutput = z.looseObject({
  request_id: z.string().min(1).describe('A unique identifier for the research task.').optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed']).describe('The current research task status.').optional(),
  input: z.string().describe('The research task or question investigated.').optional(),
  model: z.enum(['mini', 'pro', 'auto']).describe('The model used by the research agent.').optional(),
  content: z.unknown().describe('The final research report content.').optional(),
  sources: z.array(z.looseObject({}).describe('A source used in a Tavily Research result.')).describe('Sources used in the research.').optional(),
  response_time: z.number().describe('The response time reported by Tavily.').optional(),
}).describe('A Tavily Research task response.')

export const getResearchInput = z.strictObject({
  request_id: z.string().min(1).describe('The unique identifier of the research task.'),
}).describe('The input payload for retrieving a Tavily Research task.')

export const getResearchOutput = z.looseObject({
  request_id: z.string().min(1).describe('A unique identifier for the research task.').optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed']).describe('The current research task status.').optional(),
  input: z.string().describe('The research task or question investigated.').optional(),
  model: z.enum(['mini', 'pro', 'auto']).describe('The model used by the research agent.').optional(),
  content: z.unknown().describe('The final research report content.').optional(),
  sources: z.array(z.looseObject({}).describe('A source used in a Tavily Research result.')).describe('Sources used in the research.').optional(),
  response_time: z.number().describe('The response time reported by Tavily.').optional(),
}).describe('A Tavily Research task response.')

export const getUsageInput = z.strictObject({}).describe('The input payload for a Tavily usage request.')

export const getUsageOutput = z.strictObject({
  key: z.looseObject({
    usage: z.number().describe('The total usage for the API key.').optional(),
    limit: z.number().describe('The usage limit for the API key.').optional(),
    search_usage: z.number().describe('Search credits consumed by the API key.').optional(),
    extract_usage: z.number().describe('Extract credits consumed by the API key.').optional(),
    crawl_usage: z.number().describe('Crawl credits consumed by the API key.').optional(),
    map_usage: z.number().describe('Map credits consumed by the API key.').optional(),
    research_usage: z.number().describe('Research credits consumed by the API key.').optional(),
  }).describe('Usage details for the specific API key.'),
  account: z.looseObject({
    current_plan: z.string().describe('The current account plan name.').optional(),
    plan_usage: z.number().describe('The total plan usage for the account.').optional(),
    plan_limit: z.number().describe('The plan limit for the account.').optional(),
    paygo_usage: z.number().describe('The pay-as-you-go usage for the account.').optional(),
    paygo_limit: z.number().describe('The pay-as-you-go limit for the account.').optional(),
  }).describe('Plan and usage information for the account.'),
}).describe('The Tavily usage response payload.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const tavilyActions = {
  search: {
    description: 'Execute a Tavily Search query and return ranked source results.',
    effect: 'write',
    inputSchema: searchInput,
    outputSchema: z.toJSONSchema(searchOutput, { io: 'output', unrepresentable: 'any' }),
  },
  extract: {
    description: 'Extract structured page content from one or more URLs with Tavily.',
    effect: 'write',
    inputSchema: extractInput,
    outputSchema: z.toJSONSchema(extractOutput, { io: 'output', unrepresentable: 'any' }),
  },
  map: {
    description: 'Discover URLs from a website with Tavily Map.',
    effect: 'write',
    inputSchema: mapInput,
    outputSchema: z.toJSONSchema(mapOutput, { io: 'output', unrepresentable: 'any' }),
  },
  crawl: {
    description: 'Crawl a website and extract content from discovered pages with Tavily.',
    effect: 'write',
    inputSchema: crawlInput,
    outputSchema: z.toJSONSchema(crawlOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_research: {
    description: 'Start an asynchronous Tavily Research task and return a request ID for polling.',
    effect: 'write',
    inputSchema: createResearchInput,
    outputSchema: z.toJSONSchema(createResearchOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_research: {
    description: 'Get the current status and result for a Tavily Research task.',
    effect: 'read',
    inputSchema: getResearchInput,
    outputSchema: z.toJSONSchema(getResearchOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_usage: {
    description: 'Get API key and account usage details from Tavily.',
    effect: 'read',
    inputSchema: getUsageInput,
    outputSchema: z.toJSONSchema(getUsageOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
