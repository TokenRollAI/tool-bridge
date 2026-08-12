/**
 * Faraday 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getCurrentAccountInput = z.strictObject({}).describe('Input payload for this Faraday action.')

export const getCurrentAccountOutput = z.strictObject({
  account: z.looseObject({
    id: z.string().describe('The Faraday resource ID when returned.').optional(),
    name: z.string().describe('The Faraday resource name when returned.').optional(),
    resource_type: z.string().describe('The Faraday resource type when returned.').optional(),
    status: z.string().describe('The Faraday resource status when returned.').optional(),
    created_at: z.string().describe('The timestamp when the Faraday resource was created.').optional(),
    updated_at: z.string().describe('The timestamp when the Faraday resource was last updated.').optional(),
  }).describe('A Faraday account resource.'),
  raw: z.looseObject({
    id: z.string().describe('The Faraday resource ID when returned.').optional(),
    name: z.string().describe('The Faraday resource name when returned.').optional(),
    resource_type: z.string().describe('The Faraday resource type when returned.').optional(),
    status: z.string().describe('The Faraday resource status when returned.').optional(),
    created_at: z.string().describe('The timestamp when the Faraday resource was created.').optional(),
    updated_at: z.string().describe('The timestamp when the Faraday resource was last updated.').optional(),
  }).describe('A Faraday account resource.'),
}).describe('The Faraday current account response.')

export const listAccountsInput = z.strictObject({}).describe('Input payload for this Faraday action.')

export const listAccountsOutput = z.strictObject({
  accounts: z.array(z.looseObject({
    id: z.string().describe('The Faraday resource ID when returned.').optional(),
    name: z.string().describe('The Faraday resource name when returned.').optional(),
    resource_type: z.string().describe('The Faraday resource type when returned.').optional(),
    status: z.string().describe('The Faraday resource status when returned.').optional(),
    created_at: z.string().describe('The timestamp when the Faraday resource was created.').optional(),
    updated_at: z.string().describe('The timestamp when the Faraday resource was last updated.').optional(),
  }).describe('A Faraday account resource.')).describe('The Faraday account resources returned by the API.'),
  raw: z.array(z.looseObject({
    id: z.string().describe('The Faraday resource ID when returned.').optional(),
    name: z.string().describe('The Faraday resource name when returned.').optional(),
    resource_type: z.string().describe('The Faraday resource type when returned.').optional(),
    status: z.string().describe('The Faraday resource status when returned.').optional(),
    created_at: z.string().describe('The timestamp when the Faraday resource was created.').optional(),
    updated_at: z.string().describe('The timestamp when the Faraday resource was last updated.').optional(),
  }).describe('A Faraday account resource.')).describe('The raw Faraday account array returned by the API.'),
}).describe('The Faraday account list response.')

export const getAccountInput = z.strictObject({
  account_id: z.string().min(1).describe('The Faraday account ID to retrieve.'),
}).describe('Input payload for retrieving a Faraday account.')

export const getAccountOutput = z.strictObject({
  account: z.looseObject({
    id: z.string().describe('The Faraday resource ID when returned.').optional(),
    name: z.string().describe('The Faraday resource name when returned.').optional(),
    resource_type: z.string().describe('The Faraday resource type when returned.').optional(),
    status: z.string().describe('The Faraday resource status when returned.').optional(),
    created_at: z.string().describe('The timestamp when the Faraday resource was created.').optional(),
    updated_at: z.string().describe('The timestamp when the Faraday resource was last updated.').optional(),
  }).describe('A Faraday account resource.'),
  raw: z.looseObject({
    id: z.string().describe('The Faraday resource ID when returned.').optional(),
    name: z.string().describe('The Faraday resource name when returned.').optional(),
    resource_type: z.string().describe('The Faraday resource type when returned.').optional(),
    status: z.string().describe('The Faraday resource status when returned.').optional(),
    created_at: z.string().describe('The timestamp when the Faraday resource was created.').optional(),
    updated_at: z.string().describe('The timestamp when the Faraday resource was last updated.').optional(),
  }).describe('A Faraday account resource.'),
}).describe('The Faraday account response.')

export const listScopesInput = z.strictObject({}).describe('Input payload for this Faraday action.')

export const listScopesOutput = z.strictObject({
  scopes: z.array(z.looseObject({
    id: z.string().describe('The Faraday resource ID when returned.').optional(),
    name: z.string().describe('The Faraday resource name when returned.').optional(),
    resource_type: z.string().describe('The Faraday resource type when returned.').optional(),
    status: z.string().describe('The Faraday resource status when returned.').optional(),
    created_at: z.string().describe('The timestamp when the Faraday resource was created.').optional(),
    updated_at: z.string().describe('The timestamp when the Faraday resource was last updated.').optional(),
  }).describe('A Faraday scope resource.')).describe('The Faraday scope resources returned by the API.'),
  raw: z.array(z.looseObject({
    id: z.string().describe('The Faraday resource ID when returned.').optional(),
    name: z.string().describe('The Faraday resource name when returned.').optional(),
    resource_type: z.string().describe('The Faraday resource type when returned.').optional(),
    status: z.string().describe('The Faraday resource status when returned.').optional(),
    created_at: z.string().describe('The timestamp when the Faraday resource was created.').optional(),
    updated_at: z.string().describe('The timestamp when the Faraday resource was last updated.').optional(),
  }).describe('A Faraday scope resource.')).describe('The raw Faraday scope array returned by the API.'),
}).describe('The Faraday scope list response.')

export const getScopeInput = z.strictObject({
  scope_id: z.string().min(1).describe('The Faraday scope ID to retrieve.'),
}).describe('Input payload for retrieving a Faraday scope.')

export const getScopeOutput = z.strictObject({
  scope: z.looseObject({
    id: z.string().describe('The Faraday resource ID when returned.').optional(),
    name: z.string().describe('The Faraday resource name when returned.').optional(),
    resource_type: z.string().describe('The Faraday resource type when returned.').optional(),
    status: z.string().describe('The Faraday resource status when returned.').optional(),
    created_at: z.string().describe('The timestamp when the Faraday resource was created.').optional(),
    updated_at: z.string().describe('The timestamp when the Faraday resource was last updated.').optional(),
  }).describe('A Faraday scope resource.'),
  raw: z.looseObject({
    id: z.string().describe('The Faraday resource ID when returned.').optional(),
    name: z.string().describe('The Faraday resource name when returned.').optional(),
    resource_type: z.string().describe('The Faraday resource type when returned.').optional(),
    status: z.string().describe('The Faraday resource status when returned.').optional(),
    created_at: z.string().describe('The timestamp when the Faraday resource was created.').optional(),
    updated_at: z.string().describe('The timestamp when the Faraday resource was last updated.').optional(),
  }).describe('A Faraday scope resource.'),
}).describe('The Faraday scope response.')

export const listDatasetsInput = z.strictObject({}).describe('Input payload for this Faraday action.')

export const listDatasetsOutput = z.strictObject({
  datasets: z.array(z.looseObject({
    id: z.string().describe('The Faraday resource ID when returned.').optional(),
    name: z.string().describe('The Faraday resource name when returned.').optional(),
    resource_type: z.string().describe('The Faraday resource type when returned.').optional(),
    status: z.string().describe('The Faraday resource status when returned.').optional(),
    created_at: z.string().describe('The timestamp when the Faraday resource was created.').optional(),
    updated_at: z.string().describe('The timestamp when the Faraday resource was last updated.').optional(),
  }).describe('A Faraday dataset resource.')).describe('The Faraday dataset resources returned by the API.'),
  raw: z.array(z.looseObject({
    id: z.string().describe('The Faraday resource ID when returned.').optional(),
    name: z.string().describe('The Faraday resource name when returned.').optional(),
    resource_type: z.string().describe('The Faraday resource type when returned.').optional(),
    status: z.string().describe('The Faraday resource status when returned.').optional(),
    created_at: z.string().describe('The timestamp when the Faraday resource was created.').optional(),
    updated_at: z.string().describe('The timestamp when the Faraday resource was last updated.').optional(),
  }).describe('A Faraday dataset resource.')).describe('The raw Faraday dataset array returned by the API.'),
}).describe('The Faraday dataset list response.')

export const getDatasetInput = z.strictObject({
  dataset_id: z.string().min(1).describe('The Faraday dataset ID to retrieve.'),
}).describe('Input payload for retrieving a Faraday dataset.')

export const getDatasetOutput = z.strictObject({
  dataset: z.looseObject({
    id: z.string().describe('The Faraday resource ID when returned.').optional(),
    name: z.string().describe('The Faraday resource name when returned.').optional(),
    resource_type: z.string().describe('The Faraday resource type when returned.').optional(),
    status: z.string().describe('The Faraday resource status when returned.').optional(),
    created_at: z.string().describe('The timestamp when the Faraday resource was created.').optional(),
    updated_at: z.string().describe('The timestamp when the Faraday resource was last updated.').optional(),
  }).describe('A Faraday dataset resource.'),
  raw: z.looseObject({
    id: z.string().describe('The Faraday resource ID when returned.').optional(),
    name: z.string().describe('The Faraday resource name when returned.').optional(),
    resource_type: z.string().describe('The Faraday resource type when returned.').optional(),
    status: z.string().describe('The Faraday resource status when returned.').optional(),
    created_at: z.string().describe('The timestamp when the Faraday resource was created.').optional(),
    updated_at: z.string().describe('The timestamp when the Faraday resource was last updated.').optional(),
  }).describe('A Faraday dataset resource.'),
}).describe('The Faraday dataset response.')

export const listTraitsInput = z.strictObject({}).describe('Input payload for this Faraday action.')

export const listTraitsOutput = z.strictObject({
  traits: z.array(z.looseObject({
    id: z.string().describe('The Faraday resource ID when returned.').optional(),
    name: z.string().describe('The Faraday resource name when returned.').optional(),
    resource_type: z.string().describe('The Faraday resource type when returned.').optional(),
    status: z.string().describe('The Faraday resource status when returned.').optional(),
    created_at: z.string().describe('The timestamp when the Faraday resource was created.').optional(),
    updated_at: z.string().describe('The timestamp when the Faraday resource was last updated.').optional(),
  }).describe('A Faraday trait resource.')).describe('The Faraday trait resources returned by the API.'),
  raw: z.array(z.looseObject({
    id: z.string().describe('The Faraday resource ID when returned.').optional(),
    name: z.string().describe('The Faraday resource name when returned.').optional(),
    resource_type: z.string().describe('The Faraday resource type when returned.').optional(),
    status: z.string().describe('The Faraday resource status when returned.').optional(),
    created_at: z.string().describe('The timestamp when the Faraday resource was created.').optional(),
    updated_at: z.string().describe('The timestamp when the Faraday resource was last updated.').optional(),
  }).describe('A Faraday trait resource.')).describe('The raw Faraday trait array returned by the API.'),
}).describe('The Faraday trait list response.')

export const getTraitInput = z.strictObject({
  trait_id: z.string().min(1).describe('The Faraday trait ID to retrieve.'),
}).describe('Input payload for retrieving a Faraday trait.')

export const getTraitOutput = z.strictObject({
  trait: z.looseObject({
    id: z.string().describe('The Faraday resource ID when returned.').optional(),
    name: z.string().describe('The Faraday resource name when returned.').optional(),
    resource_type: z.string().describe('The Faraday resource type when returned.').optional(),
    status: z.string().describe('The Faraday resource status when returned.').optional(),
    created_at: z.string().describe('The timestamp when the Faraday resource was created.').optional(),
    updated_at: z.string().describe('The timestamp when the Faraday resource was last updated.').optional(),
  }).describe('A Faraday trait resource.'),
  raw: z.looseObject({
    id: z.string().describe('The Faraday resource ID when returned.').optional(),
    name: z.string().describe('The Faraday resource name when returned.').optional(),
    resource_type: z.string().describe('The Faraday resource type when returned.').optional(),
    status: z.string().describe('The Faraday resource status when returned.').optional(),
    created_at: z.string().describe('The timestamp when the Faraday resource was created.').optional(),
    updated_at: z.string().describe('The timestamp when the Faraday resource was last updated.').optional(),
  }).describe('A Faraday trait resource.'),
}).describe('The Faraday trait response.')

export const listTargetsInput = z.strictObject({}).describe('Input payload for this Faraday action.')

export const listTargetsOutput = z.strictObject({
  targets: z.array(z.looseObject({
    id: z.string().describe('The Faraday resource ID when returned.').optional(),
    name: z.string().describe('The Faraday resource name when returned.').optional(),
    resource_type: z.string().describe('The Faraday resource type when returned.').optional(),
    status: z.string().describe('The Faraday resource status when returned.').optional(),
    created_at: z.string().describe('The timestamp when the Faraday resource was created.').optional(),
    updated_at: z.string().describe('The timestamp when the Faraday resource was last updated.').optional(),
  }).describe('A Faraday target resource.')).describe('The Faraday target resources returned by the API.'),
  raw: z.array(z.looseObject({
    id: z.string().describe('The Faraday resource ID when returned.').optional(),
    name: z.string().describe('The Faraday resource name when returned.').optional(),
    resource_type: z.string().describe('The Faraday resource type when returned.').optional(),
    status: z.string().describe('The Faraday resource status when returned.').optional(),
    created_at: z.string().describe('The timestamp when the Faraday resource was created.').optional(),
    updated_at: z.string().describe('The timestamp when the Faraday resource was last updated.').optional(),
  }).describe('A Faraday target resource.')).describe('The raw Faraday target array returned by the API.'),
}).describe('The Faraday target list response.')

export const getTargetInput = z.strictObject({
  target_id: z.string().min(1).describe('The Faraday target ID to retrieve.'),
}).describe('Input payload for retrieving a Faraday target.')

export const getTargetOutput = z.strictObject({
  target: z.looseObject({
    id: z.string().describe('The Faraday resource ID when returned.').optional(),
    name: z.string().describe('The Faraday resource name when returned.').optional(),
    resource_type: z.string().describe('The Faraday resource type when returned.').optional(),
    status: z.string().describe('The Faraday resource status when returned.').optional(),
    created_at: z.string().describe('The timestamp when the Faraday resource was created.').optional(),
    updated_at: z.string().describe('The timestamp when the Faraday resource was last updated.').optional(),
  }).describe('A Faraday target resource.'),
  raw: z.looseObject({
    id: z.string().describe('The Faraday resource ID when returned.').optional(),
    name: z.string().describe('The Faraday resource name when returned.').optional(),
    resource_type: z.string().describe('The Faraday resource type when returned.').optional(),
    status: z.string().describe('The Faraday resource status when returned.').optional(),
    created_at: z.string().describe('The timestamp when the Faraday resource was created.').optional(),
    updated_at: z.string().describe('The timestamp when the Faraday resource was last updated.').optional(),
  }).describe('A Faraday target resource.'),
}).describe('The Faraday target response.')

export const listUsagesInput = z.strictObject({}).describe('Input payload for this Faraday action.')

export const listUsagesOutput = z.strictObject({
  usages: z.array(z.looseObject({
    name: z.string().describe('The usage metric name.').optional(),
    description: z.string().describe('The usage metric description.').optional(),
    usage: z.number().describe('The current usage value.').optional(),
    limit: z.number().describe('The usage limit value when Faraday returns one.').optional(),
  }).describe('One Faraday usage metric returned by the API.')).describe('The Faraday usage metrics returned by the API.'),
  raw: z.array(z.looseObject({
    name: z.string().describe('The usage metric name.').optional(),
    description: z.string().describe('The usage metric description.').optional(),
    usage: z.number().describe('The current usage value.').optional(),
    limit: z.number().describe('The usage limit value when Faraday returns one.').optional(),
  }).describe('One Faraday usage metric returned by the API.')).describe('The raw Faraday usage array returned by the API.'),
}).describe('The Faraday usage list response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const faradayActions = {
  get_current_account: {
    description: 'Retrieve the Faraday account identified by the API key.',
    effect: 'read',
    inputSchema: getCurrentAccountInput,
    outputSchema: z.toJSONSchema(getCurrentAccountOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_accounts: {
    description: 'List Faraday accounts controlled by the API key.',
    effect: 'read',
    inputSchema: listAccountsInput,
    outputSchema: z.toJSONSchema(listAccountsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_account: {
    description: 'Retrieve a Faraday account by ID.',
    effect: 'read',
    inputSchema: getAccountInput,
    outputSchema: z.toJSONSchema(getAccountOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_scopes: {
    description: 'List Faraday scopes defined on the account.',
    effect: 'read',
    inputSchema: listScopesInput,
    outputSchema: z.toJSONSchema(listScopesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_scope: {
    description: 'Retrieve a Faraday scope by ID.',
    effect: 'read',
    inputSchema: getScopeInput,
    outputSchema: z.toJSONSchema(getScopeOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_datasets: {
    description: 'List Faraday datasets available in the account.',
    effect: 'read',
    inputSchema: listDatasetsInput,
    outputSchema: z.toJSONSchema(listDatasetsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_dataset: {
    description: 'Retrieve a Faraday dataset by ID.',
    effect: 'read',
    inputSchema: getDatasetInput,
    outputSchema: z.toJSONSchema(getDatasetOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_traits: {
    description: 'List user-defined and Faraday-provided traits.',
    effect: 'read',
    inputSchema: listTraitsInput,
    outputSchema: z.toJSONSchema(listTraitsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_trait: {
    description: 'Retrieve a Faraday trait by ID.',
    effect: 'read',
    inputSchema: getTraitInput,
    outputSchema: z.toJSONSchema(getTraitOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_targets: {
    description: 'List Faraday targets defined on the account.',
    effect: 'read',
    inputSchema: listTargetsInput,
    outputSchema: z.toJSONSchema(listTargetsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_target: {
    description: 'Retrieve a Faraday target by ID.',
    effect: 'read',
    inputSchema: getTargetInput,
    outputSchema: z.toJSONSchema(getTargetOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_usages: {
    description: 'List Faraday usage statistics for the account.',
    effect: 'read',
    inputSchema: listUsagesInput,
    outputSchema: z.toJSONSchema(listUsagesOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
