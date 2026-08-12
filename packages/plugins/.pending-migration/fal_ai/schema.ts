/**
 * fal.ai 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getModelsInput = z.strictObject({
  q: z.string().describe('The free-text search query for model discovery.').optional(),
  limit: z.int().min(1).describe('The maximum number of models to return.').optional(),
  cursor: z.string().describe('The pagination cursor from a previous response.').optional(),
  expand: z.union([z.string().describe('A single string value.'), z.array(z.string().describe('A string value in the list.')).describe('The list of strings.')]).describe('A single string or a list of strings.').optional(),
  status: z.enum(['active', 'deprecated']).describe('Filter models by active or deprecated status.').optional(),
  category: z.string().describe('Filter models by category name.').optional(),
  endpointId: z.union([z.string().describe('A single string value.'), z.array(z.string().describe('A string value in the list.')).describe('The list of strings.')]).describe('A single string or a list of strings.').optional(),
}).describe('The input payload for this action.')

export const getModelsOutput = z.strictObject({
  models: z.array(z.record(z.string(), z.unknown().describe('A raw fal property value.')).describe('The raw fal object payload.')).describe('The list of raw fal objects.'),
  hasMore: z.boolean().describe('Whether additional result pages are available.'),
  nextCursor: z.string().describe('The pagination cursor for the next page of results.').nullable(),
}).describe('The output payload for this action.')

export const getPricingInput = z.strictObject({
  endpointId: z.union([z.string().describe('A single string value.'), z.array(z.string().describe('A string value in the list.')).describe('The list of strings.')]).describe('A single string or a list of strings.'),
}).describe('The input payload for this action.')

export const getPricingOutput = z.strictObject({
  prices: z.array(z.record(z.string(), z.unknown().describe('A raw fal property value.')).describe('The raw fal object payload.')).describe('The list of raw fal objects.'),
  hasMore: z.boolean().describe('Whether additional result pages are available.'),
  nextCursor: z.string().describe('The pagination cursor for the next page of pricing results.').nullable(),
}).describe('The output payload for this action.')

export const estimatePricingInput = z.strictObject({
  estimateType: z.enum(['historical_api_price', 'unit_price']).describe('The pricing estimation method to use.'),
  endpoints: z.record(z.string(), z.unknown().describe('A raw fal property value.')).describe('The raw fal object payload.'),
}).describe('The input payload for this action.')

export const estimatePricingOutput = z.strictObject({
  estimateType: z.string().describe('The estimation method that was applied.'),
  totalCost: z.number().describe('The aggregate estimated cost across all endpoints.'),
  currency: z.string().describe('The ISO 4217 currency code for the estimate.'),
}).describe('The output payload for this action.')

export const getJwksInput = z.strictObject({}).describe('The input payload for this action.')

export const getJwksOutput = z.strictObject({
  keys: z.array(z.record(z.string(), z.unknown().describe('A raw fal property value.')).describe('The raw fal object payload.')).describe('The list of raw fal objects.'),
}).describe('The output payload for this action.')

export const queueGetStatusInput = z.strictObject({
  modelId: z.string().describe('The model identifier in namespace/name format.'),
  requestId: z.string().describe('The queued request identifier.'),
  logs: z.int().min(0).max(1).describe('Set to 1 to include logs in the response.').optional(),
}).describe('The input payload for this action.')

export const queueGetStatusOutput = z.strictObject({
  status: z.string().describe('The current queue status.'),
  responseUrl: z.string().describe('The URL for fetching the final queued response.').nullable().optional(),
  queuePosition: z.int().describe('The current queue position when the request is still queued.').nullable().optional(),
  logs: z.array(z.strictObject({
    message: z.string().describe('The log message text.').optional(),
    level: z.string().describe('The log severity level.').optional(),
    source: z.string().describe('The log source identifier.').optional(),
    timestamp: z.string().describe('The log timestamp in ISO 8601 format.').optional(),
  }).describe('A queue log entry.')).describe('The queue processing logs.').optional(),
}).describe('The output payload for this action.')

export const queueGetStatusStreamInput = z.strictObject({
  modelId: z.string().describe('The model identifier in namespace/name format.'),
  requestId: z.string().describe('The queued request identifier.'),
  logs: z.int().min(0).max(1).describe('Set to 1 to include logs inside streamed updates.').optional(),
}).describe('The input payload for this action.')

export const queueGetStatusStreamOutput = z.strictObject({
  updates: z.array(z.record(z.string(), z.unknown().describe('A raw fal property value.')).describe('The raw fal object payload.')).describe('The list of raw fal objects.'),
  finalStatus: z.string().describe('The last status value seen in the stream.').nullable().optional(),
  responseUrl: z.string().describe('The final response URL seen in the stream, if present.').nullable().optional(),
}).describe('The output payload for this action.')

export const getQueueRequestResultInput = z.strictObject({
  modelId: z.string().describe('The model identifier in namespace/name format.'),
  requestId: z.string().describe('The queued request identifier.'),
}).describe('The input payload for this action.')

export const getQueueRequestResultOutput = z.strictObject({
  status: z.string().describe('The final request status returned by the queue API.'),
  logs: z.array(z.strictObject({
    message: z.string().describe('The log message text.').optional(),
    level: z.string().describe('The log severity level.').optional(),
    source: z.string().describe('The log source identifier.').optional(),
    timestamp: z.string().describe('The log timestamp in ISO 8601 format.').optional(),
  }).describe('A queue log entry.')).describe('The logs captured for the queued request.'),
  response: z.record(z.string(), z.unknown().describe('A raw fal property value.')).describe('The raw fal object payload.'),
}).describe('The output payload for this action.')

export const cancelQueueRequestInput = z.strictObject({
  modelId: z.string().describe('The model identifier in namespace/name format.'),
  requestId: z.string().describe('The queued request identifier.'),
}).describe('The input payload for this action.')

export const cancelQueueRequestOutput = z.strictObject({
  status: z.string().describe('The cancellation result status.'),
}).describe('The output payload for this action.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const falAiActions = {
  get_models: {
    description: 'Discover fal model endpoints with optional text search, status, category, pagination, endpoint filtering, and response expansion.',
    effect: 'read',
    inputSchema: getModelsInput,
    outputSchema: z.toJSONSchema(getModelsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_pricing: {
    description: 'Retrieve unit pricing information for one or more fal model endpoints, including billing unit and currency.',
    effect: 'read',
    inputSchema: getPricingInput,
    outputSchema: z.toJSONSchema(getPricingOutput, { io: 'output', unrepresentable: 'any' }),
  },
  estimate_pricing: {
    description: 'Estimate total fal model cost using either historical API call quantities or expected billing-unit quantities.',
    effect: 'write',
    inputSchema: estimatePricingInput,
    outputSchema: z.toJSONSchema(estimatePricingOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_jwks: {
    description: 'Retrieve the fal JSON Web Key Set used for webhook signature verification.',
    effect: 'read',
    inputSchema: getJwksInput,
    outputSchema: z.toJSONSchema(getJwksOutput, { io: 'output', unrepresentable: 'any' }),
  },
  queue_get_status: {
    description: 'Check the status of a queued fal request, with optional log retrieval for in-progress or completed work.',
    effect: 'write',
    inputSchema: queueGetStatusInput,
    outputSchema: z.toJSONSchema(queueGetStatusOutput, { io: 'output', unrepresentable: 'any' }),
  },
  queue_get_status_stream: {
    description: 'Consume fal queue status updates as a streamed sequence of SSE events until the server closes the stream.',
    effect: 'write',
    inputSchema: queueGetStatusStreamInput,
    outputSchema: z.toJSONSchema(queueGetStatusStreamOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_queue_request_result: {
    description: 'Retrieve the stored final result payload for a completed fal queued request.',
    effect: 'read',
    inputSchema: getQueueRequestResultInput,
    outputSchema: z.toJSONSchema(getQueueRequestResultOutput, { io: 'output', unrepresentable: 'any' }),
  },
  cancel_queue_request: {
    description: 'Request cancellation of a queued or in-progress fal request by model ID and request ID.',
    effect: 'destructive',
    inputSchema: cancelQueueRequestInput,
    outputSchema: z.toJSONSchema(cancelQueueRequestOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
