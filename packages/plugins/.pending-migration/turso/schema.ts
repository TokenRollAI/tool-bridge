/**
 * Turso 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listOrganizationsInput = z.strictObject({}).describe('The input payload for listing Turso organizations.')

export const listOrganizationsOutput = z.strictObject({
  organizations: z.array(z.strictObject({
    slug: z.string().min(1).describe('The resource slug when Turso returns one.').optional(),
    name: z.string().min(1).describe('The resource name when Turso returns one.').optional(),
    type: z.string().min(1).describe('The resource type when Turso returns one.').optional(),
    location: z.string().min(1).describe('The location code when Turso returns one.').optional(),
    uuid: z.string().min(1).describe('The UUID when Turso returns one.').optional(),
    group: z.string().min(1).describe('The group name when Turso returns one.').optional(),
    hostname: z.string().min(1).describe('The database hostname when Turso returns one.').optional(),
    code: z.string().min(1).describe('The location code when Turso returns one.').optional(),
    raw: z.looseObject({}).describe('The raw Turso resource object returned by the Platform API.'),
  }).describe('A normalized Turso Platform API resource.')).describe('The organizations visible to the current API token.'),
}).describe('The organizations returned by the Turso Platform API.')

export const getOrganizationInput = z.strictObject({
  organizationSlug: z.string().min(1).describe('The organization slug used in the Turso API path.'),
}).describe('The input payload for retrieving one organization.')

export const getOrganizationOutput = z.strictObject({
  organization: z.strictObject({
    slug: z.string().min(1).describe('The resource slug when Turso returns one.').optional(),
    name: z.string().min(1).describe('The resource name when Turso returns one.').optional(),
    type: z.string().min(1).describe('The resource type when Turso returns one.').optional(),
    location: z.string().min(1).describe('The location code when Turso returns one.').optional(),
    uuid: z.string().min(1).describe('The UUID when Turso returns one.').optional(),
    group: z.string().min(1).describe('The group name when Turso returns one.').optional(),
    hostname: z.string().min(1).describe('The database hostname when Turso returns one.').optional(),
    code: z.string().min(1).describe('The location code when Turso returns one.').optional(),
    raw: z.looseObject({}).describe('The raw Turso resource object returned by the Platform API.'),
  }).describe('A normalized Turso Platform API resource.'),
}).describe('The organization returned by the Turso Platform API.')

export const listLocationsInput = z.strictObject({}).describe('The input payload for listing Turso locations.')

export const listLocationsOutput = z.strictObject({
  locations: z.array(z.strictObject({
    slug: z.string().min(1).describe('The resource slug when Turso returns one.').optional(),
    name: z.string().min(1).describe('The resource name when Turso returns one.').optional(),
    type: z.string().min(1).describe('The resource type when Turso returns one.').optional(),
    location: z.string().min(1).describe('The location code when Turso returns one.').optional(),
    uuid: z.string().min(1).describe('The UUID when Turso returns one.').optional(),
    group: z.string().min(1).describe('The group name when Turso returns one.').optional(),
    hostname: z.string().min(1).describe('The database hostname when Turso returns one.').optional(),
    code: z.string().min(1).describe('The location code when Turso returns one.').optional(),
    raw: z.looseObject({}).describe('The raw Turso resource object returned by the Platform API.'),
  }).describe('A normalized Turso Platform API resource.')).describe('The available Turso locations.'),
}).describe('The locations returned by the Turso Platform API.')

export const listGroupsInput = z.strictObject({
  organizationSlug: z.string().min(1).describe('The organization slug used in the Turso API path.'),
}).describe('The input payload for listing Turso groups.')

export const listGroupsOutput = z.strictObject({
  groups: z.array(z.strictObject({
    slug: z.string().min(1).describe('The resource slug when Turso returns one.').optional(),
    name: z.string().min(1).describe('The resource name when Turso returns one.').optional(),
    type: z.string().min(1).describe('The resource type when Turso returns one.').optional(),
    location: z.string().min(1).describe('The location code when Turso returns one.').optional(),
    uuid: z.string().min(1).describe('The UUID when Turso returns one.').optional(),
    group: z.string().min(1).describe('The group name when Turso returns one.').optional(),
    hostname: z.string().min(1).describe('The database hostname when Turso returns one.').optional(),
    code: z.string().min(1).describe('The location code when Turso returns one.').optional(),
    raw: z.looseObject({}).describe('The raw Turso resource object returned by the Platform API.'),
  }).describe('A normalized Turso Platform API resource.')).describe('The Turso groups belonging to the organization.'),
}).describe('The Turso groups returned for one organization.')

export const getGroupInput = z.strictObject({
  organizationSlug: z.string().min(1).describe('The organization slug used in the Turso API path.'),
  name: z.string().min(1).describe('The Turso group name.'),
}).describe('The input payload for retrieving one Turso group.')

export const getGroupOutput = z.strictObject({
  group: z.strictObject({
    slug: z.string().min(1).describe('The resource slug when Turso returns one.').optional(),
    name: z.string().min(1).describe('The resource name when Turso returns one.').optional(),
    type: z.string().min(1).describe('The resource type when Turso returns one.').optional(),
    location: z.string().min(1).describe('The location code when Turso returns one.').optional(),
    uuid: z.string().min(1).describe('The UUID when Turso returns one.').optional(),
    group: z.string().min(1).describe('The group name when Turso returns one.').optional(),
    hostname: z.string().min(1).describe('The database hostname when Turso returns one.').optional(),
    code: z.string().min(1).describe('The location code when Turso returns one.').optional(),
    raw: z.looseObject({}).describe('The raw Turso resource object returned by the Platform API.'),
  }).describe('A normalized Turso Platform API resource.'),
}).describe('The Turso group returned by the Platform API.')

export const createGroupInput = z.strictObject({
  organizationSlug: z.string().min(1).describe('The organization slug used in the Turso API path.'),
  name: z.string().min(1).describe('The Turso group name.'),
  location: z.string().min(1).describe('The primary Turso location code for the group.'),
  extensions: z.union([z.enum(['all']).describe('Enable every supported extension.'), z.array(z.string().min(1).describe('One Turso extension name.')).min(1).describe('The explicit extension names to enable for new databases in the group.')]).describe('The extensions to enable for new databases in the group.').optional(),
}).describe('The input payload for creating a Turso group.')

export const createGroupOutput = z.strictObject({
  group: z.strictObject({
    slug: z.string().min(1).describe('The resource slug when Turso returns one.').optional(),
    name: z.string().min(1).describe('The resource name when Turso returns one.').optional(),
    type: z.string().min(1).describe('The resource type when Turso returns one.').optional(),
    location: z.string().min(1).describe('The location code when Turso returns one.').optional(),
    uuid: z.string().min(1).describe('The UUID when Turso returns one.').optional(),
    group: z.string().min(1).describe('The group name when Turso returns one.').optional(),
    hostname: z.string().min(1).describe('The database hostname when Turso returns one.').optional(),
    code: z.string().min(1).describe('The location code when Turso returns one.').optional(),
    raw: z.looseObject({}).describe('The raw Turso resource object returned by the Platform API.'),
  }).describe('A normalized Turso Platform API resource.'),
}).describe('The newly created Turso group.')

export const listDatabasesInput = z.strictObject({
  organizationSlug: z.string().min(1).describe('The organization slug used in the Turso API path.'),
}).describe('The input payload for listing Turso databases.')

export const listDatabasesOutput = z.strictObject({
  databases: z.array(z.strictObject({
    slug: z.string().min(1).describe('The resource slug when Turso returns one.').optional(),
    name: z.string().min(1).describe('The resource name when Turso returns one.').optional(),
    type: z.string().min(1).describe('The resource type when Turso returns one.').optional(),
    location: z.string().min(1).describe('The location code when Turso returns one.').optional(),
    uuid: z.string().min(1).describe('The UUID when Turso returns one.').optional(),
    group: z.string().min(1).describe('The group name when Turso returns one.').optional(),
    hostname: z.string().min(1).describe('The database hostname when Turso returns one.').optional(),
    code: z.string().min(1).describe('The location code when Turso returns one.').optional(),
    raw: z.looseObject({}).describe('The raw Turso resource object returned by the Platform API.'),
  }).describe('A normalized Turso Platform API resource.')).describe('The Turso databases belonging to the organization.'),
}).describe('The Turso databases returned for one organization.')

export const getDatabaseInput = z.strictObject({
  organizationSlug: z.string().min(1).describe('The organization slug used in the Turso API path.'),
  name: z.string().min(1).describe('The Turso database name.'),
}).describe('The input payload for retrieving one Turso database.')

export const getDatabaseOutput = z.strictObject({
  database: z.strictObject({
    slug: z.string().min(1).describe('The resource slug when Turso returns one.').optional(),
    name: z.string().min(1).describe('The resource name when Turso returns one.').optional(),
    type: z.string().min(1).describe('The resource type when Turso returns one.').optional(),
    location: z.string().min(1).describe('The location code when Turso returns one.').optional(),
    uuid: z.string().min(1).describe('The UUID when Turso returns one.').optional(),
    group: z.string().min(1).describe('The group name when Turso returns one.').optional(),
    hostname: z.string().min(1).describe('The database hostname when Turso returns one.').optional(),
    code: z.string().min(1).describe('The location code when Turso returns one.').optional(),
    raw: z.looseObject({}).describe('The raw Turso resource object returned by the Platform API.'),
  }).describe('A normalized Turso Platform API resource.'),
}).describe('The Turso database returned by the Platform API.')

export const createDatabaseInput = z.strictObject({
  organizationSlug: z.string().min(1).describe('The organization slug used in the Turso API path.'),
  name: z.string().min(1).describe('The Turso database name.'),
  group: z.string().min(1).describe('The Turso group where the database should be created.'),
}).describe('The input payload for creating a Turso database.')

export const createDatabaseOutput = z.strictObject({
  database: z.strictObject({
    slug: z.string().min(1).describe('The resource slug when Turso returns one.').optional(),
    name: z.string().min(1).describe('The resource name when Turso returns one.').optional(),
    type: z.string().min(1).describe('The resource type when Turso returns one.').optional(),
    location: z.string().min(1).describe('The location code when Turso returns one.').optional(),
    uuid: z.string().min(1).describe('The UUID when Turso returns one.').optional(),
    group: z.string().min(1).describe('The group name when Turso returns one.').optional(),
    hostname: z.string().min(1).describe('The database hostname when Turso returns one.').optional(),
    code: z.string().min(1).describe('The location code when Turso returns one.').optional(),
    raw: z.looseObject({}).describe('The raw Turso resource object returned by the Platform API.'),
  }).describe('A normalized Turso Platform API resource.'),
}).describe('The newly created Turso database.')

export const deleteDatabaseInput = z.strictObject({
  organizationSlug: z.string().min(1).describe('The organization slug used in the Turso API path.'),
  name: z.string().min(1).describe('The Turso database name.'),
}).describe('The input payload for deleting one Turso database.')

export const deleteDatabaseOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the connector finished the delete request successfully.'),
}).describe('The normalized delete result returned by the connector.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const tursoActions = {
  list_organizations: {
    description: 'List organizations visible to the current Turso Platform API token.',
    effect: 'read',
    inputSchema: listOrganizationsInput,
    outputSchema: z.toJSONSchema(listOrganizationsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_organization: {
    description: 'Retrieve one Turso organization by slug.',
    effect: 'read',
    inputSchema: getOrganizationInput,
    outputSchema: z.toJSONSchema(getOrganizationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_locations: {
    description: 'List available Turso locations that can host groups.',
    effect: 'read',
    inputSchema: listLocationsInput,
    outputSchema: z.toJSONSchema(listLocationsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_groups: {
    description: 'List Turso groups for one organization.',
    effect: 'read',
    inputSchema: listGroupsInput,
    outputSchema: z.toJSONSchema(listGroupsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_group: {
    description: 'Retrieve one Turso group by name within an organization.',
    effect: 'read',
    inputSchema: getGroupInput,
    outputSchema: z.toJSONSchema(getGroupOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_group: {
    description: 'Create a Turso group in one organization with a primary location.',
    effect: 'write',
    inputSchema: createGroupInput,
    outputSchema: z.toJSONSchema(createGroupOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_databases: {
    description: 'List Turso databases for one organization.',
    effect: 'read',
    inputSchema: listDatabasesInput,
    outputSchema: z.toJSONSchema(listDatabasesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_database: {
    description: 'Retrieve one Turso database by name within an organization.',
    effect: 'read',
    inputSchema: getDatabaseInput,
    outputSchema: z.toJSONSchema(getDatabaseOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_database: {
    description: 'Create a Turso database in one organization and group.',
    effect: 'write',
    inputSchema: createDatabaseInput,
    outputSchema: z.toJSONSchema(createDatabaseOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_database: {
    description: 'Delete a Turso database from one organization.',
    effect: 'destructive',
    inputSchema: deleteDatabaseInput,
    outputSchema: z.toJSONSchema(deleteDatabaseOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
