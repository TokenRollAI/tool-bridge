/**
 * Replicate 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getAccountInput = z.strictObject({}).describe('No input parameters are required.')

export const getAccountOutput = z.looseObject({
  account: z.looseObject({}).describe('A Replicate API object.'),
}).describe('The authenticated Replicate account response.')

export const listModelsInput = z.strictObject({
  sortBy: z.enum(['model_created_at', 'latest_version_created_at']).describe('The field used to sort public Replicate models.').optional(),
  sortDirection: z.enum(['asc', 'desc']).describe('The sort direction for Replicate model results.').optional(),
}).describe('Input for listing public Replicate models.')

export const listModelsOutput = z.looseObject({
  models: z.array(z.looseObject({}).describe('A Replicate API object.')).describe('The Replicate models returned for this page.'),
  next: z.url().describe('A Replicate pagination URL.').nullable(),
  previous: z.url().describe('A Replicate pagination URL.').nullable(),
}).describe('A paginated list of Replicate models.')

export const getModelInput = z.strictObject({
  owner: z.string().min(1).describe('The Replicate model owner username or organization slug.').optional(),
  model: z.string().min(1).describe('The Replicate model name slug.').optional(),
}).describe('Input for selecting a Replicate model.')

export const getModelOutput = z.looseObject({
  model: z.looseObject({}).describe('A Replicate API object.'),
}).describe('A Replicate model response.')

export const listModelVersionsInput = z.strictObject({
  owner: z.string().min(1).describe('The Replicate model owner username or organization slug.').optional(),
  model: z.string().min(1).describe('The Replicate model name slug.').optional(),
}).describe('Input for selecting a Replicate model.')

export const listModelVersionsOutput = z.looseObject({
  versions: z.array(z.looseObject({}).describe('A Replicate API object.')).describe('The model versions returned for this page.'),
  next: z.url().describe('A Replicate pagination URL.').nullable(),
  previous: z.url().describe('A Replicate pagination URL.').nullable(),
}).describe('A paginated list of Replicate model versions.')

export const getModelVersionInput = z.strictObject({
  owner: z.string().min(1).describe('The Replicate model owner username or organization slug.').optional(),
  model: z.string().min(1).describe('The Replicate model name slug.').optional(),
  versionId: z.string().min(1).describe('The Replicate model version identifier.').optional(),
}).describe('Input for selecting a Replicate model version.')

export const getModelVersionOutput = z.looseObject({
  version: z.looseObject({}).describe('A Replicate API object.'),
}).describe('A Replicate model version response.')

export const listCollectionsInput = z.strictObject({}).describe('No input parameters are required.')

export const listCollectionsOutput = z.looseObject({
  collections: z.array(z.looseObject({}).describe('A Replicate API object.')).describe('The Replicate collections returned for this page.'),
  next: z.url().describe('A Replicate pagination URL.').nullable(),
  previous: z.url().describe('A Replicate pagination URL.').nullable(),
}).describe('A paginated list of Replicate collections.')

export const getCollectionInput = z.strictObject({
  collectionSlug: z.string().min(1).describe('The Replicate collection slug.').optional(),
}).describe('Input for selecting a Replicate collection.')

export const getCollectionOutput = z.looseObject({
  collection: z.looseObject({}).describe('A Replicate API object.'),
}).describe('A Replicate collection response.')

export const createPredictionInput = z.strictObject({
  version: z.string().min(1).describe('The Replicate model identifier, model version identifier, or owner/model:version reference.'),
  input: z.looseObject({}).describe('A JSON-serializable model input object.'),
  waitSeconds: z.int().min(1).max(60).describe('Seconds to wait synchronously for prediction output.').optional(),
  cancelAfter: z.string().min(1).describe('Maximum prediction runtime before Replicate cancels it, such as 30s, 5m, or 1h30m.').optional(),
  webhook: z.url().describe('An HTTPS webhook URL for Replicate prediction events.').optional(),
  webhookEventsFilter: z.array(z.enum(['start', 'output', 'logs', 'completed']).describe('One Replicate webhook event filter.')).min(1).describe('The Replicate prediction event types that should trigger the webhook.').optional(),
}).describe('Input for creating a Replicate prediction from a model or model version.')

export const createPredictionOutput = z.looseObject({
  prediction: z.looseObject({}).describe('A Replicate API object.'),
}).describe('A Replicate prediction response.')

export const getPredictionInput = z.strictObject({
  predictionId: z.string().min(1).describe('The Replicate prediction identifier.').optional(),
}).describe('Input for selecting a Replicate prediction.')

export const getPredictionOutput = z.looseObject({
  prediction: z.looseObject({}).describe('A Replicate API object.'),
}).describe('A Replicate prediction response.')

export const listPredictionsInput = z.strictObject({
  createdAfter: z.iso.datetime({ offset: true }).describe('Include predictions created at or after this ISO 8601 timestamp.').optional(),
  createdBefore: z.iso.datetime({ offset: true }).describe('Include predictions created before this ISO 8601 timestamp.').optional(),
  source: z.literal('web').describe('Filter predictions to those created from the Replicate website.').optional(),
}).describe('Input for filtering Replicate predictions.')

export const listPredictionsOutput = z.looseObject({
  predictions: z.array(z.looseObject({}).describe('A Replicate API object.')).describe('The Replicate predictions returned for this page.'),
  next: z.url().describe('A Replicate pagination URL.').nullable(),
  previous: z.url().describe('A Replicate pagination URL.').nullable(),
}).describe('A paginated list of Replicate predictions.')

export const cancelPredictionInput = z.strictObject({
  predictionId: z.string().min(1).describe('The Replicate prediction identifier.').optional(),
}).describe('Input for selecting a Replicate prediction.')

export const cancelPredictionOutput = z.looseObject({
  prediction: z.looseObject({}).describe('A Replicate API object.'),
}).describe('A Replicate prediction response after cancellation.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const replicateActions = {
  get_account: {
    description: 'Retrieve the authenticated Replicate account for the connected API token.',
    effect: 'read',
    inputSchema: getAccountInput,
    outputSchema: z.toJSONSchema(getAccountOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_models: {
    description: 'List public Replicate models with optional official sorting parameters.',
    effect: 'read',
    inputSchema: listModelsInput,
    outputSchema: z.toJSONSchema(listModelsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_model: {
    description: 'Retrieve one Replicate model by owner and model slug.',
    effect: 'read',
    inputSchema: getModelInput,
    outputSchema: z.toJSONSchema(getModelOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_model_versions: {
    description: 'List versions for one Replicate model.',
    effect: 'read',
    inputSchema: listModelVersionsInput,
    outputSchema: z.toJSONSchema(listModelVersionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_model_version: {
    description: 'Retrieve one Replicate model version by owner, model, and version ID.',
    effect: 'read',
    inputSchema: getModelVersionInput,
    outputSchema: z.toJSONSchema(getModelVersionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_collections: {
    description: 'List public Replicate model collections.',
    effect: 'read',
    inputSchema: listCollectionsInput,
    outputSchema: z.toJSONSchema(listCollectionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_collection: {
    description: 'Retrieve one Replicate collection by slug.',
    effect: 'read',
    inputSchema: getCollectionInput,
    outputSchema: z.toJSONSchema(getCollectionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_prediction: {
    description: 'Create a Replicate prediction using JSON model input and optional synchronous wait headers.',
    effect: 'write',
    inputSchema: createPredictionInput,
    outputSchema: z.toJSONSchema(createPredictionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_prediction: {
    description: 'Retrieve the current state and output of a Replicate prediction.',
    effect: 'read',
    inputSchema: getPredictionInput,
    outputSchema: z.toJSONSchema(getPredictionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_predictions: {
    description: 'List Replicate predictions for the authenticated account.',
    effect: 'read',
    inputSchema: listPredictionsInput,
    outputSchema: z.toJSONSchema(listPredictionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  cancel_prediction: {
    description: 'Cancel a running Replicate prediction by prediction ID.',
    effect: 'destructive',
    inputSchema: cancelPredictionInput,
    outputSchema: z.toJSONSchema(cancelPredictionOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
