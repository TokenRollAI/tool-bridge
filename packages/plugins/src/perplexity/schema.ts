/**
 * Perplexity 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listModelsInput = z.strictObject({}).describe('No input parameters are required for this action.')

export const listModelsOutput = z.looseObject({
  object: z.string().describe('The top-level object type.').optional(),
  data: z.array(z.looseObject({
    id: z.string().describe('The model identifier.'),
    object: z.string().describe('The object type returned by the API.').optional(),
    created: z.int().describe('The Unix timestamp when the model metadata was created.').optional(),
    owned_by: z.string().describe('The organization or owner that provides the model.').optional(),
    type: z.string().describe('The model family or type.').optional(),
  }).describe('A Perplexity model entry.')).describe('The list of available models.'),
}).describe('The response payload for listing Perplexity models.')

export const searchInput = z.strictObject({
  query: z.union([z.string().min(1).describe('One or more raw web search queries.'), z.array(z.string().min(1).describe('One raw web search query.')).min(1).describe('One raw web search query.')]).describe('One or more raw web search queries.'),
  country: z.string().min(2).max(2).describe('The ISO 3166-1 alpha-2 country code used to localize search results.').optional(),
  max_results: z.int().min(1).max(20).describe('The maximum number of search results to return.').optional(),
  search_after_date: z.string().describe('Only return content published after this date, for example 01/15/2024.').optional(),
  search_before_date: z.string().describe('Only return content published before this date, for example 12/31/2024.').optional(),
  max_tokens_per_page: z.int().min(1).describe('The maximum number of tokens to retrieve from each webpage.').optional(),
  search_domain_filter: z.array(z.string().min(1).describe('A domain or URL prefix used to filter results.')).max(20).describe('Only return search results from these domains or URL prefixes.').optional(),
}).describe('The input payload for the raw Perplexity web search action.')

export const searchOutput = z.looseObject({
  results: z.array(z.looseObject({
    title: z.string().describe('The search result title.').optional(),
    url: z.string().describe('The canonical URL of the result.').optional(),
    snippet: z.string().describe('A short snippet extracted from the result page.').optional(),
    date: z.string().describe('The published date reported for the result.').optional(),
    last_updated: z.string().describe('The last updated date reported for the result.').optional(),
  }).describe('A raw search result returned by Perplexity.')).describe('The ranked raw search results.').optional(),
}).describe('The response payload for the raw search action.')

export const createChatCompletionInput = z.strictObject({
  model: z.string().describe('The Sonar model to use for the chat completion.'),
  messages: z.array(z.strictObject({
    role: z.enum(['system', 'user', 'assistant']).describe('The role of the message author.').optional(),
    content: z.string().describe('The plain-text message content.').optional(),
  }).describe('A chat message.')).min(1).describe('The ordered conversation messages.'),
  max_tokens: z.int().min(1).describe('The maximum number of tokens to generate.').optional(),
  temperature: z.number().min(0).max(2).describe('The sampling temperature for generation.').optional(),
  top_p: z.number().min(0).max(1).describe('The nucleus sampling threshold.').optional(),
  top_k: z.int().min(0).describe('The number of top tokens to consider per step.').optional(),
  stream: z.boolean().describe('Whether to stream the response. This connector only accepts false or an omitted value.').optional(),
  return_images: z.boolean().describe('Whether to include image references in the response.').optional(),
  return_citations: z.boolean().describe('Whether to include citations in the response.').optional(),
  disable_search: z.boolean().describe('Whether to disable web search grounding for this request.').optional(),
  search_domain_filter: z.array(z.string().min(1).describe('A domain or URL prefix used to limit web search.')).describe('Only search within these domains or URL prefixes.').optional(),
  search_recency_filter: z.string().describe('A recency filter such as day, week, month, or year.').optional(),
  presence_penalty: z.number().min(-2).max(2).describe('The penalty applied to tokens that have already appeared.').optional(),
  frequency_penalty: z.number().min(0).max(2).describe('The penalty applied based on token frequency.').optional(),
}).describe('The input payload for the Perplexity chat completion action.')

export const createChatCompletionOutput = z.looseObject({
  id: z.string().describe('The completion identifier.').optional(),
  model: z.string().describe('The model that generated the completion.').optional(),
  created: z.int().describe('The Unix timestamp when the completion was created.').optional(),
  choices: z.array(z.looseObject({
    index: z.int().describe('The choice index.').optional(),
    finish_reason: z.string().describe('The reason why generation stopped.').optional(),
    message: z.looseObject({
      role: z.string().describe('The role of the generated message.').optional(),
      content: z.string().describe('The generated message content.').optional(),
    }).describe('The generated message.').optional(),
  }).describe('A single generated completion choice.')).describe('The completion choices.'),
  citations: z.array(z.string().min(1).describe('A citation URL returned with the response.')).describe('The citation URLs referenced by the answer.').optional(),
  search_results: z.array(z.looseObject({
    title: z.string().describe('The search result title.').optional(),
    url: z.string().describe('The canonical URL of the result.').optional(),
    snippet: z.string().describe('A short snippet extracted from the result page.').optional(),
    date: z.string().describe('The published date reported for the result.').optional(),
    last_updated: z.string().describe('The last updated date reported for the result.').optional(),
  }).describe('A raw search result returned by Perplexity.')).describe('The search results used to ground the response.').optional(),
  usage: z.looseObject({
    prompt_tokens: z.int().describe('The number of prompt tokens consumed.').optional(),
    completion_tokens: z.int().describe('The number of completion tokens generated.').optional(),
    total_tokens: z.int().describe('The total number of tokens consumed.').optional(),
  }).describe('Token usage metadata for the completion.').optional(),
}).describe('The response payload for the chat completion action.')

export const createEmbeddingsInput = z.strictObject({
  model: z.enum(['pplx-embed-v1-0.6b', 'pplx-embed-v1-4b']).describe('The embedding model identifier.'),
  input: z.union([z.string().min(1).describe('One or more input strings to embed.'), z.array(z.string().min(1).describe('One input string to embed.')).min(1).max(512).describe('One input string to embed.')]).describe('One or more input strings to embed.'),
  dimensions: z.int().describe('The target embedding dimension count.').optional(),
  encoding_format: z.enum(['base64_int8', 'base64_binary']).describe('The output encoding format for embeddings.').optional(),
}).describe('The input payload for the embeddings action.')

export const createEmbeddingsOutput = z.looseObject({
  object: z.string().describe('The top-level object type.').optional(),
  model: z.string().describe('The embedding model that generated the output.').optional(),
  data: z.array(z.looseObject({
    object: z.string().describe('The object type for the embedding item.').optional(),
    index: z.int().describe('The zero-based embedding index.').optional(),
    embedding: z.union([z.array(z.number().describe('One embedding vector value.')).describe('The numeric embedding vector.'), z.string().describe('The encoded embedding value.')]).describe('The embedding payload.').optional(),
  }).describe('A single embedding item.')).describe('The generated embeddings.'),
  usage: z.looseObject({
    prompt_tokens: z.int().describe('The number of prompt tokens consumed.').optional(),
    total_tokens: z.int().describe('The total number of tokens consumed.').optional(),
  }).describe('Usage information for the embeddings request.').optional(),
}).describe('The response payload for the embeddings action.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const perplexityActions = {
  list_models: {
    description: 'List the models currently available from Perplexity.',
    effect: 'read',
    inputSchema: listModelsInput,
    outputSchema: z.toJSONSchema(listModelsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search: {
    description: 'Search the web and return ranked raw results from Perplexity without LLM synthesis.',
    effect: 'write',
    inputSchema: searchInput,
    outputSchema: z.toJSONSchema(searchOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_chat_completion: {
    description: 'Create a Perplexity Sonar chat completion grounded by web search when enabled.',
    effect: 'write',
    inputSchema: createChatCompletionInput,
    outputSchema: z.toJSONSchema(createChatCompletionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_embeddings: {
    description: 'Generate vector embeddings for one or more input strings with Perplexity.',
    effect: 'write',
    inputSchema: createEmbeddingsInput,
    outputSchema: z.toJSONSchema(createEmbeddingsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
