/**
 * Chattermill 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listProjectsInput = z.strictObject({}).describe('Input for listing projects.')

export const listProjectsOutput = z.strictObject({
  projects: z.array(z.looseObject({}).describe('Raw Chattermill object.')).describe('Chattermill projects returned by the API.').optional(),
  raw: z.unknown().describe('Raw Chattermill response payload.').optional(),
})

export const getProjectInput = z.strictObject({
  id: z.string().min(1).describe('Chattermill resource identifier used in the API path.'),
})

export const getProjectOutput = z.strictObject({
  project: z.looseObject({}).describe('Raw Chattermill object.').optional(),
  raw: z.unknown().describe('Raw Chattermill response payload.').optional(),
})

export const listResponsesInput = z.looseObject({
  project: z.string().min(1).describe('Chattermill project key or identifier used in the API path.').optional(),
  page: z.int().min(1).describe('Page number to request from Chattermill.').optional(),
  perPage: z.int().min(1).describe('Maximum number of records to return per page.').optional(),
}).describe('Filters accepted by Chattermill when listing responses.')

export const listResponsesOutput = z.strictObject({
  responses: z.array(z.looseObject({}).describe('Raw Chattermill object.')).describe('Chattermill responses returned by the API.').optional(),
  raw: z.unknown().describe('Raw Chattermill response payload.').optional(),
})

export const getResponseInput = z.strictObject({
  project: z.string().min(1).describe('Chattermill project key or identifier used in the API path.'),
  id: z.string().min(1).describe('Chattermill resource identifier used in the API path.'),
}).describe('Input identifying a Chattermill project resource.')

export const getResponseOutput = z.strictObject({
  response: z.looseObject({}).describe('Raw Chattermill object.').optional(),
  raw: z.unknown().describe('Raw Chattermill response payload.').optional(),
})

export const createResponseInput = z.strictObject({
  project: z.string().min(1).describe('Chattermill project key or identifier used in the API path.'),
  response: z.looseObject({}).describe('Raw Chattermill object.'),
})

export const createResponseOutput = z.strictObject({
  response: z.looseObject({}).describe('Raw Chattermill object.').optional(),
  raw: z.unknown().describe('Raw Chattermill response payload.').optional(),
})

export const updateResponseInput = z.strictObject({
  project: z.string().min(1).describe('Chattermill project key or identifier used in the API path.'),
  responseId: z.string().min(1).describe('Chattermill resource identifier used in the API path.'),
  response: z.looseObject({}).describe('Raw Chattermill object.'),
})

export const updateResponseOutput = z.strictObject({
  response: z.looseObject({}).describe('Raw Chattermill object.').optional(),
  raw: z.unknown().describe('Raw Chattermill response payload.').optional(),
})

export const deleteResponseInput = z.strictObject({
  project: z.string().min(1).describe('Chattermill project key or identifier used in the API path.'),
  responseId: z.string().min(1).describe('Chattermill resource identifier used in the API path.'),
})

export const deleteResponseOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the deletion request was sent.').optional(),
  responseId: z.string().min(1).describe('Chattermill resource identifier used in the API path.').optional(),
  raw: z.unknown().describe('Raw Chattermill response payload.').optional(),
})

export const searchResponsesInput = z.looseObject({
  project: z.string().min(1).describe('Chattermill project key or identifier used in the API path.').optional(),
  page: z.int().min(1).describe('Page number to request from Chattermill.').optional(),
  perPage: z.int().min(1).describe('Maximum number of records to return per page.').optional(),
}).describe('Search criteria accepted by Chattermill.')

export const searchResponsesOutput = z.strictObject({
  responses: z.array(z.looseObject({}).describe('Raw Chattermill object.')).describe('Chattermill responses returned by the API.').optional(),
  raw: z.unknown().describe('Raw Chattermill response payload.').optional(),
})

export const listDataSourcesInput = z.strictObject({
  project: z.string().min(1).describe('Chattermill project key or identifier used in the API path.'),
}).describe('Input identifying a Chattermill project.')

export const listDataSourcesOutput = z.strictObject({
  dataSources: z.array(z.looseObject({}).describe('Raw Chattermill object.')).describe('Chattermill dataSources returned by the API.').optional(),
  raw: z.unknown().describe('Raw Chattermill response payload.').optional(),
})

export const getDataSourceInput = z.strictObject({
  project: z.string().min(1).describe('Chattermill project key or identifier used in the API path.'),
  id: z.string().min(1).describe('Chattermill resource identifier used in the API path.'),
}).describe('Input identifying a Chattermill project resource.')

export const getDataSourceOutput = z.strictObject({
  dataSource: z.looseObject({}).describe('Raw Chattermill object.').optional(),
  raw: z.unknown().describe('Raw Chattermill response payload.').optional(),
})

export const listDataTypesInput = z.strictObject({
  project: z.string().min(1).describe('Chattermill project key or identifier used in the API path.'),
}).describe('Input identifying a Chattermill project.')

export const listDataTypesOutput = z.strictObject({
  dataTypes: z.array(z.looseObject({}).describe('Raw Chattermill object.')).describe('Chattermill dataTypes returned by the API.').optional(),
  raw: z.unknown().describe('Raw Chattermill response payload.').optional(),
})

export const getDataTypeInput = z.strictObject({
  project: z.string().min(1).describe('Chattermill project key or identifier used in the API path.'),
  id: z.string().min(1).describe('Chattermill resource identifier used in the API path.'),
}).describe('Input identifying a Chattermill project resource.')

export const getDataTypeOutput = z.strictObject({
  dataType: z.looseObject({}).describe('Raw Chattermill object.').optional(),
  raw: z.unknown().describe('Raw Chattermill response payload.').optional(),
})

export const listCustomSegmentsInput = z.strictObject({
  project: z.string().min(1).describe('Chattermill project key or identifier used in the API path.'),
}).describe('Input identifying a Chattermill project.')

export const listCustomSegmentsOutput = z.strictObject({
  customSegments: z.array(z.looseObject({}).describe('Raw Chattermill object.')).describe('Chattermill customSegments returned by the API.').optional(),
  raw: z.unknown().describe('Raw Chattermill response payload.').optional(),
})

export const getMetricInput = z.looseObject({
  project: z.string().min(1).describe('Chattermill project key or identifier used in the API path.').optional(),
  type: z.string().min(1).describe('Chattermill resource identifier used in the API path.').optional(),
}).describe('Input for reading a metric.')

export const getMetricOutput = z.strictObject({
  metric: z.unknown().describe('Raw Chattermill response payload.').optional(),
  raw: z.unknown().describe('Raw Chattermill response payload.').optional(),
})

export const listThemesInput = z.strictObject({
  project: z.string().min(1).describe('Chattermill project key or identifier used in the API path.'),
}).describe('Input identifying a Chattermill project.')

export const listThemesOutput = z.strictObject({
  themes: z.array(z.looseObject({}).describe('Raw Chattermill object.')).describe('Chattermill themes returned by the API.').optional(),
  raw: z.unknown().describe('Raw Chattermill response payload.').optional(),
})

export const getThemeInput = z.strictObject({
  project: z.string().min(1).describe('Chattermill project key or identifier used in the API path.'),
  id: z.string().min(1).describe('Chattermill resource identifier used in the API path.'),
}).describe('Input identifying a Chattermill project resource.')

export const getThemeOutput = z.strictObject({
  theme: z.looseObject({}).describe('Raw Chattermill object.').optional(),
  raw: z.unknown().describe('Raw Chattermill response payload.').optional(),
})

export const listCategoriesInput = z.strictObject({
  project: z.string().min(1).describe('Chattermill project key or identifier used in the API path.'),
}).describe('Input identifying a Chattermill project.')

export const listCategoriesOutput = z.strictObject({
  categories: z.array(z.looseObject({}).describe('Raw Chattermill object.')).describe('Chattermill categories returned by the API.').optional(),
  raw: z.unknown().describe('Raw Chattermill response payload.').optional(),
})

export const getCategoryInput = z.strictObject({
  project: z.string().min(1).describe('Chattermill project key or identifier used in the API path.'),
  id: z.string().min(1).describe('Chattermill resource identifier used in the API path.'),
}).describe('Input identifying a Chattermill project resource.')

export const getCategoryOutput = z.strictObject({
  category: z.looseObject({}).describe('Raw Chattermill object.').optional(),
  raw: z.unknown().describe('Raw Chattermill response payload.').optional(),
})

export const listAttributesInput = z.strictObject({
  project: z.string().min(1).describe('Chattermill project key or identifier used in the API path.'),
}).describe('Input identifying a Chattermill project.')

export const listAttributesOutput = z.strictObject({
  attributes: z.array(z.looseObject({}).describe('Raw Chattermill object.')).describe('Chattermill attributes returned by the API.').optional(),
  raw: z.unknown().describe('Raw Chattermill response payload.').optional(),
})

export const getAttributeInput = z.strictObject({
  project: z.string().min(1).describe('Chattermill project key or identifier used in the API path.'),
  id: z.string().min(1).describe('Chattermill resource identifier used in the API path.'),
}).describe('Input identifying a Chattermill project resource.')

export const getAttributeOutput = z.strictObject({
  attribute: z.looseObject({}).describe('Raw Chattermill object.').optional(),
  raw: z.unknown().describe('Raw Chattermill response payload.').optional(),
})

export const listTagsInput = z.strictObject({
  project: z.string().min(1).describe('Chattermill project key or identifier used in the API path.'),
}).describe('Input identifying a Chattermill project.')

export const listTagsOutput = z.strictObject({
  tags: z.array(z.looseObject({}).describe('Raw Chattermill object.')).describe('Chattermill tags returned by the API.').optional(),
  raw: z.unknown().describe('Raw Chattermill response payload.').optional(),
})

export const getTagInput = z.strictObject({
  project: z.string().min(1).describe('Chattermill project key or identifier used in the API path.'),
  id: z.string().min(1).describe('Chattermill resource identifier used in the API path.'),
}).describe('Input identifying a Chattermill project resource.')

export const getTagOutput = z.strictObject({
  tag: z.looseObject({}).describe('Raw Chattermill object.').optional(),
  raw: z.unknown().describe('Raw Chattermill response payload.').optional(),
})

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const chattermillActions = {
  list_projects: {
    description: 'List Chattermill projects accessible to the API key.',
    effect: 'read',
    inputSchema: listProjectsInput,
    outputSchema: z.toJSONSchema(listProjectsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_project: {
    description: 'Get a Chattermill project by project ID.',
    effect: 'read',
    inputSchema: getProjectInput,
    outputSchema: z.toJSONSchema(getProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_responses: {
    description: 'List responses for a Chattermill project with optional filters.',
    effect: 'read',
    inputSchema: listResponsesInput,
    outputSchema: z.toJSONSchema(listResponsesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_response: {
    description: 'Get a single Chattermill response by ID.',
    effect: 'read',
    inputSchema: getResponseInput,
    outputSchema: z.toJSONSchema(getResponseOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_response: {
    description: 'Create a response in a Chattermill project.',
    effect: 'write',
    inputSchema: createResponseInput,
    outputSchema: z.toJSONSchema(createResponseOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_response: {
    description: 'Update user metadata, segments, or other response fields in Chattermill.',
    effect: 'write',
    inputSchema: updateResponseInput,
    outputSchema: z.toJSONSchema(updateResponseOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_response: {
    description: 'Permanently delete a Chattermill response by ID.',
    effect: 'destructive',
    inputSchema: deleteResponseInput,
    outputSchema: z.toJSONSchema(deleteResponseOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_responses: {
    description: 'Search for Chattermill responses by response ID, user metadata, or custom criteria.',
    effect: 'read',
    inputSchema: searchResponsesInput,
    outputSchema: z.toJSONSchema(searchResponsesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_data_sources: {
    description: 'List data sources for a Chattermill project.',
    effect: 'read',
    inputSchema: listDataSourcesInput,
    outputSchema: z.toJSONSchema(listDataSourcesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_data_source: {
    description: 'Get a Chattermill data source by ID.',
    effect: 'read',
    inputSchema: getDataSourceInput,
    outputSchema: z.toJSONSchema(getDataSourceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_data_types: {
    description: 'List data types for a Chattermill project.',
    effect: 'read',
    inputSchema: listDataTypesInput,
    outputSchema: z.toJSONSchema(listDataTypesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_data_type: {
    description: 'Get a Chattermill data type by ID.',
    effect: 'read',
    inputSchema: getDataTypeInput,
    outputSchema: z.toJSONSchema(getDataTypeOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_custom_segments: {
    description: 'List custom segments for a Chattermill project.',
    effect: 'read',
    inputSchema: listCustomSegmentsInput,
    outputSchema: z.toJSONSchema(listCustomSegmentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_metric: {
    description: 'Get a Chattermill metric value for a project.',
    effect: 'read',
    inputSchema: getMetricInput,
    outputSchema: z.toJSONSchema(getMetricOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_themes: {
    description: 'List themes for a Chattermill project.',
    effect: 'read',
    inputSchema: listThemesInput,
    outputSchema: z.toJSONSchema(listThemesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_theme: {
    description: 'Get a Chattermill theme by ID.',
    effect: 'read',
    inputSchema: getThemeInput,
    outputSchema: z.toJSONSchema(getThemeOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_categories: {
    description: 'List categories for a Chattermill project.',
    effect: 'read',
    inputSchema: listCategoriesInput,
    outputSchema: z.toJSONSchema(listCategoriesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_category: {
    description: 'Get a Chattermill category by ID.',
    effect: 'read',
    inputSchema: getCategoryInput,
    outputSchema: z.toJSONSchema(getCategoryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_attributes: {
    description: 'List attributes for a Chattermill project.',
    effect: 'read',
    inputSchema: listAttributesInput,
    outputSchema: z.toJSONSchema(listAttributesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_attribute: {
    description: 'Get a Chattermill attribute by ID.',
    effect: 'read',
    inputSchema: getAttributeInput,
    outputSchema: z.toJSONSchema(getAttributeOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_tags: {
    description: 'List tags for a Chattermill project.',
    effect: 'read',
    inputSchema: listTagsInput,
    outputSchema: z.toJSONSchema(listTagsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_tag: {
    description: 'Get a Chattermill tag by ID.',
    effect: 'read',
    inputSchema: getTagInput,
    outputSchema: z.toJSONSchema(getTagOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
