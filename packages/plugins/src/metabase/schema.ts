/**
 * Metabase 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getCurrentUserInput = z.strictObject({}).describe('No input parameters are required.')

export const getCurrentUserOutput = z.strictObject({
  user: z.looseObject({}).describe('A Metabase entity object.').optional(),
  raw: z.looseObject({}).describe('The raw Metabase API response object.').optional(),
}).describe('Output payload for the current Metabase user.')

export const listDatabasesInput = z.strictObject({
  include: z.enum(['tables', 'schemas']).describe('Related database data to include.').optional(),
  includeAnalytics: z.boolean().describe('Whether to include analytics database metadata.').optional(),
  saved: z.boolean().describe('Whether to return saved query databases.').optional(),
  includeEditableDataModel: z.boolean().describe('Whether to include editable data model metadata.').optional(),
  excludeUneditableDetails: z.boolean().describe('Whether to exclude details the API key cannot edit.').optional(),
  includeOnlyUploadable: z.boolean().describe('Whether to return only uploadable databases.').optional(),
  routerDatabaseId: z.int().min(1).describe('Router database ID to filter by.').optional(),
  canQuery: z.boolean().describe('Whether to return databases the API key can query.').optional(),
  canWriteMetadata: z.boolean().describe('Whether to return databases the API key can edit metadata for.').optional(),
}).describe('Query parameters for listing Metabase databases.')

export const listDatabasesOutput = z.strictObject({
  databases: z.array(z.looseObject({}).describe('A Metabase entity object.')).describe('Metabase databases returned by the API.').optional(),
  raw: z.looseObject({}).describe('The raw Metabase API response object.').optional(),
}).describe('Output payload for Metabase databases.')

export const getDatabaseInput = z.strictObject({
  id: z.union([z.int().min(1).describe('A positive numeric Metabase ID.'), z.string().min(1).describe('A Metabase entity ID string.')]).describe('A Metabase numeric ID or entity ID string.'),
  include: z.enum(['tables', 'tables.fields']).describe('Related database data to include.').optional(),
  includeEditableDataModel: z.boolean().describe('Whether to include editable data model metadata.').optional(),
  excludeUneditableDetails: z.boolean().describe('Whether to exclude details the API key cannot edit.').optional(),
}).describe('Input parameters for retrieving one Metabase database.')

export const getDatabaseOutput = z.strictObject({
  database: z.looseObject({}).describe('A Metabase entity object.').optional(),
  raw: z.looseObject({}).describe('The raw Metabase API response object.').optional(),
}).describe('Output payload for one Metabase database.')

export const listCollectionsInput = z.strictObject({
  archived: z.boolean().describe('Whether to include archived collections.').optional(),
  excludeOtherUserCollections: z.boolean().describe('Whether to exclude other users\' personal collections.').optional(),
  namespace: z.string().min(1).describe('Collection namespace to filter by.').optional(),
  personalOnly: z.boolean().describe('Whether to return only personal collections.').optional(),
}).describe('Query parameters for listing Metabase collections.')

export const listCollectionsOutput = z.strictObject({
  collections: z.array(z.looseObject({}).describe('A Metabase entity object.')).describe('Metabase collections returned by the API.').optional(),
  raw: z.looseObject({}).describe('The raw Metabase API response object.').optional(),
}).describe('Output payload for Metabase collections.')

export const getCollectionInput = z.strictObject({
  id: z.union([z.int().min(1).describe('A positive numeric Metabase ID.'), z.string().min(1).describe('A Metabase entity ID string.')]).describe('A Metabase numeric ID or entity ID string.').optional(),
}).describe('Input parameters for retrieving one Metabase collection.')

export const getCollectionOutput = z.strictObject({
  collection: z.looseObject({}).describe('A Metabase entity object.').optional(),
  raw: z.looseObject({}).describe('The raw Metabase API response object.').optional(),
}).describe('Output payload for one Metabase collection.')

export const listCardsInput = z.strictObject({
  filter: z.enum(['archived', 'table', 'using_model', 'bookmarked', 'using_segment', 'all', 'mine', 'database']).describe('Card list filter.').optional(),
  modelId: z.int().min(1).describe('Model ID to filter cards by.').optional(),
}).describe('Query parameters for listing Metabase cards.')

export const listCardsOutput = z.strictObject({
  cards: z.array(z.looseObject({}).describe('A Metabase entity object.')).describe('Metabase cards returned by the API.').optional(),
  raw: z.looseObject({}).describe('The raw Metabase API response object.').optional(),
}).describe('Output payload for Metabase cards.')

export const getCardInput = z.strictObject({
  id: z.union([z.int().min(1).describe('A positive numeric Metabase ID.'), z.string().min(1).describe('A Metabase entity ID string.')]).describe('A Metabase numeric ID or entity ID string.'),
  legacyMbql: z.boolean().describe('Whether to request the legacy MBQL response shape.').optional(),
}).describe('Input parameters for retrieving one Metabase card.')

export const getCardOutput = z.strictObject({
  card: z.looseObject({}).describe('A Metabase entity object.').optional(),
  raw: z.looseObject({}).describe('The raw Metabase API response object.').optional(),
}).describe('Output payload for one Metabase card.')

export const listDashboardsInput = z.strictObject({
  filter: z.enum(['all', 'mine', 'archived']).describe('Dashboard list filter.').optional(),
}).describe('Query parameters for listing Metabase dashboards.')

export const listDashboardsOutput = z.strictObject({
  dashboards: z.array(z.looseObject({}).describe('A Metabase entity object.')).describe('Metabase dashboards returned by the API.').optional(),
  raw: z.looseObject({}).describe('The raw Metabase API response object.').optional(),
}).describe('Output payload for Metabase dashboards.')

export const getDashboardInput = z.strictObject({
  id: z.union([z.int().min(1).describe('A positive numeric Metabase ID.'), z.string().min(1).describe('A Metabase entity ID string.')]).describe('A Metabase numeric ID or entity ID string.').optional(),
}).describe('Input parameters for retrieving one Metabase dashboard.')

export const getDashboardOutput = z.strictObject({
  dashboard: z.looseObject({}).describe('A Metabase entity object.').optional(),
  raw: z.looseObject({}).describe('The raw Metabase API response object.').optional(),
}).describe('Output payload for one Metabase dashboard.')

export const searchInput = z.strictObject({
  query: z.string().min(1).describe('Search text.').optional(),
  context: z.enum(['search-bar', 'search-app', 'command-palette', 'entity-picker', 'data-picker', 'type-filter', 'basic-actions', 'browse', 'embedding-setup', 'document', 'library', 'dependencies', 'model-migration', 'api', 'metabot']).describe('Metabase search context.').optional(),
  archived: z.boolean().describe('Whether to search archived content.').optional(),
  collectionId: z.int().min(1).describe('Collection ID to search within.').optional(),
  tableDatabaseId: z.int().min(1).describe('Database ID to filter table search results by.').optional(),
  models: z.array(z.enum(['dashboard', 'table', 'dataset', 'segment', 'collection', 'measure', 'transform', 'document', 'database', 'action', 'indexed-entity', 'metric', 'card']).describe('Metabase model type to include in search results.')).describe('Metabase model types to include.').optional(),
  includeDashboardQuestions: z.boolean().describe('Whether to include dashboard questions.').optional(),
  includeMetadata: z.boolean().describe('Whether to include result metadata.').optional(),
}).describe('Query parameters for searching Metabase content.')

export const searchOutput = z.strictObject({
  results: z.array(z.looseObject({}).describe('A Metabase entity object.')).describe('Metabase search results returned by the API.').optional(),
  raw: z.looseObject({}).describe('The raw Metabase API response object.').optional(),
}).describe('Output payload for Metabase search results.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const metabaseActions = {
  get_current_user: {
    description: 'Get the Metabase user associated with the API key.',
    effect: 'read',
    inputSchema: getCurrentUserInput,
    outputSchema: z.toJSONSchema(getCurrentUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_databases: {
    description: 'List Metabase databases visible to the API key.',
    effect: 'read',
    inputSchema: listDatabasesInput,
    outputSchema: z.toJSONSchema(listDatabasesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_database: {
    description: 'Retrieve one Metabase database by ID.',
    effect: 'read',
    inputSchema: getDatabaseInput,
    outputSchema: z.toJSONSchema(getDatabaseOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_collections: {
    description: 'List Metabase collections visible to the API key.',
    effect: 'read',
    inputSchema: listCollectionsInput,
    outputSchema: z.toJSONSchema(listCollectionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_collection: {
    description: 'Retrieve one Metabase collection by ID.',
    effect: 'read',
    inputSchema: getCollectionInput,
    outputSchema: z.toJSONSchema(getCollectionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_cards: {
    description: 'List Metabase cards, also known as questions.',
    effect: 'read',
    inputSchema: listCardsInput,
    outputSchema: z.toJSONSchema(listCardsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_card: {
    description: 'Retrieve one Metabase card by ID.',
    effect: 'read',
    inputSchema: getCardInput,
    outputSchema: z.toJSONSchema(getCardOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_dashboards: {
    description: 'List Metabase dashboards visible to the API key.',
    effect: 'read',
    inputSchema: listDashboardsInput,
    outputSchema: z.toJSONSchema(listDashboardsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_dashboard: {
    description: 'Retrieve one Metabase dashboard by ID.',
    effect: 'read',
    inputSchema: getDashboardInput,
    outputSchema: z.toJSONSchema(getDashboardOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search: {
    description: 'Search Metabase content visible to the API key.',
    effect: 'write',
    inputSchema: searchInput,
    outputSchema: z.toJSONSchema(searchOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
