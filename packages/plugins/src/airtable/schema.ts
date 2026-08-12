/**
 * Airtable 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listBasesInput = z.strictObject({
  offset: z.string().min(1).describe('Opaque pagination cursor returned by a previous Airtable response.').optional(),
}).describe('The input payload for this action.')

export const listBasesOutput = z.strictObject({
  bases: z.array(z.strictObject({
    id: z.string().describe('Base ID.'),
    name: z.string().describe('Base name.'),
    permissionLevel: z.string().describe('Permission level reported by Airtable for this base.'),
  }).describe('Airtable base summary.')).describe('Bases returned by Airtable.'),
  offset: z.string().describe('Pagination cursor for the next page of bases, or null when unavailable.').nullable(),
}).describe('Airtable action output.')

export const getBaseCollaboratorsInput = z.strictObject({
  baseId: z.string().min(1).describe('Base ID in the format appXXXXXXXXXXXXXX.'),
  include: z.array(z.enum(['collaborators', 'inviteLinks', 'interfaces', 'packages'])).min(1).describe('Optional Airtable base collaboration details to include.').optional(),
}).describe('The input payload for this action.')

export const getBaseCollaboratorsOutput = z.strictObject({
  base: z.looseObject({
    id: z.string().describe('Base ID.'),
    createdTime: z.string().describe('Base creation timestamp returned by Airtable.'),
    permissionLevel: z.string().describe('Permission level reported by Airtable for the authenticated user.'),
    workspaceId: z.string().min(1).describe('Workspace ID in the format wspXXXXXXXXXXXXXX.'),
    name: z.string().describe('Base name.'),
    interfaces: z.looseObject({}).describe('Interface metadata returned by Airtable.').optional(),
    collaborators: z.looseObject({}).describe('Deprecated collaborator metadata returned by Airtable.').optional(),
    groupCollaborators: z.looseObject({}).describe('Group collaborator metadata returned by Airtable.').optional(),
    individualCollaborators: z.looseObject({}).describe('Individual collaborator metadata returned by Airtable.').optional(),
    inviteLinks: z.looseObject({}).describe('Invite link metadata returned by Airtable.').optional(),
    packages: z.looseObject({}).describe('Package metadata returned by Airtable.').optional(),
  }).describe('Airtable base details response.'),
}).describe('Airtable action output.')

export const getBaseSchemaInput = z.strictObject({
  baseId: z.string().min(1).describe('Base ID in the format appXXXXXXXXXXXXXX.'),
  include: z.array(z.literal('visibleFieldIds')).min(1).max(1).describe('Optional Airtable schema details to include in table views.').optional(),
}).describe('The input payload for this action.')

export const getBaseSchemaOutput = z.strictObject({
  tables: z.array(z.looseObject({
    id: z.string().describe('Table ID.'),
    name: z.string().describe('Table name.'),
    description: z.string().describe('Table description when Airtable returns one.').optional(),
    primaryFieldId: z.string().describe('Primary field ID configured for the table.').optional(),
    dateDependencySettings: z.looseObject({}).describe('Date dependency settings returned by Airtable for the table.').optional(),
    fields: z.array(z.looseObject({
      id: z.string().describe('Field ID.'),
      name: z.string().describe('Field name.'),
      type: z.string().describe('Field type reported by Airtable.'),
      description: z.string().describe('Field description when Airtable returns one.').optional(),
      options: z.looseObject({}).describe('Field options reported by Airtable.').optional(),
    }).describe('Airtable field definition.')).describe('Fields defined on the Airtable table.'),
    views: z.array(z.looseObject({
      id: z.string().describe('View ID.'),
      name: z.string().describe('View name.'),
      type: z.string().describe('View type reported by Airtable.').optional(),
      visibleFieldIds: z.array(z.string()).describe('Field IDs visible in the Airtable view.').optional(),
    }).describe('Airtable view definition.')).describe('Views defined on the Airtable table.').optional(),
  }).describe('Airtable table definition.')).describe('Tables returned by Airtable for the base.'),
}).describe('Airtable action output.')

export const createBaseInput = z.strictObject({
  name: z.string().min(1).describe('Name for the Airtable base.'),
  workspaceId: z.string().min(1).describe('Workspace ID in the format wspXXXXXXXXXXXXXX.'),
  tables: z.array(z.looseObject({
    name: z.string().min(1).describe('Name for the Airtable table.'),
    description: z.string().max(20000).describe('Optional Airtable description, up to 20,000 characters.').optional(),
    fields: z.array(z.looseObject({
      name: z.string().min(1).describe('Name for the Airtable field.'),
      type: z.string().min(1).describe('Airtable field type, such as singleLineText.'),
      description: z.string().max(20000).describe('Optional Airtable description, up to 20,000 characters.').optional(),
      options: z.looseObject({}).describe('Type-specific Airtable field options.').optional(),
    }).describe('Airtable field configuration accepted by metadata write endpoints.')).min(1).describe('Field configurations to create in the Airtable table.'),
  }).describe('Airtable table configuration accepted when creating a base or table.')).min(1).describe('Tables to create along with the new Airtable base.'),
}).describe('The input payload for this action.')

export const createBaseOutput = z.strictObject({
  id: z.string().describe('Base ID.'),
  tables: z.array(z.looseObject({
    id: z.string().describe('Table ID.'),
    name: z.string().describe('Table name.'),
    description: z.string().describe('Table description when Airtable returns one.').optional(),
    primaryFieldId: z.string().describe('Primary field ID configured for the table.').optional(),
    dateDependencySettings: z.looseObject({}).describe('Date dependency settings returned by Airtable for the table.').optional(),
    fields: z.array(z.looseObject({
      id: z.string().describe('Field ID.'),
      name: z.string().describe('Field name.'),
      type: z.string().describe('Field type reported by Airtable.'),
      description: z.string().describe('Field description when Airtable returns one.').optional(),
      options: z.looseObject({}).describe('Field options reported by Airtable.').optional(),
    }).describe('Airtable field definition.')).describe('Fields defined on the Airtable table.'),
    views: z.array(z.looseObject({
      id: z.string().describe('View ID.'),
      name: z.string().describe('View name.'),
      type: z.string().describe('View type reported by Airtable.').optional(),
      visibleFieldIds: z.array(z.string()).describe('Field IDs visible in the Airtable view.').optional(),
    }).describe('Airtable view definition.')).describe('Views defined on the Airtable table.').optional(),
  }).describe('Airtable table definition.')).describe('Tables created with the Airtable base.'),
}).describe('Airtable create base response.')

export const deleteBaseInput = z.strictObject({
  baseId: z.string().min(1).describe('Base ID in the format appXXXXXXXXXXXXXX.'),
}).describe('The input payload for this action.')

export const deleteBaseOutput = z.strictObject({
  id: z.string().describe('Base ID.'),
  deleted: z.literal(true).describe('Whether Airtable reports the base as deleted.'),
}).describe('Airtable deleted-base acknowledgement.')

export const createTableInput = z.strictObject({
  baseId: z.string().min(1).describe('Base ID in the format appXXXXXXXXXXXXXX.'),
  name: z.string().min(1).describe('Name for the Airtable table.'),
  description: z.string().max(20000).describe('Optional Airtable description, up to 20,000 characters.').optional(),
  fields: z.array(z.looseObject({
    name: z.string().min(1).describe('Name for the Airtable field.'),
    type: z.string().min(1).describe('Airtable field type, such as singleLineText.'),
    description: z.string().max(20000).describe('Optional Airtable description, up to 20,000 characters.').optional(),
    options: z.looseObject({}).describe('Type-specific Airtable field options.').optional(),
  }).describe('Airtable field configuration accepted by metadata write endpoints.')).min(1).describe('Field configurations to create in the Airtable table.'),
}).describe('The input payload for this action.')

export const createTableOutput = z.looseObject({
  id: z.string().describe('Table ID.'),
  name: z.string().describe('Table name.'),
  description: z.string().describe('Table description when Airtable returns one.').optional(),
  primaryFieldId: z.string().describe('Primary field ID configured for the table.').optional(),
  dateDependencySettings: z.looseObject({}).describe('Date dependency settings returned by Airtable for the table.').optional(),
  fields: z.array(z.looseObject({
    id: z.string().describe('Field ID.'),
    name: z.string().describe('Field name.'),
    type: z.string().describe('Field type reported by Airtable.'),
    description: z.string().describe('Field description when Airtable returns one.').optional(),
    options: z.looseObject({}).describe('Field options reported by Airtable.').optional(),
  }).describe('Airtable field definition.')).describe('Fields defined on the Airtable table.'),
  views: z.array(z.looseObject({
    id: z.string().describe('View ID.'),
    name: z.string().describe('View name.'),
    type: z.string().describe('View type reported by Airtable.').optional(),
    visibleFieldIds: z.array(z.string()).describe('Field IDs visible in the Airtable view.').optional(),
  }).describe('Airtable view definition.')).describe('Views defined on the Airtable table.').optional(),
}).describe('Airtable table definition.')

export const updateTableInput = z.strictObject({
  baseId: z.string().min(1).describe('Base ID in the format appXXXXXXXXXXXXXX.'),
  tableIdOrName: z.string().min(1).describe('Table ID or table name accepted by the Airtable path parameter.'),
  name: z.string().min(1).describe('Name for the Airtable table.').optional(),
  description: z.string().max(20000).describe('Optional Airtable description, up to 20,000 characters.').optional(),
  dateDependencySettings: z.looseObject({}).describe('Airtable date dependency settings for a table.').optional(),
}).describe('The input payload for this action.')

export const updateTableOutput = z.looseObject({
  id: z.string().describe('Table ID.'),
  name: z.string().describe('Table name.'),
  description: z.string().describe('Table description when Airtable returns one.').optional(),
  primaryFieldId: z.string().describe('Primary field ID configured for the table.').optional(),
  dateDependencySettings: z.looseObject({}).describe('Date dependency settings returned by Airtable for the table.').optional(),
  fields: z.array(z.looseObject({
    id: z.string().describe('Field ID.'),
    name: z.string().describe('Field name.'),
    type: z.string().describe('Field type reported by Airtable.'),
    description: z.string().describe('Field description when Airtable returns one.').optional(),
    options: z.looseObject({}).describe('Field options reported by Airtable.').optional(),
  }).describe('Airtable field definition.')).describe('Fields defined on the Airtable table.'),
  views: z.array(z.looseObject({
    id: z.string().describe('View ID.'),
    name: z.string().describe('View name.'),
    type: z.string().describe('View type reported by Airtable.').optional(),
    visibleFieldIds: z.array(z.string()).describe('Field IDs visible in the Airtable view.').optional(),
  }).describe('Airtable view definition.')).describe('Views defined on the Airtable table.').optional(),
}).describe('Airtable table definition.')

export const createFieldInput = z.strictObject({
  baseId: z.string().min(1).describe('Base ID in the format appXXXXXXXXXXXXXX.'),
  tableId: z.string().min(1).describe('Table ID in the format tblXXXXXXXXXXXXXX.'),
  name: z.string().min(1).describe('Name for the Airtable field.'),
  type: z.string().min(1).describe('Airtable field type, such as singleLineText.'),
  description: z.string().max(20000).describe('Optional Airtable description, up to 20,000 characters.').optional(),
  options: z.looseObject({}).describe('Type-specific Airtable field options.').optional(),
}).describe('The input payload for this action.')

export const createFieldOutput = z.looseObject({
  id: z.string().describe('Field ID.'),
  name: z.string().describe('Field name.'),
  type: z.string().describe('Field type reported by Airtable.'),
  description: z.string().describe('Field description when Airtable returns one.').optional(),
  options: z.looseObject({}).describe('Field options reported by Airtable.').optional(),
}).describe('Airtable field definition.')

export const updateFieldInput = z.strictObject({
  baseId: z.string().min(1).describe('Base ID in the format appXXXXXXXXXXXXXX.'),
  tableId: z.string().min(1).describe('Table ID in the format tblXXXXXXXXXXXXXX.'),
  columnId: z.string().min(1).describe('Field ID in the format fldXXXXXXXXXXXXXX.'),
  name: z.string().min(1).describe('Name for the Airtable field.').optional(),
  description: z.string().max(20000).describe('Optional Airtable description, up to 20,000 characters.').optional(),
  options: z.looseObject({}).describe('Type-specific Airtable field options.').optional(),
}).describe('The input payload for this action.')

export const updateFieldOutput = z.looseObject({
  id: z.string().describe('Field ID.'),
  name: z.string().describe('Field name.'),
  type: z.string().describe('Field type reported by Airtable.'),
  description: z.string().describe('Field description when Airtable returns one.').optional(),
  options: z.looseObject({}).describe('Field options reported by Airtable.').optional(),
}).describe('Airtable field definition.')

export const listRecordsInput = z.strictObject({
  baseId: z.string().min(1).describe('Base ID in the format appXXXXXXXXXXXXXX.'),
  tableIdOrName: z.string().min(1).describe('Table ID or table name accepted by the Airtable path parameter.'),
  cellFormat: z.enum(['json', 'string']).describe('Cell format accepted by Airtable for read operations.').optional(),
  timeZone: z.string().min(1).describe('Timezone string sent to Airtable when cellFormat is string.').optional(),
  userLocale: z.string().min(1).describe('User locale sent to Airtable when cellFormat is string.').optional(),
  returnFieldsByFieldId: z.boolean().describe('Whether Airtable should return field IDs instead of field names in record objects.').optional(),
  includeDateDependencyMetadata: z.boolean().describe('Whether Airtable should return date dependency metadata for linked record fields.').optional(),
  view: z.string().min(1).describe('View name or view ID used by Airtable to filter and sort results.').optional(),
  fields: z.array(z.string().min(1)).min(1).describe('Field names or field IDs to include in the Airtable response.').optional(),
  sort: z.array(z.strictObject({
    field: z.string().min(1).describe('Field name or field ID used by Airtable for sorting.'),
    direction: z.enum(['asc', 'desc']).describe('Sort direction accepted by Airtable.').optional(),
  }).describe('Sort rule accepted by the Airtable list records endpoint.')).min(1).describe('Sort rules applied by Airtable in order.').optional(),
  filterByFormula: z.string().min(1).describe('Formula string evaluated by Airtable to filter matching records.').optional(),
  maxRecords: z.int().min(1).describe('Maximum total number of records to return before Airtable stops pagination.').optional(),
  pageSize: z.int().min(1).max(100).describe('Number of records to return per page.').optional(),
  offset: z.string().min(1).describe('Opaque pagination cursor returned by a previous Airtable response.').optional(),
  recordMetadata: z.array(z.literal('commentCount')).min(1).describe('Record metadata fields to include in Airtable list records responses.').optional(),
}).describe('The input payload for this action.')

export const listRecordsOutput = z.strictObject({
  records: z.array(z.looseObject({
    id: z.string().describe('Record ID.'),
    createdTime: z.string().describe('Record creation timestamp returned by Airtable.').optional(),
    fields: z.looseObject({}).describe('Record fields keyed by field name or field ID.'),
    commentCount: z.int().describe('Comment count returned by Airtable when enabled on the endpoint.').optional(),
  }).describe('Airtable record.')).describe('Records returned by Airtable.'),
  offset: z.string().describe('Pagination cursor for the next page of records, or null when unavailable.').nullable(),
}).describe('Airtable action output.')

export const getRecordInput = z.strictObject({
  baseId: z.string().min(1).describe('Base ID in the format appXXXXXXXXXXXXXX.'),
  tableIdOrName: z.string().min(1).describe('Table ID or table name accepted by the Airtable path parameter.'),
  cellFormat: z.enum(['json', 'string']).describe('Cell format accepted by Airtable for read operations.').optional(),
  timeZone: z.string().min(1).describe('Timezone string sent to Airtable when cellFormat is string.').optional(),
  userLocale: z.string().min(1).describe('User locale sent to Airtable when cellFormat is string.').optional(),
  returnFieldsByFieldId: z.boolean().describe('Whether Airtable should return field IDs instead of field names in record objects.').optional(),
  includeDateDependencyMetadata: z.boolean().describe('Whether Airtable should return date dependency metadata for linked record fields.').optional(),
  recordId: z.string().min(1).describe('Record ID in the format recXXXXXXXXXXXXXX.'),
}).describe('The input payload for this action.')

export const getRecordOutput = z.strictObject({
  record: z.looseObject({
    id: z.string().describe('Record ID.'),
    createdTime: z.string().describe('Record creation timestamp returned by Airtable.').optional(),
    fields: z.looseObject({}).describe('Record fields keyed by field name or field ID.'),
    commentCount: z.int().describe('Comment count returned by Airtable when enabled on the endpoint.').optional(),
  }).describe('Airtable record.'),
}).describe('Airtable action output.')

export const createRecordsInput = z.strictObject({
  baseId: z.string().min(1).describe('Base ID in the format appXXXXXXXXXXXXXX.'),
  tableIdOrName: z.string().min(1).describe('Table ID or table name accepted by the Airtable path parameter.'),
  records: z.array(z.strictObject({
    fields: z.looseObject({}).describe('Record fields keyed by field name or field ID.'),
  }).describe('Record payload used when creating Airtable records.')).min(1).max(10).describe('Records to create in the Airtable table.'),
  typecast: z.boolean().describe('Whether Airtable should coerce incoming values to compatible field types.').optional(),
  returnFieldsByFieldId: z.boolean().describe('Whether Airtable should return field IDs instead of field names in record objects.').optional(),
}).describe('The input payload for this action.')

export const createRecordsOutput = z.strictObject({
  records: z.array(z.looseObject({
    id: z.string().describe('Record ID.'),
    createdTime: z.string().describe('Record creation timestamp returned by Airtable.').optional(),
    fields: z.looseObject({}).describe('Record fields keyed by field name or field ID.'),
    commentCount: z.int().describe('Comment count returned by Airtable when enabled on the endpoint.').optional(),
  }).describe('Airtable record.')).describe('Records created by Airtable.'),
}).describe('Airtable action output.')

export const updateRecordsInput = z.strictObject({
  baseId: z.string().min(1).describe('Base ID in the format appXXXXXXXXXXXXXX.'),
  tableIdOrName: z.string().min(1).describe('Table ID or table name accepted by the Airtable path parameter.'),
  records: z.array(z.strictObject({
    id: z.string().min(1).describe('Record ID in the format recXXXXXXXXXXXXXX.'),
    fields: z.looseObject({}).describe('Record fields keyed by field name or field ID.'),
  }).describe('Record payload used when updating Airtable records.')).min(1).max(10).describe('Records to update in the Airtable table.'),
  typecast: z.boolean().describe('Whether Airtable should coerce incoming values to compatible field types.').optional(),
  returnFieldsByFieldId: z.boolean().describe('Whether Airtable should return field IDs instead of field names in record objects.').optional(),
}).describe('The input payload for this action.')

export const updateRecordsOutput = z.strictObject({
  records: z.array(z.looseObject({
    id: z.string().describe('Record ID.'),
    createdTime: z.string().describe('Record creation timestamp returned by Airtable.').optional(),
    fields: z.looseObject({}).describe('Record fields keyed by field name or field ID.'),
    commentCount: z.int().describe('Comment count returned by Airtable when enabled on the endpoint.').optional(),
  }).describe('Airtable record.')).describe('Records returned by Airtable after update.'),
}).describe('Airtable action output.')

export const deleteRecordsInput = z.strictObject({
  baseId: z.string().min(1).describe('Base ID in the format appXXXXXXXXXXXXXX.'),
  tableIdOrName: z.string().min(1).describe('Table ID or table name accepted by the Airtable path parameter.'),
  recordIds: z.array(z.string().min(1).describe('Record ID in the format recXXXXXXXXXXXXXX.')).min(1).max(10).describe('Record IDs to delete from the Airtable table.'),
}).describe('The input payload for this action.')

export const deleteRecordsOutput = z.strictObject({
  records: z.array(z.strictObject({
    id: z.string().describe('Record ID.'),
    deleted: z.boolean().describe('Whether Airtable reports the record as deleted.'),
  }).describe('Airtable deleted-record acknowledgement.')).describe('Deleted-record acknowledgements returned by Airtable.'),
}).describe('Airtable action output.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const airtableActions = {
  list_bases: {
    description: 'List Airtable bases accessible to the authenticated personal access token.',
    effect: 'read',
    inputSchema: listBasesInput,
    outputSchema: z.toJSONSchema(listBasesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_base_collaborators: {
    description: 'Read Airtable base metadata, including workspaceId and optional collaborator details.',
    effect: 'read',
    inputSchema: getBaseCollaboratorsInput,
    outputSchema: z.toJSONSchema(getBaseCollaboratorsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_base_schema: {
    description: 'Read Airtable table, field, and view schema for a specific base.',
    effect: 'read',
    inputSchema: getBaseSchemaInput,
    outputSchema: z.toJSONSchema(getBaseSchemaOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_base: {
    description: 'Create an Airtable base in a workspace with the provided initial table and field schema.',
    effect: 'write',
    inputSchema: createBaseInput,
    outputSchema: z.toJSONSchema(createBaseOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_base: {
    description: 'Delete an Airtable base. Airtable restricts this endpoint to enterprise admins.',
    effect: 'destructive',
    inputSchema: deleteBaseInput,
    outputSchema: z.toJSONSchema(deleteBaseOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_table: {
    description: 'Create a table in an Airtable base with the provided field schema.',
    effect: 'write',
    inputSchema: createTableInput,
    outputSchema: z.toJSONSchema(createTableOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_table: {
    description: 'Update an Airtable table name, description, or date dependency settings.',
    effect: 'write',
    inputSchema: updateTableInput,
    outputSchema: z.toJSONSchema(updateTableOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_field: {
    description: 'Create a field in an Airtable table.',
    effect: 'write',
    inputSchema: createFieldInput,
    outputSchema: z.toJSONSchema(createFieldOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_field: {
    description: 'Update an Airtable field name, description, or type-specific options.',
    effect: 'write',
    inputSchema: updateFieldInput,
    outputSchema: z.toJSONSchema(updateFieldOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_records: {
    description: 'List Airtable records from a table with optional fields, sorting, view filters, formula filters, and pagination.',
    effect: 'read',
    inputSchema: listRecordsInput,
    outputSchema: z.toJSONSchema(listRecordsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_record: {
    description: 'Read a single Airtable record by record ID.',
    effect: 'read',
    inputSchema: getRecordInput,
    outputSchema: z.toJSONSchema(getRecordOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_records: {
    description: 'Create one or more Airtable records in a table.',
    effect: 'write',
    inputSchema: createRecordsInput,
    outputSchema: z.toJSONSchema(createRecordsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_records: {
    description: 'Update one or more existing Airtable records by record ID.',
    effect: 'write',
    inputSchema: updateRecordsInput,
    outputSchema: z.toJSONSchema(updateRecordsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_records: {
    description: 'Delete one or more Airtable records by record ID.',
    effect: 'destructive',
    inputSchema: deleteRecordsInput,
    outputSchema: z.toJSONSchema(deleteRecordsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
