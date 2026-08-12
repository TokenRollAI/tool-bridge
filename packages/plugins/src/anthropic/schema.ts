/**
 * Anthropic 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listModelsInput = z.strictObject({
  before_id: z.string().describe('Returns models before this model identifier.').optional(),
  after_id: z.string().describe('Returns models after this model identifier.').optional(),
  limit: z.int().min(1).max(1000).describe('The maximum number of models to return.').optional(),
}).describe('The input payload for listing Anthropic models.')

export const listModelsOutput = z.looseObject({
  data: z.array(z.looseObject({
    id: z.string().describe('The model identifier.').optional(),
    type: z.string().describe('The object type returned by the API.').optional(),
    display_name: z.string().describe('A human-readable model name.').optional(),
    created_at: z.iso.datetime({ offset: true }).describe('The date and time when the model was created.').optional(),
  }).describe('An Anthropic model record.')).describe('The list of Anthropic models.').optional(),
  has_more: z.boolean().describe('Whether more results are available.').optional(),
  first_id: z.string().describe('The first model identifier in this page.').nullable().optional(),
  last_id: z.string().describe('The last model identifier in this page.').nullable().optional(),
}).describe('The response payload for listing Anthropic models.')

export const getModelInput = z.strictObject({
  model_id: z.string().describe('The exact Anthropic model identifier to retrieve.').optional(),
}).describe('The input payload for retrieving an Anthropic model.')

export const getModelOutput = z.looseObject({
  id: z.string().describe('The model identifier.').optional(),
  type: z.string().describe('The object type returned by the API.').optional(),
  display_name: z.string().describe('A human-readable model name.').optional(),
  created_at: z.iso.datetime({ offset: true }).describe('The date and time when the model was created.').optional(),
}).describe('An Anthropic model record.')

export const createMessageInput = z.looseObject({
  model: z.string().describe('The Anthropic model identifier to use.'),
  max_tokens: z.int().min(1).describe('The maximum number of tokens to generate.'),
  messages: z.array(z.looseObject({
    role: z.enum(['user', 'assistant']).describe('The role of the message author.').optional(),
    content: z.union([z.string().describe('Plain text message content.'), z.array(z.looseObject({}).describe('A structured Anthropic content block.')).min(1).describe('Structured content blocks.')]).describe('Anthropic message content.').optional(),
  }).describe('An input message in an Anthropic conversation.')).min(1).describe('The ordered conversation history sent to the model.'),
  system: z.union([z.string().describe('Plain text system prompt.'), z.array(z.looseObject({}).describe('A structured Anthropic content block.')).min(1).describe('Structured system prompt content blocks.')]).describe('System prompt content.').optional(),
  metadata: z.looseObject({
    user_id: z.string().describe('An external user identifier for abuse detection.').optional(),
  }).describe('Metadata about the request.').optional(),
  stop_sequences: z.array(z.string().describe('A stop sequence.')).describe('Custom text sequences that stop generation.').optional(),
  stream: z.boolean().describe('Whether to request a streaming response. This connector only accepts false or an omitted value.').optional(),
  temperature: z.number().min(0).max(1).describe('The sampling temperature.').optional(),
  thinking: z.record(z.string(), z.unknown().describe('Any JSON value accepted by the Anthropic API.')).describe('A JSON object passed through to the Anthropic API.').optional(),
  tool_choice: z.union([z.enum(['auto', 'any', 'none']).describe('A predefined tool choice mode.'), z.record(z.string(), z.unknown().describe('Any JSON value accepted by the Anthropic API.')).describe('A JSON object passed through to the Anthropic API.')]).describe('Tool selection strategy for the request.').optional(),
  tools: z.array(z.record(z.string(), z.unknown().describe('Any JSON value accepted by the Anthropic API.')).describe('A JSON object passed through to the Anthropic API.')).describe('Tools available to the model.').optional(),
  top_k: z.int().min(0).describe('Only sample from the top K options for each token.').optional(),
  top_p: z.number().min(0).max(1).describe('The nucleus sampling threshold.').optional(),
}).describe('The input payload for creating a non-streaming Anthropic message.')

export const createMessageOutput = z.looseObject({
  id: z.string().describe('The message identifier.').optional(),
  type: z.string().describe('The object type returned by the API.').optional(),
  role: z.string().describe('The role of the returned message.').optional(),
  model: z.string().describe('The model used to generate the response.').optional(),
  content: z.array(z.looseObject({}).describe('A structured Anthropic content block.')).describe('Content blocks generated by the model.').optional(),
  stop_reason: z.string().describe('The reason generation stopped.').nullable().optional(),
  stop_sequence: z.string().describe('The stop sequence that ended generation.').nullable().optional(),
  usage: z.looseObject({
    input_tokens: z.int().describe('The number of input tokens consumed.').optional(),
    output_tokens: z.int().describe('The number of output tokens generated.').optional(),
  }).describe('Token usage information.').optional(),
}).describe('The response payload for an Anthropic message.')

export const countMessageTokensInput = z.looseObject({
  model: z.string().describe('The Anthropic model identifier to use.'),
  messages: z.array(z.looseObject({
    role: z.enum(['user', 'assistant']).describe('The role of the message author.').optional(),
    content: z.union([z.string().describe('Plain text message content.'), z.array(z.looseObject({}).describe('A structured Anthropic content block.')).min(1).describe('Structured content blocks.')]).describe('Anthropic message content.').optional(),
  }).describe('An input message in an Anthropic conversation.')).min(1).describe('The ordered conversation history to count.'),
  system: z.union([z.string().describe('Plain text system prompt.'), z.array(z.looseObject({}).describe('A structured Anthropic content block.')).min(1).describe('Structured system prompt content blocks.')]).describe('System prompt content.').optional(),
  thinking: z.record(z.string(), z.unknown().describe('Any JSON value accepted by the Anthropic API.')).describe('A JSON object passed through to the Anthropic API.').optional(),
  tool_choice: z.union([z.enum(['auto', 'any', 'none']).describe('A predefined tool choice mode.'), z.record(z.string(), z.unknown().describe('Any JSON value accepted by the Anthropic API.')).describe('A JSON object passed through to the Anthropic API.')]).describe('Tool selection strategy for the request.').optional(),
  tools: z.array(z.record(z.string(), z.unknown().describe('Any JSON value accepted by the Anthropic API.')).describe('A JSON object passed through to the Anthropic API.')).describe('Tools available to the model.').optional(),
}).describe('The input payload for counting tokens in an Anthropic message request.')

export const countMessageTokensOutput = z.looseObject({
  input_tokens: z.int().describe('The number of input tokens counted for the request.').optional(),
}).describe('The response payload for counting Anthropic message tokens.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const anthropicActions = {
  list_models: {
    description: 'List Anthropic models available to the current API key.',
    effect: 'read',
    inputSchema: listModelsInput,
    outputSchema: z.toJSONSchema(listModelsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_model: {
    description: 'Fetch metadata for one Anthropic model.',
    effect: 'read',
    inputSchema: getModelInput,
    outputSchema: z.toJSONSchema(getModelOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_message: {
    description: 'Create a non-streaming Anthropic message.',
    effect: 'write',
    inputSchema: createMessageInput,
    outputSchema: z.toJSONSchema(createMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  count_message_tokens: {
    description: 'Count input tokens for an Anthropic message request.',
    effect: 'read',
    inputSchema: countMessageTokensInput,
    outputSchema: z.toJSONSchema(countMessageTokensOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
