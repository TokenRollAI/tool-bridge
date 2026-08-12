/**
 * DeepSeek 各 action 的入参/出参 Zod schema 与语义标注。
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

export const listModelsOutput = z.strictObject({
  object: z.string().describe('The top-level object type returned by the API.').optional(),
  data: z.array(z.looseObject({
    id: z.string().describe('The model identifier.').optional(),
    object: z.string().describe('The object type returned by the API.').optional(),
    owned_by: z.string().describe('The owner of the model.').optional(),
  }).describe('A DeepSeek model summary.')).describe('The list of available models.').optional(),
})

export const getUserBalanceInput = z.strictObject({}).describe('No input parameters are required for this action.')

export const getUserBalanceOutput = z.strictObject({
  is_available: z.boolean().describe('Whether the account balance information is currently available.').optional(),
  balance_infos: z.array(z.looseObject({
    currency: z.string().describe('The currency code for the balance.').optional(),
    total_balance: z.string().describe('The total available balance.').optional(),
    granted_balance: z.string().describe('The promotional or granted balance.').optional(),
    topped_up_balance: z.string().describe('The manually topped-up balance.').optional(),
  }).describe('A balance entry returned by the DeepSeek balance API.')).describe('The list of balances grouped by currency.').optional(),
})

export const createChatCompletionInput = z.strictObject({
  model: z.enum(['deepseek-chat', 'deepseek-reasoner']).describe('The DeepSeek model identifier.'),
  messages: z.array(z.looseObject({
    role: z.enum(['system', 'user', 'assistant', 'tool']).describe('The role of the message author.').optional(),
    content: z.string().describe('The text content of the message.').nullable().optional(),
    name: z.string().describe('The optional participant name for the message.').optional(),
    prefix: z.boolean().describe('Whether the assistant message should be treated as a prefix.').optional(),
    tool_call_id: z.string().describe('The identifier of the tool call that this tool message responds to.').optional(),
    reasoning_content: z.string().describe('Reasoning content provided for assistant context.').optional(),
  }).describe('A message in the OpenAI-compatible chat completion request.')).describe('The ordered conversation history to send to the model.'),
  frequency_penalty: z.number().min(-2).max(2).describe('The frequency penalty to apply to repeated tokens.').optional(),
  logprobs: z.boolean().describe('Whether to include token-level log probability details in the response.').optional(),
  max_tokens: z.int().min(1).describe('The maximum number of tokens to generate.').optional(),
  presence_penalty: z.number().min(-2).max(2).describe('The presence penalty to apply to newly introduced tokens.').optional(),
  response_format: z.strictObject({
    type: z.enum(['text', 'json_object']).describe('The response format type requested from the model.').optional(),
  }).optional(),
  stop: z.union([z.string().describe('A single stop sequence.'), z.array(z.string().describe('A stop sequence.')).describe('A list of stop sequences.')]).describe('One or more sequences that stop generation.').optional(),
  stream: z.boolean().describe('Whether to request a streaming response. This connector only accepts false or omission.').optional(),
  stream_options: z.strictObject({
    include_usage: z.boolean().describe('Whether usage information should be included in stream chunks.').optional(),
  }).describe('Streaming options for the request.').optional(),
  temperature: z.number().min(0).max(2).describe('The sampling temperature to use for generation.').optional(),
  thinking: z.strictObject({
    type: z.enum(['enabled', 'disabled']).describe('Whether reasoning mode should be enabled for the request.').optional(),
  }).optional(),
  tool_choice: z.union([z.enum(['none', 'auto', 'required']).describe('A predefined tool selection strategy for the request.'), z.looseObject({
    type: z.literal('function').describe('The tool choice type. Must be function.').optional(),
    function: z.strictObject({
      name: z.string().describe('The name of the function tool to force.').optional(),
    }).optional(),
  }).describe('A tool choice that forces one specific function tool.')]).describe('The tool selection policy for the chat completion request.').optional(),
  tools: z.array(z.looseObject({
    type: z.literal('function').describe('The tool type. Must be function.').optional(),
    function: z.looseObject({
      name: z.string().describe('The function name exposed to the model.').optional(),
      description: z.string().describe('A human-readable description of the function.').optional(),
      parameters: z.record(z.string(), z.unknown().describe('Any JSON value accepted by the DeepSeek API.')).describe('A JSON object passed through to the DeepSeek API.').optional(),
      strict: z.boolean().describe('Whether the model must follow the declared parameter schema exactly.').optional(),
    }).describe('The function definition for an OpenAI-compatible tool.').optional(),
  }).describe('An OpenAI-compatible tool definition.')).describe('The tools available to the model.').optional(),
  top_logprobs: z.int().min(0).max(20).describe('The number of top token log probabilities to return.').optional(),
  top_p: z.number().min(0).max(1).describe('The nucleus sampling threshold.').optional(),
}).describe('The input payload for the OpenAI-compatible chat completion action.')

export const createChatCompletionOutput = z.looseObject({}).describe('The response payload for the chat completion action.')

export const createAnthropicMessageInput = z.strictObject({
  model: z.enum(['deepseek-chat', 'deepseek-reasoner']).describe('The DeepSeek model identifier.'),
  max_tokens: z.int().min(1).describe('The maximum number of tokens to generate.'),
  messages: z.array(z.strictObject({
    role: z.enum(['user', 'assistant']).describe('The role of the message author.').optional(),
    content: z.union([z.string().describe('Plain text content.'), z.array(z.record(z.string(), z.unknown().describe('Any JSON value accepted by the DeepSeek API.')).describe('A JSON object passed through to the DeepSeek API.')).describe('Structured content blocks.')]).describe('Message content as plain text or structured blocks.').optional(),
  })).describe('The ordered conversation history to send to the model.'),
  stop_sequences: z.array(z.string().describe('A stop sequence.')).describe('Sequences that stop generation.').optional(),
  stream: z.boolean().describe('Whether to request a streaming response. This connector only accepts false or omission.').optional(),
  system: z.union([z.string().describe('Plain text content.'), z.array(z.record(z.string(), z.unknown().describe('Any JSON value accepted by the DeepSeek API.')).describe('A JSON object passed through to the DeepSeek API.')).describe('Structured content blocks.')]).describe('Message content as plain text or structured blocks.').optional(),
  temperature: z.number().min(0).max(2).describe('The sampling temperature to use for generation.').optional(),
  thinking: z.looseObject({
    type: z.string().describe('The thinking mode requested by the Anthropic-compatible API.').optional(),
    budget_tokens: z.int().describe('The maximum number of tokens allocated to thinking.').optional(),
  }).describe('Thinking configuration for the Anthropic-compatible request.').optional(),
  tool_choice: z.union([z.enum(['auto', 'any', 'none']).describe('A predefined Anthropic-compatible tool choice mode.'), z.record(z.string(), z.unknown().describe('Any JSON value accepted by the DeepSeek API.')).describe('A JSON object passed through to the DeepSeek API.')]).describe('How the model should choose tools for the request.').optional(),
  tools: z.array(z.record(z.string(), z.unknown().describe('Any JSON value accepted by the DeepSeek API.')).describe('A JSON object passed through to the DeepSeek API.')).describe('The tools available to the model.').optional(),
  top_p: z.number().describe('The nucleus sampling threshold.').optional(),
}).describe('The input payload for the Anthropic-compatible message action.')

export const createAnthropicMessageOutput = z.looseObject({}).describe('The response payload for the Anthropic-compatible message action.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const deepseekActions = {
  list_models: {
    description: 'List the available DeepSeek models.',
    effect: 'read',
    inputSchema: listModelsInput,
    outputSchema: z.toJSONSchema(listModelsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_user_balance: {
    description: 'Get the current DeepSeek account balance.',
    effect: 'read',
    inputSchema: getUserBalanceInput,
    outputSchema: z.toJSONSchema(getUserBalanceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_chat_completion: {
    description: 'Create a DeepSeek chat completion via the OpenAI-compatible API.',
    effect: 'write',
    inputSchema: createChatCompletionInput,
    outputSchema: z.toJSONSchema(createChatCompletionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_anthropic_message: {
    description: 'Create a DeepSeek message via the Anthropic-compatible API.',
    effect: 'write',
    inputSchema: createAnthropicMessageInput,
    outputSchema: z.toJSONSchema(createAnthropicMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
