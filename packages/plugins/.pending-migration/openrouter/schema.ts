/**
 * OpenRouter 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

// 手写豁免(见 handwritten.json):create_coinbase_charge

export const createChatCompletionInput = z.looseObject({
  model: z.string().min(1).describe('The model ID to use.'),
  messages: z.array(z.looseObject({}).describe('A JSON object returned by OpenRouter.')).min(1).describe('An ordered list of conversation messages.'),
  n: z.int().min(1).describe('The number of choices to generate.').optional(),
  stop: z.union([z.string().min(1).describe('A single stop sequence.'), z.array(z.string().min(1).describe('A stop sequence.')).min(1).describe('Multiple stop sequences.')]).describe('Stop sequences for generation.').optional(),
  user: z.string().describe('The end user\'s unique identifier.').optional(),
  top_p: z.number().min(0).max(1).describe('Nucleus sampling parameter.').optional(),
  stream: z.boolean().describe('Whether to request a streaming response. Connector actions only support false or omitted.').optional(),
  functions: z.array(z.looseObject({}).describe('A JSON object returned by OpenRouter.')).describe('A list of JSON objects returned by OpenRouter.').optional(),
  function_call: z.union([z.enum(['none', 'auto']), z.looseObject({}).describe('A JSON object returned by OpenRouter.')]).describe('Legacy function calling strategy converted to tool_choice at execution time.').optional(),
  logit_bias: z.record(z.string(), z.number().describe('The bias value for this token.')).describe('Token bias map.').optional(),
  max_tokens: z.int().min(1).describe('The maximum number of output tokens.').optional(),
  max_completion_tokens: z.int().min(1).describe('New max output token field, taking precedence over max_tokens.').optional(),
  temperature: z.number().min(0).max(2).describe('Sampling temperature.').optional(),
  presence_penalty: z.number().min(-2).max(2).describe('Presence penalty.').optional(),
  frequency_penalty: z.number().min(-2).max(2).describe('Frequency penalty.').optional(),
  logprobs: z.boolean().describe('Whether to return token-level probabilities.').optional(),
  top_logprobs: z.int().min(0).max(20).describe('The number of top logprobs to return.').optional(),
  tools: z.array(z.looseObject({}).describe('A JSON object returned by OpenRouter.')).describe('A list of JSON objects returned by OpenRouter.').optional(),
  tool_choice: z.union([z.enum(['none', 'auto', 'required']), z.looseObject({}).describe('A JSON object returned by OpenRouter.')]).describe('Tool selection strategy.').optional(),
  response_format: z.looseObject({}).describe('A JSON object returned by OpenRouter.').optional(),
  modalities: z.array(z.string().min(1)).describe('List of output modalities to request.').optional(),
  models: z.array(z.string().min(1)).describe('Candidate fallback model IDs.').optional(),
  metadata: z.looseObject({}).describe('A JSON object returned by OpenRouter.').optional(),
  provider: z.looseObject({}).describe('A JSON object returned by OpenRouter.').optional(),
  plugins: z.array(z.looseObject({}).describe('A JSON object returned by OpenRouter.')).describe('A list of JSON objects returned by OpenRouter.').optional(),
  service_tier: z.string().describe('Requested service tier.').optional(),
  session_id: z.string().describe('Session ID used to associate requests.').optional(),
  parallel_tool_calls: z.boolean().describe('Whether to allow parallel tool calls.').optional(),
  stream_options: z.looseObject({}).describe('A JSON object returned by OpenRouter.').optional(),
  reasoning: z.looseObject({}).describe('A JSON object returned by OpenRouter.').optional(),
  httpReferer: z.string().describe('The application URL sent in the HTTP-Referer header for OpenRouter attribution and analytics.').optional(),
  xTitle: z.string().describe('The application display name sent in the X-Title header for OpenRouter console display.').optional(),
}).describe('Input parameters when creating an OpenRouter chat completion.')

export const createChatCompletionOutput = z.looseObject({}).describe('A JSON object returned by OpenRouter.')

export const createMessageInput = z.looseObject({
  model: z.string().min(1).describe('The model ID to use.'),
  max_tokens: z.int().min(1).describe('The maximum number of output tokens.'),
  messages: z.array(z.looseObject({}).describe('A JSON object returned by OpenRouter.')).min(1).describe('An ordered list of Anthropic-format messages.'),
  user: z.string().describe('The end user\'s unique identifier.').optional(),
  tools: z.array(z.looseObject({}).describe('A JSON object returned by OpenRouter.')).describe('A list of JSON objects returned by OpenRouter.').optional(),
  top_k: z.int().min(0).describe('Top-k sampling parameter.').optional(),
  top_p: z.number().min(0).max(1).describe('Nucleus sampling parameter.').optional(),
  models: z.array(z.string().min(1)).describe('Candidate fallback model IDs.').optional(),
  stream: z.boolean().describe('Whether to request a streaming response. Connector actions only support false or omitted.').optional(),
  system: z.union([z.string().describe('System prompt text.'), z.array(z.looseObject({}).describe('A JSON object returned by OpenRouter.')).min(1).describe('Structured system prompt content blocks.')]).describe('System prompt content.').optional(),
  plugins: z.array(z.looseObject({}).describe('A JSON object returned by OpenRouter.')).describe('A list of JSON objects returned by OpenRouter.').optional(),
  metadata: z.looseObject({}).describe('A JSON object returned by OpenRouter.').optional(),
  output_config: z.looseObject({}).describe('A JSON object returned by OpenRouter.').optional(),
  provider: z.looseObject({}).describe('A JSON object returned by OpenRouter.').optional(),
  service_tier: z.string().describe('Requested service tier.').optional(),
  session_id: z.string().describe('Session ID used to associate requests.').optional(),
  stop_sequences: z.array(z.string().min(1)).describe('Stop sequences for generation.').optional(),
  temperature: z.number().min(0).max(2).describe('Sampling temperature.').optional(),
  thinking: z.looseObject({}).describe('A JSON object returned by OpenRouter.').optional(),
  tool_choice: z.union([z.enum(['auto', 'any', 'none']), z.looseObject({}).describe('A JSON object returned by OpenRouter.')]).describe('Tool selection strategy.').optional(),
  httpReferer: z.string().describe('The application URL sent in the HTTP-Referer header for OpenRouter attribution and analytics.').optional(),
  xTitle: z.string().describe('The application display name sent in the X-Title header for OpenRouter console display.').optional(),
}).describe('Input parameters when creating an OpenRouter Anthropic Messages request.')

export const createMessageOutput = z.looseObject({}).describe('A JSON object returned by OpenRouter.')

export const getCreditsInput = z.strictObject({}).describe('This action requires no additional input parameters.')

export const getCreditsOutput = z.strictObject({
  data: z.looseObject({
    total_credits: z.number().describe('Cumulative purchased credits.').optional(),
    total_usage: z.number().describe('Cumulative credits used.').optional(),
  }).describe('Credit overview information.').optional(),
}).describe('Returns the standard response for an OpenRouter credit overview.')

export const getCurrentKeyInput = z.strictObject({
  httpReferer: z.string().describe('The application URL sent in the HTTP-Referer header for OpenRouter attribution and analytics.').optional(),
  xTitle: z.string().describe('The application display name sent in the X-Title header for OpenRouter console display.').optional(),
}).describe('Input parameters when querying the current API key information.')

export const getCurrentKeyOutput = z.strictObject({
  data: z.looseObject({}).describe('A JSON object returned by OpenRouter.').optional(),
}).describe('Returns metadata for the current OpenRouter API key.')

export const getGenerationInput = z.strictObject({
  id: z.string().min(1).describe('The generation ID to query.'),
}).describe('Input parameters when querying generation metadata.')

export const getGenerationOutput = z.strictObject({
  data: z.looseObject({}).describe('A JSON object returned by OpenRouter.').optional(),
}).describe('Returns the standard response with generation metadata.')

export const getModelsCountInput = z.strictObject({
  outputModalities: z.string().min(1).describe('Filter statistics by output modality, such as text, image, audio, embeddings, or all.').optional(),
  httpReferer: z.string().describe('The application URL sent in the HTTP-Referer header for OpenRouter attribution and analytics.').optional(),
  xTitle: z.string().describe('The application display name sent in the X-Title header for OpenRouter console display.').optional(),
}).describe('Input parameters when getting the number of models.')

export const getModelsCountOutput = z.strictObject({
  data: z.strictObject({
    count: z.int().describe('The current number of eligible models.').optional(),
  }).describe('Model count result.').optional(),
}).describe('Returns the standard response for the number of models.')

export const listAvailableModelsInput = z.strictObject({
  category: z.string().min(1).describe('Filter the model list by use case classification.').optional(),
  supportedParameters: z.string().min(1).describe('Filter the model list by supported parameter names. Multiple parameters can be separated by commas.').optional(),
  outputModalities: z.string().min(1).describe('Filter the list of models by output modality, such as text, image, audio, embeddings, or all.').optional(),
  useRss: z.boolean().describe('Whether to return RSS XML instead of JSON.').optional(),
  useRssChatLinks: z.boolean().describe('Whether to use the chat page link instead of the model details page link when returning RSS.').optional(),
}).describe('Input parameters when listing available models for OpenRouter.')

export const listAvailableModelsOutput = z.union([z.strictObject({
  data: z.array(z.looseObject({}).describe('A JSON object returned by OpenRouter.')).describe('A list of JSON objects returned by OpenRouter.').optional(),
}).describe('Standard OpenRouter response that returns a list of models.'), z.strictObject({
  rss: z.string().describe('RSS XML string returned when useRss=true.').optional(),
}).describe('RSS output format.')]).describe('Response when listing available OpenRouter models.')

export const listEmbeddingModelsInput = z.strictObject({
  httpReferer: z.string().describe('The application URL sent in the HTTP-Referer header for OpenRouter attribution and analytics.').optional(),
  xTitle: z.string().describe('The application display name sent in the X-Title header for OpenRouter console display.').optional(),
}).describe('Input parameters when listing embedding models.')

export const listEmbeddingModelsOutput = z.strictObject({
  data: z.array(z.looseObject({}).describe('A JSON object returned by OpenRouter.')).describe('A list of JSON objects returned by OpenRouter.').optional(),
}).describe('Standard OpenRouter response that returns a list of models.')

export const listModelEndpointsInput = z.strictObject({
  author: z.string().min(1).describe('Model author or organization name.'),
  slug: z.string().min(1).describe('Model slug.'),
}).describe('Input parameters when listing endpoints for a specific model.')

export const listModelEndpointsOutput = z.strictObject({
  data: z.looseObject({}).describe('A JSON object returned by OpenRouter.').optional(),
}).describe('Returns the standard response for the specified model endpoints.')

export const listProvidersInput = z.strictObject({}).describe('This action requires no additional input parameters.')

export const listProvidersOutput = z.strictObject({
  data: z.array(z.looseObject({}).describe('A JSON object returned by OpenRouter.')).describe('A list of JSON objects returned by OpenRouter.').optional(),
}).describe('Returns a standard response with a list of providers.')

export const listUserModelsInput = z.strictObject({
  httpReferer: z.string().describe('The application URL sent in the HTTP-Referer header for OpenRouter attribution and analytics.').optional(),
  xTitle: z.string().describe('The application display name sent in the X-Title header for OpenRouter console display.').optional(),
}).describe('Input parameters when listing models visible to the current user.')

export const listUserModelsOutput = z.strictObject({
  data: z.array(z.looseObject({}).describe('A JSON object returned by OpenRouter.')).describe('A list of JSON objects returned by OpenRouter.').optional(),
}).describe('Standard OpenRouter response that returns a list of models.')

export const listZdrEndpointsInput = z.strictObject({
  httpReferer: z.string().describe('The application URL sent in the HTTP-Referer header for OpenRouter attribution and analytics.').optional(),
  xTitle: z.string().describe('The application display name sent in the X-Title header for OpenRouter console display.').optional(),
}).describe('Input parameters when listing ZDR endpoints.')

export const listZdrEndpointsOutput = z.strictObject({
  data: z.array(z.looseObject({}).describe('A JSON object returned by OpenRouter.')).describe('A list of JSON objects returned by OpenRouter.').optional(),
}).describe('Returns the standard response for ZDR endpoints.')

import { createCoinbaseChargeInput, createCoinbaseChargeOutput } from './schema.handwritten'

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const openrouterActions = {
  create_chat_completion: {
    description: 'Create an OpenRouter chat completion through the OpenAI-compatible `/chat/completions` endpoint.',
    effect: 'write',
    inputSchema: createChatCompletionInput,
    outputSchema: z.toJSONSchema(createChatCompletionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_coinbase_charge: {
    description: 'Call OpenRouter\'s deprecated Coinbase charge endpoint for credits purchases. The upstream endpoint is currently deprecated and may return 410 Gone.',
    effect: 'write',
    inputSchema: createCoinbaseChargeInput,
    outputSchema: z.toJSONSchema(createCoinbaseChargeOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_message: {
    description: 'Create an OpenRouter Anthropic-format message through the `/messages` endpoint.',
    effect: 'write',
    inputSchema: createMessageInput,
    outputSchema: z.toJSONSchema(createMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_credits: {
    description: 'Get the authenticated OpenRouter credit balance summary.',
    effect: 'read',
    inputSchema: getCreditsInput,
    outputSchema: z.toJSONSchema(getCreditsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_current_key: {
    description: 'Get metadata for the currently authenticated OpenRouter API key.',
    effect: 'read',
    inputSchema: getCurrentKeyInput,
    outputSchema: z.toJSONSchema(getCurrentKeyOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_generation: {
    description: 'Get request and usage metadata for a specific OpenRouter generation.',
    effect: 'read',
    inputSchema: getGenerationInput,
    outputSchema: z.toJSONSchema(getGenerationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_models_count: {
    description: 'Get the total number of OpenRouter models, optionally filtered by output modalities.',
    effect: 'read',
    inputSchema: getModelsCountInput,
    outputSchema: z.toJSONSchema(getModelsCountOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_available_models: {
    description: 'List the available OpenRouter models, or return the RSS feed when requested.',
    effect: 'read',
    inputSchema: listAvailableModelsInput,
    outputSchema: z.toJSONSchema(listAvailableModelsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_embedding_models: {
    description: 'List the embedding models available through OpenRouter.',
    effect: 'read',
    inputSchema: listEmbeddingModelsInput,
    outputSchema: z.toJSONSchema(listEmbeddingModelsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_model_endpoints: {
    description: 'List the currently available endpoints for a specific OpenRouter model.',
    effect: 'read',
    inputSchema: listModelEndpointsInput,
    outputSchema: z.toJSONSchema(listModelEndpointsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_providers: {
    description: 'List the model providers currently available through OpenRouter.',
    effect: 'read',
    inputSchema: listProvidersInput,
    outputSchema: z.toJSONSchema(listProvidersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_user_models: {
    description: 'List models filtered by the current user\'s OpenRouter routing preferences, privacy settings, and guardrails.',
    effect: 'read',
    inputSchema: listUserModelsInput,
    outputSchema: z.toJSONSchema(listUserModelsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_zdr_endpoints: {
    description: 'Preview the OpenRouter endpoints that remain available under Zero Data Retention.',
    effect: 'read',
    inputSchema: listZdrEndpointsInput,
    outputSchema: z.toJSONSchema(listZdrEndpointsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
