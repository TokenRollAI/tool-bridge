/**
 * Cohere 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const chatInput = z.strictObject({
  model: z.string().min(1).describe('The name of a compatible Cohere chat model.'),
  messages: z.array(z.strictObject({
    role: z.enum(['system', 'user', 'assistant', 'tool']).describe('The author role for the message.'),
    content: z.union([z.string().describe('Plain text message content.'), z.array(z.looseObject({
      type: z.string().describe('The content block type, such as text or image_url.'),
    }).describe('A Cohere chat message content block.')).min(1).describe('Structured content blocks for the message.')]).describe('The content of a Cohere chat message.').optional(),
    tool_calls: z.array(z.looseObject({}).describe('A JSON object accepted or returned by the Cohere API.')).describe('Tool calls made by the assistant message.').optional(),
    tool_call_id: z.string().describe('The identifier of the tool call this tool message responds to.').optional(),
  }).describe('A message in the conversation sent to the Cohere Chat API.')).min(1).describe('The ordered conversation messages to send to Cohere.'),
  tools: z.array(z.looseObject({}).describe('A JSON object accepted or returned by the Cohere API.')).describe('Function tools available to the model.').optional(),
  strict_tools: z.boolean().describe('Whether tool calls must strictly follow the tool definition.').optional(),
  documents: z.array(z.union([z.string().describe('Document text.'), z.looseObject({}).describe('A JSON object accepted or returned by the Cohere API.')]).describe('A document supplied to the model.')).describe('Documents that the model can cite while generating the response.').optional(),
  citation_options: z.looseObject({}).describe('A JSON object accepted or returned by the Cohere API.').optional(),
  response_format: z.looseObject({}).describe('A JSON object accepted or returned by the Cohere API.').optional(),
  safety_mode: z.string().describe('The Cohere safety mode to use for the request.').optional(),
  max_tokens: z.int().describe('The maximum number of output tokens the model will generate.').optional(),
  stop_sequences: z.array(z.string().describe('A stop sequence.')).max(5).describe('Stop sequences that halt generation.').optional(),
  temperature: z.number().describe('Randomness used for generation.').optional(),
  seed: z.int().describe('A best-effort deterministic sampling seed.').optional(),
  frequency_penalty: z.number().describe('Penalty used to reduce repeated tokens.').optional(),
  presence_penalty: z.number().describe('Penalty used to reduce reused token content.').optional(),
  k: z.int().describe('Top-k sampling value. Use 0 to disable k-sampling.').optional(),
  p: z.number().describe('Top-p sampling value.').optional(),
  logprobs: z.boolean().describe('Whether to include generated-token log probabilities.').optional(),
  tool_choice: z.union([z.string().describe('A predefined tool choice value.'), z.looseObject({}).describe('A JSON object accepted or returned by the Cohere API.')]).describe('Tool selection behavior for the model.').optional(),
  thinking: z.looseObject({}).describe('A JSON object accepted or returned by the Cohere API.').optional(),
  priority: z.int().describe('Lower values are handled earlier by Cohere.').optional(),
}).describe('Input for generating a synchronous response with the Cohere Chat API.')

export const chatOutput = z.looseObject({
  id: z.string().describe('The unique Cohere response identifier.'),
  finish_reason: z.string().describe('Why generation finished.'),
  message: z.looseObject({
    role: z.string().describe('The role of the returned message.').optional(),
    content: z.array(z.looseObject({}).describe('A JSON object accepted or returned by the Cohere API.')).describe('Content blocks returned by the assistant message.').optional(),
    tool_calls: z.array(z.looseObject({}).describe('A JSON object accepted or returned by the Cohere API.')).describe('Tool calls returned by Cohere.').optional(),
  }).describe('The assistant message returned by Cohere.'),
  usage: z.looseObject({}).describe('Usage statistics returned by Cohere.'),
}).describe('The response returned by the Cohere Chat API.')

export const embedTextsInput = z.strictObject({
  model: z.string().min(1).describe('The Cohere embedding model identifier.'),
  input_type: z.enum(['search_document', 'search_query', 'classification', 'clustering']).describe('The type of input passed to the embedding model.'),
  texts: z.array(z.string().describe('A text value to embed.')).min(1).max(96).describe('Text strings for the model to embed.'),
  max_tokens: z.int().describe('The maximum number of tokens to embed per input.').optional(),
  output_dimension: z.int().describe('The number of dimensions for embed-v4 and newer models.').optional(),
  embedding_types: z.array(z.enum(['float', 'int8', 'uint8', 'binary', 'ubinary', 'base64']).describe('The embedding representation to return.')).min(1).describe('Embedding representations to return.').optional(),
  truncate: z.enum(['NONE', 'START', 'END']).describe('How Cohere handles inputs longer than the model limit.').optional(),
  priority: z.int().describe('Lower values are handled earlier by Cohere.').optional(),
}).describe('Input for generating text embeddings with the Cohere Embed API.')

export const embedTextsOutput = z.looseObject({
  id: z.string().describe('The unique Cohere response identifier.'),
  embeddings: z.looseObject({}).describe('Embeddings grouped by requested representation type.'),
  texts: z.array(z.string().describe('A text input.')).describe('Text inputs echoed by Cohere.'),
  meta: z.looseObject({
    api_version: z.looseObject({
      version: z.string().describe('The API version used for the response.').optional(),
      is_deprecated: z.boolean().describe('Whether this API version is deprecated.').optional(),
      is_experimental: z.boolean().describe('Whether this API version is experimental.').optional(),
    }).describe('The Cohere API version metadata.').optional(),
    billed_units: z.looseObject({}).describe('Billing unit counts reported by Cohere.').optional(),
    tokens: z.looseObject({}).describe('Token usage counts reported by Cohere.').optional(),
    warnings: z.array(z.string().describe('A warning message.')).describe('Warnings returned by Cohere.').optional(),
  }).describe('Cohere API metadata including usage and billing details.'),
}).describe('The response returned by the Cohere Embed API.')

export const rerankDocumentsInput = z.strictObject({
  model: z.string().min(1).describe('The Cohere rerank model identifier.'),
  query: z.string().min(1).describe('The search query used to rank documents.'),
  documents: z.array(z.string().describe('A text document to rank.')).min(1).describe('Texts that will be compared to the query.'),
  top_n: z.int().describe('Maximum number of rerank results to return.').optional(),
  max_tokens_per_doc: z.int().describe('Maximum tokens to keep per document before ranking.').optional(),
  priority: z.int().describe('Lower values are handled earlier by Cohere.').optional(),
}).describe('Input for ranking documents by relevance with the Cohere Rerank API.')

export const rerankDocumentsOutput = z.looseObject({
  id: z.string().describe('The unique Cohere response identifier.'),
  results: z.array(z.strictObject({
    index: z.int().describe('The original zero-based index of the ranked document.').optional(),
    relevance_score: z.number().describe('Normalized relevance score between 0 and 1.').optional(),
  }).describe('A ranked document result returned by Cohere.')).describe('Ranked document results.'),
  meta: z.looseObject({
    api_version: z.looseObject({
      version: z.string().describe('The API version used for the response.').optional(),
      is_deprecated: z.boolean().describe('Whether this API version is deprecated.').optional(),
      is_experimental: z.boolean().describe('Whether this API version is experimental.').optional(),
    }).describe('The Cohere API version metadata.').optional(),
    billed_units: z.looseObject({}).describe('Billing unit counts reported by Cohere.').optional(),
    tokens: z.looseObject({}).describe('Token usage counts reported by Cohere.').optional(),
    warnings: z.array(z.string().describe('A warning message.')).describe('Warnings returned by Cohere.').optional(),
  }).describe('Cohere API metadata including usage and billing details.'),
}).describe('The response returned by the Cohere Rerank API.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const cohereActions = {
  chat: {
    description: 'Generate a synchronous text response using the Cohere Chat API.',
    effect: 'write',
    inputSchema: chatInput,
    outputSchema: z.toJSONSchema(chatOutput, { io: 'output', unrepresentable: 'any' }),
  },
  embed_texts: {
    description: 'Generate embeddings for text inputs using the Cohere Embed API.',
    effect: 'write',
    inputSchema: embedTextsInput,
    outputSchema: z.toJSONSchema(embedTextsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  rerank_documents: {
    description: 'Rank text documents by relevance to a query using the Cohere Rerank API.',
    effect: 'write',
    inputSchema: rerankDocumentsInput,
    outputSchema: z.toJSONSchema(rerankDocumentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
