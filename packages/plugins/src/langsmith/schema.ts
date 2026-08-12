/**
 * LangSmith 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listWorkspacesInput = z.strictObject({
  include_deleted: z.boolean().describe('Whether to include deleted workspaces in the response.').optional(),
  data_plane_id: z.uuid().describe('The LangSmith UUID.').optional(),
}).describe('Input parameters for listing LangSmith workspaces.')

export const listWorkspacesOutput = z.strictObject({
  workspaces: z.array(z.strictObject({
    id: z.uuid().describe('The LangSmith UUID.').optional(),
    organization_id: z.uuid().describe('The organization ID that owns the workspace.').nullable().optional(),
    display_name: z.string().describe('The workspace display name.').optional(),
    is_personal: z.boolean().describe('Whether this is a personal workspace.').optional(),
    is_deleted: z.boolean().describe('Whether LangSmith marks the workspace as deleted.').optional(),
    tenant_handle: z.string().describe('The workspace handle when returned.').nullable().optional(),
    data_plane_url: z.string().describe('The workspace data-plane URL when returned.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw workspace object returned by LangSmith.').optional(),
  }).describe('A LangSmith workspace visible to the API key.')).describe('The workspaces returned by LangSmith.').optional(),
}).describe('The response returned when listing LangSmith workspaces.')

export const listProjectsInput = z.strictObject({
  name: z.string().min(1).describe('A non-empty project name.').optional(),
  name_contains: z.string().min(1).describe('A non-empty project name fragment.').optional(),
  include_stats: z.boolean().describe('Whether LangSmith should include project statistics.').optional(),
  sort_by_desc: z.boolean().describe('Whether LangSmith should sort descending.').optional(),
  offset: z.int().min(0).describe('The number of records to skip.').optional(),
  limit: z.int().min(1).max(100).describe('The maximum number of records to return.').optional(),
}).describe('Input parameters for listing LangSmith projects.')

export const listProjectsOutput = z.strictObject({
  projects: z.array(z.strictObject({
    id: z.uuid().describe('The LangSmith UUID.').optional(),
    tenant_id: z.uuid().describe('The LangSmith UUID.').optional(),
    name: z.string().describe('The project name when returned.').nullable().optional(),
    description: z.string().describe('The project description when returned.').nullable().optional(),
    start_time: z.string().describe('The project start timestamp when returned.').nullable().optional(),
    end_time: z.string().describe('The project end timestamp when returned.').nullable().optional(),
    run_count: z.int().describe('The number of runs in the project when returned.').nullable().optional(),
    error_rate: z.number().describe('The project error rate when returned.').nullable().optional(),
    default_dataset_id: z.uuid().describe('The default dataset ID when returned.').nullable().optional(),
    reference_dataset_id: z.uuid().describe('The reference dataset ID when returned.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw project object returned by LangSmith.').optional(),
  }).describe('A LangSmith tracing project.')).describe('The projects returned by LangSmith.').optional(),
}).describe('The response returned when listing LangSmith projects.')

export const getProjectInput = z.strictObject({
  projectId: z.uuid().describe('The LangSmith UUID.'),
  include_stats: z.boolean().describe('Whether LangSmith should include project statistics.').optional(),
}).describe('Input parameters for getting a LangSmith project.')

export const getProjectOutput = z.strictObject({
  project: z.strictObject({
    id: z.uuid().describe('The LangSmith UUID.').optional(),
    tenant_id: z.uuid().describe('The LangSmith UUID.').optional(),
    name: z.string().describe('The project name when returned.').nullable().optional(),
    description: z.string().describe('The project description when returned.').nullable().optional(),
    start_time: z.string().describe('The project start timestamp when returned.').nullable().optional(),
    end_time: z.string().describe('The project end timestamp when returned.').nullable().optional(),
    run_count: z.int().describe('The number of runs in the project when returned.').nullable().optional(),
    error_rate: z.number().describe('The project error rate when returned.').nullable().optional(),
    default_dataset_id: z.uuid().describe('The default dataset ID when returned.').nullable().optional(),
    reference_dataset_id: z.uuid().describe('The reference dataset ID when returned.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw project object returned by LangSmith.').optional(),
  }).describe('A LangSmith tracing project.').optional(),
}).describe('The response returned when getting a LangSmith project.')

export const createProjectInput = z.strictObject({
  name: z.string().min(1).describe('The project name.'),
  description: z.string().describe('The project description.').optional(),
  start_time: z.string().describe('The project start timestamp.').optional(),
  end_time: z.string().describe('The project end timestamp.').optional(),
  extra: z.looseObject({}).describe('A JSON object forwarded to or returned by LangSmith.').optional(),
  default_dataset_id: z.uuid().describe('The LangSmith UUID.').optional(),
  reference_dataset_id: z.uuid().describe('The LangSmith UUID.').optional(),
  upsert: z.boolean().describe('Whether LangSmith should upsert a project with the same name.').optional(),
}).describe('Input parameters for creating a LangSmith project.')

export const createProjectOutput = z.strictObject({
  project: z.strictObject({
    id: z.uuid().describe('The LangSmith UUID.').optional(),
    tenant_id: z.uuid().describe('The LangSmith UUID.').optional(),
    name: z.string().describe('The project name when returned.').nullable().optional(),
    description: z.string().describe('The project description when returned.').nullable().optional(),
    start_time: z.string().describe('The project start timestamp when returned.').nullable().optional(),
    end_time: z.string().describe('The project end timestamp when returned.').nullable().optional(),
    run_count: z.int().describe('The number of runs in the project when returned.').nullable().optional(),
    error_rate: z.number().describe('The project error rate when returned.').nullable().optional(),
    default_dataset_id: z.uuid().describe('The default dataset ID when returned.').nullable().optional(),
    reference_dataset_id: z.uuid().describe('The reference dataset ID when returned.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw project object returned by LangSmith.').optional(),
  }).describe('A LangSmith tracing project.').optional(),
}).describe('The response returned when creating a LangSmith project.')

export const listDatasetsInput = z.strictObject({
  name: z.string().min(1).describe('A non-empty dataset name.').optional(),
  name_contains: z.string().min(1).describe('A non-empty dataset name fragment.').optional(),
  data_type: z.enum(['kv', 'llm', 'chat']).describe('The LangSmith dataset data type.').optional(),
  offset: z.int().min(0).describe('The number of records to skip.').optional(),
  limit: z.int().min(1).max(100).describe('The maximum number of records to return.').optional(),
}).describe('Input parameters for listing LangSmith datasets.')

export const listDatasetsOutput = z.strictObject({
  datasets: z.array(z.strictObject({
    id: z.uuid().describe('The LangSmith UUID.').optional(),
    tenant_id: z.uuid().describe('The LangSmith UUID.').optional(),
    name: z.string().describe('The dataset name.').optional(),
    description: z.string().describe('The dataset description when returned.').nullable().optional(),
    data_type: z.enum(['kv', 'llm', 'chat']).describe('The LangSmith dataset data type.').nullable().optional(),
    created_at: z.string().describe('The dataset creation timestamp when returned.').nullable().optional(),
    modified_at: z.string().describe('The dataset modification timestamp when returned.').nullable().optional(),
    example_count: z.int().describe('The dataset example count when returned.').nullable().optional(),
    session_count: z.int().describe('The dataset experiment session count when returned.').nullable().optional(),
    metadata: z.looseObject({}).describe('Provider-defined metadata forwarded to LangSmith.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw dataset object returned by LangSmith.').optional(),
  }).describe('A LangSmith dataset.')).describe('The datasets returned by LangSmith.').optional(),
}).describe('The response returned when listing LangSmith datasets.')

export const getDatasetInput = z.strictObject({
  datasetId: z.uuid().describe('The LangSmith UUID.').optional(),
}).describe('Input parameters for getting a LangSmith dataset.')

export const getDatasetOutput = z.strictObject({
  dataset: z.strictObject({
    id: z.uuid().describe('The LangSmith UUID.').optional(),
    tenant_id: z.uuid().describe('The LangSmith UUID.').optional(),
    name: z.string().describe('The dataset name.').optional(),
    description: z.string().describe('The dataset description when returned.').nullable().optional(),
    data_type: z.enum(['kv', 'llm', 'chat']).describe('The LangSmith dataset data type.').nullable().optional(),
    created_at: z.string().describe('The dataset creation timestamp when returned.').nullable().optional(),
    modified_at: z.string().describe('The dataset modification timestamp when returned.').nullable().optional(),
    example_count: z.int().describe('The dataset example count when returned.').nullable().optional(),
    session_count: z.int().describe('The dataset experiment session count when returned.').nullable().optional(),
    metadata: z.looseObject({}).describe('Provider-defined metadata forwarded to LangSmith.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw dataset object returned by LangSmith.').optional(),
  }).describe('A LangSmith dataset.').optional(),
}).describe('The response returned when getting a LangSmith dataset.')

export const createDatasetInput = z.strictObject({
  name: z.string().min(1).describe('The dataset name.'),
  description: z.string().describe('The dataset description.').optional(),
  data_type: z.enum(['kv', 'llm', 'chat']).describe('The LangSmith dataset data type.').optional(),
  inputs_schema_definition: z.looseObject({}).describe('A JSON object forwarded to or returned by LangSmith.').optional(),
  outputs_schema_definition: z.looseObject({}).describe('A JSON object forwarded to or returned by LangSmith.').optional(),
  metadata: z.looseObject({}).describe('Provider-defined metadata forwarded to LangSmith.').optional(),
  externally_managed: z.boolean().describe('Whether the dataset is externally managed.').optional(),
}).describe('Input parameters for creating a LangSmith dataset.')

export const createDatasetOutput = z.strictObject({
  dataset: z.strictObject({
    id: z.uuid().describe('The LangSmith UUID.').optional(),
    tenant_id: z.uuid().describe('The LangSmith UUID.').optional(),
    name: z.string().describe('The dataset name.').optional(),
    description: z.string().describe('The dataset description when returned.').nullable().optional(),
    data_type: z.enum(['kv', 'llm', 'chat']).describe('The LangSmith dataset data type.').nullable().optional(),
    created_at: z.string().describe('The dataset creation timestamp when returned.').nullable().optional(),
    modified_at: z.string().describe('The dataset modification timestamp when returned.').nullable().optional(),
    example_count: z.int().describe('The dataset example count when returned.').nullable().optional(),
    session_count: z.int().describe('The dataset experiment session count when returned.').nullable().optional(),
    metadata: z.looseObject({}).describe('Provider-defined metadata forwarded to LangSmith.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw dataset object returned by LangSmith.').optional(),
  }).describe('A LangSmith dataset.').optional(),
}).describe('The response returned when creating a LangSmith dataset.')

export const listExamplesInput = z.strictObject({
  datasetId: z.uuid().describe('The LangSmith UUID.').optional(),
  full_text_contains: z.array(z.string().min(1).describe('A text fragment.')).min(1).describe('Text fragments that LangSmith should search for.').optional(),
  as_of: z.string().describe('The dataset version timestamp or latest.').optional(),
  offset: z.int().min(0).describe('The number of records to skip.').optional(),
  limit: z.int().min(1).max(100).describe('The maximum number of records to return.').optional(),
}).describe('Input parameters for listing LangSmith examples.')

export const listExamplesOutput = z.strictObject({
  examples: z.array(z.strictObject({
    id: z.uuid().describe('The LangSmith UUID.').optional(),
    dataset_id: z.uuid().describe('The LangSmith UUID.').optional(),
    name: z.string().describe('The example name when returned.').nullable().optional(),
    created_at: z.string().describe('The example creation timestamp when returned.').nullable().optional(),
    modified_at: z.string().describe('The example modification timestamp when returned.').nullable().optional(),
    inputs: z.looseObject({}).describe('The example input values.').optional(),
    outputs: z.looseObject({}).describe('A JSON object forwarded to or returned by LangSmith.').nullable().optional(),
    metadata: z.looseObject({}).describe('Provider-defined metadata forwarded to LangSmith.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw example object returned by LangSmith.').optional(),
  }).describe('A LangSmith dataset example.')).describe('The examples returned by LangSmith.').optional(),
}).describe('The response returned when listing LangSmith examples.')

export const getExampleInput = z.strictObject({
  exampleId: z.uuid().describe('The LangSmith UUID.'),
  datasetId: z.uuid().describe('The LangSmith UUID.').optional(),
  as_of: z.string().describe('The dataset version timestamp or latest.').optional(),
}).describe('Input parameters for getting a LangSmith example.')

export const getExampleOutput = z.strictObject({
  example: z.strictObject({
    id: z.uuid().describe('The LangSmith UUID.').optional(),
    dataset_id: z.uuid().describe('The LangSmith UUID.').optional(),
    name: z.string().describe('The example name when returned.').nullable().optional(),
    created_at: z.string().describe('The example creation timestamp when returned.').nullable().optional(),
    modified_at: z.string().describe('The example modification timestamp when returned.').nullable().optional(),
    inputs: z.looseObject({}).describe('The example input values.').optional(),
    outputs: z.looseObject({}).describe('A JSON object forwarded to or returned by LangSmith.').nullable().optional(),
    metadata: z.looseObject({}).describe('Provider-defined metadata forwarded to LangSmith.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw example object returned by LangSmith.').optional(),
  }).describe('A LangSmith dataset example.').optional(),
}).describe('The response returned when getting a LangSmith example.')

export const createExampleInput = z.strictObject({
  datasetId: z.uuid().describe('The LangSmith UUID.'),
  inputs: z.looseObject({}).describe('A JSON object forwarded to or returned by LangSmith.').optional(),
  outputs: z.looseObject({}).describe('A JSON object forwarded to or returned by LangSmith.').optional(),
  metadata: z.looseObject({}).describe('Provider-defined metadata forwarded to LangSmith.').optional(),
  split: z.union([z.string().min(1).describe('A single split name.'), z.array(z.string().min(1).describe('A split name.')).min(1).describe('A list of split names.')]).describe('One or more LangSmith dataset splits.').optional(),
  id: z.uuid().describe('The LangSmith UUID.').optional(),
  created_at: z.string().describe('The example creation timestamp.').optional(),
}).describe('Input parameters for creating a LangSmith example.')

export const createExampleOutput = z.strictObject({
  example: z.strictObject({
    id: z.uuid().describe('The LangSmith UUID.').optional(),
    dataset_id: z.uuid().describe('The LangSmith UUID.').optional(),
    name: z.string().describe('The example name when returned.').nullable().optional(),
    created_at: z.string().describe('The example creation timestamp when returned.').nullable().optional(),
    modified_at: z.string().describe('The example modification timestamp when returned.').nullable().optional(),
    inputs: z.looseObject({}).describe('The example input values.').optional(),
    outputs: z.looseObject({}).describe('A JSON object forwarded to or returned by LangSmith.').nullable().optional(),
    metadata: z.looseObject({}).describe('Provider-defined metadata forwarded to LangSmith.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw example object returned by LangSmith.').optional(),
  }).describe('A LangSmith dataset example.').optional(),
}).describe('The response returned when creating a LangSmith example.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const langsmithActions = {
  list_workspaces: {
    description: 'List LangSmith workspaces visible to the connected API key.',
    effect: 'read',
    inputSchema: listWorkspacesInput,
    outputSchema: z.toJSONSchema(listWorkspacesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_projects: {
    description: 'List LangSmith tracing projects with optional name and pagination filters.',
    effect: 'read',
    inputSchema: listProjectsInput,
    outputSchema: z.toJSONSchema(listProjectsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_project: {
    description: 'Get a LangSmith tracing project by ID.',
    effect: 'read',
    inputSchema: getProjectInput,
    outputSchema: z.toJSONSchema(getProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_project: {
    description: 'Create a LangSmith tracing project.',
    effect: 'write',
    inputSchema: createProjectInput,
    outputSchema: z.toJSONSchema(createProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_datasets: {
    description: 'List LangSmith datasets with optional name, type, and pagination filters.',
    effect: 'read',
    inputSchema: listDatasetsInput,
    outputSchema: z.toJSONSchema(listDatasetsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_dataset: {
    description: 'Get a LangSmith dataset by ID.',
    effect: 'read',
    inputSchema: getDatasetInput,
    outputSchema: z.toJSONSchema(getDatasetOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_dataset: {
    description: 'Create a LangSmith dataset.',
    effect: 'write',
    inputSchema: createDatasetInput,
    outputSchema: z.toJSONSchema(createDatasetOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_examples: {
    description: 'List LangSmith dataset examples with optional dataset and text filters.',
    effect: 'read',
    inputSchema: listExamplesInput,
    outputSchema: z.toJSONSchema(listExamplesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_example: {
    description: 'Get a LangSmith dataset example by ID.',
    effect: 'read',
    inputSchema: getExampleInput,
    outputSchema: z.toJSONSchema(getExampleOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_example: {
    description: 'Create a LangSmith dataset example with JSON inputs, outputs, and metadata.',
    effect: 'write',
    inputSchema: createExampleInput,
    outputSchema: z.toJSONSchema(createExampleOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
