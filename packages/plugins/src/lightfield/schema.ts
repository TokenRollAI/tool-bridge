/**
 * Lightfield 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getApiKeyMetadataInput = z.strictObject({}).describe('Input parameters for validating the current API key.')

export const getApiKeyMetadataOutput = z.strictObject({
  active: z.boolean().describe('Whether Lightfield reported the API key as active.'),
  scopes: z.array(z.string().describe('A granted scope.')).describe('Granted public scopes for the API key.'),
  subjectType: z.enum(['user', 'workspace']).describe('Whether the API key belongs to a user or workspace.'),
  tokenType: z.enum(['api_key']).describe('Credential family reported by Lightfield.'),
}).describe('Metadata for the current Lightfield API key.')

export const listObjectDefinitionsInput = z.strictObject({}).describe('Input parameters for listing Lightfield custom object types.')

export const listObjectDefinitionsOutput = z.strictObject({
  definitions: z.array(z.strictObject({
    label: z.string().describe('Human-readable custom object label.'),
    objectType: z.string().describe('Slug used to reference the custom object type in the API.'),
  }).describe('A Lightfield custom object definition.')).describe('Custom object definitions returned by Lightfield.'),
}).describe('Lightfield custom object definitions response.')

export const listCustomObjectRecordsInput = z.strictObject({
  entitySlug: z.string().min(1).describe('The custom object type slug.'),
  limit: z.int().min(1).max(25).describe('Maximum number of records to return. Lightfield allows 1 to 25.').optional(),
  offset: z.int().min(0).describe('Number of records to skip for offset pagination.').optional(),
  filters: z.record(z.string(), z.union([z.string().describe('A string filter value.'), z.number().describe('A numeric filter value.'), z.boolean().describe('A boolean filter value.')]).describe('A Lightfield list filter value.')).describe('Lightfield filter query parameters keyed by raw field expression, such as $email[contains].').optional(),
}).describe('Pagination and filtering parameters for listing a custom object type.')

export const listCustomObjectRecordsOutput = z.strictObject({
  records: z.array(z.looseObject({
    id: z.string().describe('Unique Lightfield record ID.').optional(),
    createdAt: z.string().describe('ISO 8601 timestamp when the record was created.').optional(),
    updatedAt: z.string().describe('ISO 8601 timestamp when the record was last updated.').nullable().optional(),
    externalId: z.string().describe('External identifier for the record.').nullable().optional(),
    httpLink: z.string().describe('URL for viewing the record in the Lightfield web app.').nullable().optional(),
    fields: z.record(z.string(), z.looseObject({
      value: z.unknown().describe('The field value returned by Lightfield.').optional(),
      valueType: z.string().describe('The Lightfield field value type.').optional(),
    }).describe('A typed Lightfield field value.')).describe('Dynamic Lightfield fields keyed by field slug.').optional(),
    relationships: z.record(z.string(), z.looseObject({
      cardinality: z.string().describe('Whether the relationship is has_one or has_many.').optional(),
      objectType: z.string().describe('The related object type.').optional(),
      values: z.array(z.string().describe('A related record ID.')).describe('Related record IDs.').optional(),
    }).describe('A Lightfield relationship value.')).describe('Dynamic Lightfield relationships keyed by relationship slug.').optional(),
  }).describe('A Lightfield CRM record with dynamic fields and relationships.')).describe('Records returned by Lightfield.'),
  object: z.string().describe('The upstream response object type.'),
  totalCount: z.number().describe('Total number of records matching the query.'),
}).describe('A normalized Lightfield list response.')

export const getCustomObjectRecordInput = z.strictObject({
  entitySlug: z.string().min(1).describe('The custom object type slug.'),
  id: z.string().min(1).describe('The Lightfield record ID to retrieve.'),
}).describe('Identifier for retrieving a custom object record.')

export const getCustomObjectRecordOutput = z.strictObject({
  record: z.looseObject({
    id: z.string().describe('Unique Lightfield record ID.').optional(),
    createdAt: z.string().describe('ISO 8601 timestamp when the record was created.').optional(),
    updatedAt: z.string().describe('ISO 8601 timestamp when the record was last updated.').nullable().optional(),
    externalId: z.string().describe('External identifier for the record.').nullable().optional(),
    httpLink: z.string().describe('URL for viewing the record in the Lightfield web app.').nullable().optional(),
    fields: z.record(z.string(), z.looseObject({
      value: z.unknown().describe('The field value returned by Lightfield.').optional(),
      valueType: z.string().describe('The Lightfield field value type.').optional(),
    }).describe('A typed Lightfield field value.')).describe('Dynamic Lightfield fields keyed by field slug.').optional(),
    relationships: z.record(z.string(), z.looseObject({
      cardinality: z.string().describe('Whether the relationship is has_one or has_many.').optional(),
      objectType: z.string().describe('The related object type.').optional(),
      values: z.array(z.string().describe('A related record ID.')).describe('Related record IDs.').optional(),
    }).describe('A Lightfield relationship value.')).describe('Dynamic Lightfield relationships keyed by relationship slug.').optional(),
  }).describe('A Lightfield CRM record with dynamic fields and relationships.'),
}).describe('A normalized Lightfield retrieve response.')

export const listAccountsInput = z.strictObject({
  limit: z.int().min(1).max(25).describe('Maximum number of records to return. Lightfield allows 1 to 25.').optional(),
  offset: z.int().min(0).describe('Number of records to skip for offset pagination.').optional(),
  filters: z.record(z.string(), z.union([z.string().describe('A string filter value.'), z.number().describe('A numeric filter value.'), z.boolean().describe('A boolean filter value.')]).describe('A Lightfield list filter value.')).describe('Lightfield filter query parameters keyed by raw field expression, such as $email[contains].').optional(),
}).describe('Pagination and filtering parameters for a Lightfield list endpoint.')

export const listAccountsOutput = z.strictObject({
  records: z.array(z.looseObject({
    id: z.string().describe('Unique Lightfield record ID.').optional(),
    createdAt: z.string().describe('ISO 8601 timestamp when the record was created.').optional(),
    updatedAt: z.string().describe('ISO 8601 timestamp when the record was last updated.').nullable().optional(),
    externalId: z.string().describe('External identifier for the record.').nullable().optional(),
    httpLink: z.string().describe('URL for viewing the record in the Lightfield web app.').nullable().optional(),
    fields: z.record(z.string(), z.looseObject({
      value: z.unknown().describe('The field value returned by Lightfield.').optional(),
      valueType: z.string().describe('The Lightfield field value type.').optional(),
    }).describe('A typed Lightfield field value.')).describe('Dynamic Lightfield fields keyed by field slug.').optional(),
    relationships: z.record(z.string(), z.looseObject({
      cardinality: z.string().describe('Whether the relationship is has_one or has_many.').optional(),
      objectType: z.string().describe('The related object type.').optional(),
      values: z.array(z.string().describe('A related record ID.')).describe('Related record IDs.').optional(),
    }).describe('A Lightfield relationship value.')).describe('Dynamic Lightfield relationships keyed by relationship slug.').optional(),
  }).describe('A Lightfield CRM record with dynamic fields and relationships.')).describe('Records returned by Lightfield.'),
  object: z.string().describe('The upstream response object type.'),
  totalCount: z.number().describe('Total number of records matching the query.'),
}).describe('A normalized Lightfield list response.')

export const getAccountInput = z.strictObject({
  id: z.string().min(1).describe('The Lightfield record ID to retrieve.'),
}).describe('Identifier for retrieving a Lightfield record.')

export const getAccountOutput = z.strictObject({
  record: z.looseObject({
    id: z.string().describe('Unique Lightfield record ID.').optional(),
    createdAt: z.string().describe('ISO 8601 timestamp when the record was created.').optional(),
    updatedAt: z.string().describe('ISO 8601 timestamp when the record was last updated.').nullable().optional(),
    externalId: z.string().describe('External identifier for the record.').nullable().optional(),
    httpLink: z.string().describe('URL for viewing the record in the Lightfield web app.').nullable().optional(),
    fields: z.record(z.string(), z.looseObject({
      value: z.unknown().describe('The field value returned by Lightfield.').optional(),
      valueType: z.string().describe('The Lightfield field value type.').optional(),
    }).describe('A typed Lightfield field value.')).describe('Dynamic Lightfield fields keyed by field slug.').optional(),
    relationships: z.record(z.string(), z.looseObject({
      cardinality: z.string().describe('Whether the relationship is has_one or has_many.').optional(),
      objectType: z.string().describe('The related object type.').optional(),
      values: z.array(z.string().describe('A related record ID.')).describe('Related record IDs.').optional(),
    }).describe('A Lightfield relationship value.')).describe('Dynamic Lightfield relationships keyed by relationship slug.').optional(),
  }).describe('A Lightfield CRM record with dynamic fields and relationships.'),
}).describe('A normalized Lightfield retrieve response.')

export const listContactsInput = z.strictObject({
  limit: z.int().min(1).max(25).describe('Maximum number of records to return. Lightfield allows 1 to 25.').optional(),
  offset: z.int().min(0).describe('Number of records to skip for offset pagination.').optional(),
  filters: z.record(z.string(), z.union([z.string().describe('A string filter value.'), z.number().describe('A numeric filter value.'), z.boolean().describe('A boolean filter value.')]).describe('A Lightfield list filter value.')).describe('Lightfield filter query parameters keyed by raw field expression, such as $email[contains].').optional(),
}).describe('Pagination and filtering parameters for a Lightfield list endpoint.')

export const listContactsOutput = z.strictObject({
  records: z.array(z.looseObject({
    id: z.string().describe('Unique Lightfield record ID.').optional(),
    createdAt: z.string().describe('ISO 8601 timestamp when the record was created.').optional(),
    updatedAt: z.string().describe('ISO 8601 timestamp when the record was last updated.').nullable().optional(),
    externalId: z.string().describe('External identifier for the record.').nullable().optional(),
    httpLink: z.string().describe('URL for viewing the record in the Lightfield web app.').nullable().optional(),
    fields: z.record(z.string(), z.looseObject({
      value: z.unknown().describe('The field value returned by Lightfield.').optional(),
      valueType: z.string().describe('The Lightfield field value type.').optional(),
    }).describe('A typed Lightfield field value.')).describe('Dynamic Lightfield fields keyed by field slug.').optional(),
    relationships: z.record(z.string(), z.looseObject({
      cardinality: z.string().describe('Whether the relationship is has_one or has_many.').optional(),
      objectType: z.string().describe('The related object type.').optional(),
      values: z.array(z.string().describe('A related record ID.')).describe('Related record IDs.').optional(),
    }).describe('A Lightfield relationship value.')).describe('Dynamic Lightfield relationships keyed by relationship slug.').optional(),
  }).describe('A Lightfield CRM record with dynamic fields and relationships.')).describe('Records returned by Lightfield.'),
  object: z.string().describe('The upstream response object type.'),
  totalCount: z.number().describe('Total number of records matching the query.'),
}).describe('A normalized Lightfield list response.')

export const getContactInput = z.strictObject({
  id: z.string().min(1).describe('The Lightfield record ID to retrieve.'),
}).describe('Identifier for retrieving a Lightfield record.')

export const getContactOutput = z.strictObject({
  record: z.looseObject({
    id: z.string().describe('Unique Lightfield record ID.').optional(),
    createdAt: z.string().describe('ISO 8601 timestamp when the record was created.').optional(),
    updatedAt: z.string().describe('ISO 8601 timestamp when the record was last updated.').nullable().optional(),
    externalId: z.string().describe('External identifier for the record.').nullable().optional(),
    httpLink: z.string().describe('URL for viewing the record in the Lightfield web app.').nullable().optional(),
    fields: z.record(z.string(), z.looseObject({
      value: z.unknown().describe('The field value returned by Lightfield.').optional(),
      valueType: z.string().describe('The Lightfield field value type.').optional(),
    }).describe('A typed Lightfield field value.')).describe('Dynamic Lightfield fields keyed by field slug.').optional(),
    relationships: z.record(z.string(), z.looseObject({
      cardinality: z.string().describe('Whether the relationship is has_one or has_many.').optional(),
      objectType: z.string().describe('The related object type.').optional(),
      values: z.array(z.string().describe('A related record ID.')).describe('Related record IDs.').optional(),
    }).describe('A Lightfield relationship value.')).describe('Dynamic Lightfield relationships keyed by relationship slug.').optional(),
  }).describe('A Lightfield CRM record with dynamic fields and relationships.'),
}).describe('A normalized Lightfield retrieve response.')

export const listOpportunitiesInput = z.strictObject({
  limit: z.int().min(1).max(25).describe('Maximum number of records to return. Lightfield allows 1 to 25.').optional(),
  offset: z.int().min(0).describe('Number of records to skip for offset pagination.').optional(),
  filters: z.record(z.string(), z.union([z.string().describe('A string filter value.'), z.number().describe('A numeric filter value.'), z.boolean().describe('A boolean filter value.')]).describe('A Lightfield list filter value.')).describe('Lightfield filter query parameters keyed by raw field expression, such as $email[contains].').optional(),
}).describe('Pagination and filtering parameters for a Lightfield list endpoint.')

export const listOpportunitiesOutput = z.strictObject({
  records: z.array(z.looseObject({
    id: z.string().describe('Unique Lightfield record ID.').optional(),
    createdAt: z.string().describe('ISO 8601 timestamp when the record was created.').optional(),
    updatedAt: z.string().describe('ISO 8601 timestamp when the record was last updated.').nullable().optional(),
    externalId: z.string().describe('External identifier for the record.').nullable().optional(),
    httpLink: z.string().describe('URL for viewing the record in the Lightfield web app.').nullable().optional(),
    fields: z.record(z.string(), z.looseObject({
      value: z.unknown().describe('The field value returned by Lightfield.').optional(),
      valueType: z.string().describe('The Lightfield field value type.').optional(),
    }).describe('A typed Lightfield field value.')).describe('Dynamic Lightfield fields keyed by field slug.').optional(),
    relationships: z.record(z.string(), z.looseObject({
      cardinality: z.string().describe('Whether the relationship is has_one or has_many.').optional(),
      objectType: z.string().describe('The related object type.').optional(),
      values: z.array(z.string().describe('A related record ID.')).describe('Related record IDs.').optional(),
    }).describe('A Lightfield relationship value.')).describe('Dynamic Lightfield relationships keyed by relationship slug.').optional(),
  }).describe('A Lightfield CRM record with dynamic fields and relationships.')).describe('Records returned by Lightfield.'),
  object: z.string().describe('The upstream response object type.'),
  totalCount: z.number().describe('Total number of records matching the query.'),
}).describe('A normalized Lightfield list response.')

export const getOpportunityInput = z.strictObject({
  id: z.string().min(1).describe('The Lightfield record ID to retrieve.'),
}).describe('Identifier for retrieving a Lightfield record.')

export const getOpportunityOutput = z.strictObject({
  record: z.looseObject({
    id: z.string().describe('Unique Lightfield record ID.').optional(),
    createdAt: z.string().describe('ISO 8601 timestamp when the record was created.').optional(),
    updatedAt: z.string().describe('ISO 8601 timestamp when the record was last updated.').nullable().optional(),
    externalId: z.string().describe('External identifier for the record.').nullable().optional(),
    httpLink: z.string().describe('URL for viewing the record in the Lightfield web app.').nullable().optional(),
    fields: z.record(z.string(), z.looseObject({
      value: z.unknown().describe('The field value returned by Lightfield.').optional(),
      valueType: z.string().describe('The Lightfield field value type.').optional(),
    }).describe('A typed Lightfield field value.')).describe('Dynamic Lightfield fields keyed by field slug.').optional(),
    relationships: z.record(z.string(), z.looseObject({
      cardinality: z.string().describe('Whether the relationship is has_one or has_many.').optional(),
      objectType: z.string().describe('The related object type.').optional(),
      values: z.array(z.string().describe('A related record ID.')).describe('Related record IDs.').optional(),
    }).describe('A Lightfield relationship value.')).describe('Dynamic Lightfield relationships keyed by relationship slug.').optional(),
  }).describe('A Lightfield CRM record with dynamic fields and relationships.'),
}).describe('A normalized Lightfield retrieve response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const lightfieldActions = {
  get_api_key_metadata: {
    description: 'Validate the current Lightfield API key and return its subject and scopes.',
    effect: 'read',
    inputSchema: getApiKeyMetadataInput,
    outputSchema: z.toJSONSchema(getApiKeyMetadataOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_object_definitions: {
    description: 'List custom object types available to the current Lightfield API key.',
    effect: 'read',
    inputSchema: listObjectDefinitionsInput,
    outputSchema: z.toJSONSchema(listObjectDefinitionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_custom_object_records: {
    description: 'List records for a Lightfield custom object type with optional filters.',
    effect: 'read',
    inputSchema: listCustomObjectRecordsInput,
    outputSchema: z.toJSONSchema(listCustomObjectRecordsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_custom_object_record: {
    description: 'Get one Lightfield custom object record by object type and record ID.',
    effect: 'read',
    inputSchema: getCustomObjectRecordInput,
    outputSchema: z.toJSONSchema(getCustomObjectRecordOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_accounts: {
    description: 'List Lightfield accounts with optional pagination and filters.',
    effect: 'read',
    inputSchema: listAccountsInput,
    outputSchema: z.toJSONSchema(listAccountsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_account: {
    description: 'Get one Lightfield account by ID.',
    effect: 'read',
    inputSchema: getAccountInput,
    outputSchema: z.toJSONSchema(getAccountOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_contacts: {
    description: 'List Lightfield contacts with optional pagination and filters.',
    effect: 'read',
    inputSchema: listContactsInput,
    outputSchema: z.toJSONSchema(listContactsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_contact: {
    description: 'Get one Lightfield contact by ID.',
    effect: 'read',
    inputSchema: getContactInput,
    outputSchema: z.toJSONSchema(getContactOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_opportunities: {
    description: 'List Lightfield opportunities with optional pagination and filters.',
    effect: 'read',
    inputSchema: listOpportunitiesInput,
    outputSchema: z.toJSONSchema(listOpportunitiesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_opportunity: {
    description: 'Get one Lightfield opportunity by ID.',
    effect: 'read',
    inputSchema: getOpportunityInput,
    outputSchema: z.toJSONSchema(getOpportunityOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
