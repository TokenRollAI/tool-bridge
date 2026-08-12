/**
 * Apify 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getCurrentUserInput = z.strictObject({}).describe('The input for retrieving the current Apify user.')

export const getCurrentUserOutput = z.strictObject({
  user: z.looseObject({
    id: z.string().describe('The Apify user identifier.').optional(),
    username: z.string().describe('The Apify username.'),
    email: z.string().describe('The email address of the Apify user.').optional(),
    plan: z.looseObject({}).describe('The Apify subscription plan.').optional(),
    proxy: z.looseObject({}).describe('The Apify proxy configuration.').optional(),
  }).describe('The current Apify user account.').optional(),
}).describe('The current authenticated Apify user response.')

export const getActorInput = z.strictObject({
  actorId: z.string().min(1).describe('The Apify actor identifier, such as apify~web-scraper or apify/web-scraper.').optional(),
}).describe('The input for retrieving one Apify actor.')

export const getActorOutput = z.strictObject({
  actor: z.looseObject({
    id: z.string().describe('The Apify actor identifier.'),
    userId: z.string().describe('The owner user identifier.'),
    name: z.string().describe('The internal actor name.'),
    username: z.string().describe('The actor owner\'s username.'),
    title: z.string().describe('The actor display title.').optional(),
    description: z.string().describe('The actor description.').optional(),
    isPublic: z.boolean().describe('Whether the actor is public.'),
    createdAt: z.string().describe('When the actor was created.').optional(),
    modifiedAt: z.string().describe('When the actor was last modified.').optional(),
    stats: z.looseObject({}).describe('Actor usage and popularity statistics.').optional(),
  }).describe('An Apify actor.').optional(),
}).describe('The Apify actor response.')

export const runActorInput = z.strictObject({
  actorId: z.string().min(1).describe('The Apify actor identifier, such as apify~web-scraper or apify/web-scraper.'),
  input: z.record(z.string(), z.unknown().describe('A JSON-compatible Apify value.')).describe('The JSON input object passed to the actor run.').optional(),
  build: z.string().min(1).describe('The actor build tag or number to run.').optional(),
  memoryMbytes: z.int().min(1).describe('The memory limit for the run in megabytes.').optional(),
  timeoutSecs: z.int().min(1).describe('The maximum runtime for the run in seconds.').optional(),
}).describe('The input for starting one Apify actor run.')

export const runActorOutput = z.strictObject({
  run: z.looseObject({
    id: z.string().describe('The Apify run identifier.'),
    actId: z.string().describe('The actor identifier associated with the run.'),
    status: z.string().describe('The current run status.'),
    startedAt: z.string().describe('When the run started.').optional(),
    finishedAt: z.string().describe('When the run finished.').optional(),
    defaultDatasetId: z.string().describe('The default dataset identifier created for the run.').optional(),
    defaultKeyValueStoreId: z.string().describe('The default key-value store identifier created for the run.').optional(),
    defaultRequestQueueId: z.string().describe('The default request queue identifier created for the run.').optional(),
    stats: z.looseObject({}).describe('The run statistics object.').optional(),
    options: z.looseObject({}).describe('The run options object.').optional(),
    usage: z.looseObject({}).describe('The run usage summary object.').optional(),
  }).describe('An Apify actor run.').optional(),
}).describe('The Apify actor run creation response.')

export const getRunInput = z.strictObject({
  runId: z.string().min(1).describe('The Apify actor run identifier.'),
  waitForFinishSeconds: z.int().min(0).max(60).describe('How many seconds to wait for run completion before returning.').optional(),
}).describe('The input for retrieving one Apify actor run.')

export const getRunOutput = z.strictObject({
  run: z.looseObject({
    id: z.string().describe('The Apify run identifier.'),
    actId: z.string().describe('The actor identifier associated with the run.'),
    status: z.string().describe('The current run status.'),
    startedAt: z.string().describe('When the run started.').optional(),
    finishedAt: z.string().describe('When the run finished.').optional(),
    defaultDatasetId: z.string().describe('The default dataset identifier created for the run.').optional(),
    defaultKeyValueStoreId: z.string().describe('The default key-value store identifier created for the run.').optional(),
    defaultRequestQueueId: z.string().describe('The default request queue identifier created for the run.').optional(),
    stats: z.looseObject({}).describe('The run statistics object.').optional(),
    options: z.looseObject({}).describe('The run options object.').optional(),
    usage: z.looseObject({}).describe('The run usage summary object.').optional(),
  }).describe('An Apify actor run.').optional(),
}).describe('The Apify actor run response.')

export const getDatasetItemsInput = z.strictObject({
  datasetId: z.string().min(1).describe('The Apify dataset identifier.'),
  limit: z.int().min(1).describe('The maximum number of items to return.').optional(),
  offset: z.int().min(0).describe('How many items to skip before returning results.').optional(),
  clean: z.boolean().describe('Whether hidden fields and empty values should be removed from each item.').optional(),
  skipHidden: z.boolean().describe('Whether fields starting with a hash sign should be skipped.').optional(),
}).describe('The input for retrieving items from an Apify dataset.')

export const getDatasetItemsOutput = z.strictObject({
  items: z.array(z.record(z.string(), z.unknown().describe('A JSON-compatible Apify value.'))).describe('The ordered list of Apify dataset items.').optional(),
}).describe('The Apify dataset items response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const apifyActions = {
  get_current_user: {
    description: 'Retrieve the currently authenticated Apify user account.',
    effect: 'read',
    inputSchema: getCurrentUserInput,
    outputSchema: z.toJSONSchema(getCurrentUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_actor: {
    description: 'Retrieve metadata for one Apify actor by identifier.',
    effect: 'read',
    inputSchema: getActorInput,
    outputSchema: z.toJSONSchema(getActorOutput, { io: 'output', unrepresentable: 'any' }),
  },
  run_actor: {
    description: 'Start one Apify actor run with an optional JSON input payload.',
    effect: 'write',
    inputSchema: runActorInput,
    outputSchema: z.toJSONSchema(runActorOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_run: {
    description: 'Retrieve the current status and storage identifiers for one Apify actor run.',
    effect: 'read',
    inputSchema: getRunInput,
    outputSchema: z.toJSONSchema(getRunOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_dataset_items: {
    description: 'Retrieve JSON items from one Apify dataset.',
    effect: 'read',
    inputSchema: getDatasetItemsInput,
    outputSchema: z.toJSONSchema(getDatasetItemsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
