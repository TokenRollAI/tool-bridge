/**
 * Supabase 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listOrganizationsInput = z.strictObject({}).describe('No input parameters are required for this action.')

export const listOrganizationsOutput = z.strictObject({
  organizations: z.array(z.strictObject({
    id: z.string().describe('The unique identifier of the organization.'),
    name: z.string().describe('The name of the organization.'),
    slug: z.string().describe('The URL slug of the organization.').nullable().optional(),
  }).describe('A Supabase organization summary.')).describe('The list of organizations.'),
}).describe('Action output.')

export const getOrganizationInput = z.strictObject({
  organizationSlug: z.string().min(1).describe('The Supabase organization slug.'),
}).describe('Input parameters for fetching an organization.')

export const getOrganizationOutput = z.strictObject({
  organization: z.looseObject({
    id: z.string().describe('The unique identifier of the organization.'),
    name: z.string().describe('The name of the organization.'),
    plan: z.string().describe('The subscription plan of the organization.'),
  }).describe('The Supabase organization detail payload.'),
}).describe('Action output.')

export const listOrganizationMembersInput = z.strictObject({
  organizationSlug: z.string().min(1).describe('The Supabase organization slug.'),
}).describe('Input parameters for listing organization members.')

export const listOrganizationMembersOutput = z.strictObject({
  members: z.array(z.looseObject({
    userId: z.string().describe('The unique identifier of the member.'),
    userName: z.string().describe('The display name of the member.'),
    email: z.string().describe('The email address of the member.'),
    roleName: z.string().describe('The organization role name of the member.'),
    mfaEnabled: z.boolean().describe('Whether the member has MFA enabled.'),
  }).describe('A Supabase organization member.')).describe('The organization members.'),
}).describe('Action output.')

export const listOrganizationProjectsInput = z.strictObject({
  organizationSlug: z.string().min(1).describe('The Supabase organization slug.'),
  offset: z.int().min(0).describe('The number of projects to skip.').optional(),
  limit: z.int().min(1).max(100).describe('The maximum number of projects to return, up to 100.').optional(),
  search: z.string().min(1).describe('Search projects by name.').optional(),
  sort: z.enum(['name_asc', 'name_desc', 'created_asc', 'created_desc']).describe('The sort order for projects.').optional(),
  statuses: z.array(z.enum(['ACTIVE_HEALTHY', 'ACTIVE_UNHEALTHY', 'COMING_UP', 'GOING_DOWN', 'INACTIVE', 'INIT_FAILED', 'REMOVED', 'RESTARTING', 'UNKNOWN', 'UPGRADING', 'PAUSING', 'RESTORING', 'RESTORE_FAILED', 'PAUSE_FAILED', 'RESIZING']).describe('The current status of the Supabase project.')).min(1).describe('Project statuses to include.').optional(),
}).describe('Input parameters for listing organization projects.')

export const listOrganizationProjectsOutput = z.strictObject({
  projects: z.array(z.looseObject({
    ref: z.string().describe('The project reference identifier.'),
    name: z.string().describe('The project name.'),
    region: z.string().describe('The project region.'),
    status: z.enum(['ACTIVE_HEALTHY', 'ACTIVE_UNHEALTHY', 'COMING_UP', 'GOING_DOWN', 'INACTIVE', 'INIT_FAILED', 'REMOVED', 'RESTARTING', 'UNKNOWN', 'UPGRADING', 'PAUSING', 'RESTORING', 'RESTORE_FAILED', 'PAUSE_FAILED', 'RESIZING']).describe('The current status of the Supabase project.'),
  }).describe('A project returned from an organization listing.')).describe('The projects in the organization.'),
  pagination: z.strictObject({
    count: z.number().describe('The total number of matching records.'),
    limit: z.number().describe('The maximum number of records returned.'),
    offset: z.number().describe('The number of records skipped.'),
  }).describe('Pagination metadata returned by Supabase.'),
}).describe('Action output.')

export const listProjectsInput = z.strictObject({}).describe('No input parameters are required for this action.')

export const listProjectsOutput = z.strictObject({
  projects: z.array(z.strictObject({
    id: z.string().describe('The unique identifier of the project.'),
    organizationId: z.string().describe('The organization ID this project belongs to.'),
    name: z.string().describe('The name of the project.'),
    region: z.string().describe('The cloud region of the project.'),
    status: z.enum(['ACTIVE_HEALTHY', 'ACTIVE_UNHEALTHY', 'COMING_UP', 'GOING_DOWN', 'INACTIVE', 'INIT_FAILED', 'REMOVED', 'RESTARTING', 'UNKNOWN', 'UPGRADING', 'PAUSING', 'RESTORING', 'RESTORE_FAILED', 'PAUSE_FAILED', 'RESIZING']).describe('The current status of the Supabase project.').optional(),
    createdAt: z.string().describe('The timestamp when the project was created.'),
    database: z.strictObject({
      host: z.string().describe('The database host address.'),
      version: z.string().describe('The database version.'),
      postgresEngine: z.string().describe('The Postgres engine identifier.').nullable().optional(),
      releaseChannel: z.string().describe('The release channel of the database.').nullable().optional(),
    }).describe('A Supabase project database configuration.').optional(),
  }).describe('A Supabase project summary.')).describe('The list of projects.'),
}).describe('Action output.')

export const getProjectInput = z.strictObject({
  projectRef: z.string().min(1).max(64).describe('The Supabase project reference, for example \'abcdefghijklmnopqrst\'.'),
}).describe('Input parameters identifying a Supabase project.')

export const getProjectOutput = z.strictObject({
  project: z.strictObject({
    id: z.string().describe('The unique identifier of the project.'),
    ref: z.string().describe('The project reference identifier.'),
    organizationId: z.string().describe('The organization ID this project belongs to.'),
    organizationSlug: z.string().describe('The organization slug.'),
    name: z.string().describe('The name of the project.'),
    region: z.string().describe('The cloud region of the project.'),
    status: z.enum(['ACTIVE_HEALTHY', 'ACTIVE_UNHEALTHY', 'COMING_UP', 'GOING_DOWN', 'INACTIVE', 'INIT_FAILED', 'REMOVED', 'RESTARTING', 'UNKNOWN', 'UPGRADING', 'PAUSING', 'RESTORING', 'RESTORE_FAILED', 'PAUSE_FAILED', 'RESIZING']).describe('The current status of the Supabase project.'),
    createdAt: z.string().describe('The timestamp when the project was created.'),
    database: z.strictObject({
      host: z.string().describe('The database host address.'),
      version: z.string().describe('The database version.'),
      postgresEngine: z.string().describe('The Postgres engine identifier.').nullable().optional(),
      releaseChannel: z.string().describe('The release channel of the database.').nullable().optional(),
    }).describe('A Supabase project database configuration.'),
  }).describe('A Supabase project detail record.'),
}).describe('Action output.')

export const listAvailableRegionsInput = z.strictObject({
  organizationSlug: z.string().min(1).describe('The Supabase organization slug.'),
  continent: z.enum(['NA', 'SA', 'EU', 'AF', 'AS', 'OC', 'AN']).describe('Optional continent code for regional recommendations.').optional(),
  desiredInstanceSize: z.string().min(1).describe('Optional desired instance size for availability.').optional(),
}).describe('Input parameters for listing available project regions.')

export const listAvailableRegionsOutput = z.strictObject({
  regions: z.looseObject({}).describe('A JSON object returned by Supabase.'),
}).describe('Action output.')

export const getProjectHealthInput = z.strictObject({
  projectRef: z.string().min(1).max(64).describe('The Supabase project reference, for example \'abcdefghijklmnopqrst\'.'),
  services: z.array(z.enum(['auth', 'db', 'db_postgres_user', 'pooler', 'realtime', 'rest', 'storage', 'pg_bouncer']).describe('A Supabase service name to check health for.')).min(1).describe('The services to check.'),
  timeoutMs: z.int().min(0).max(10000).describe('Optional timeout in milliseconds, up to 10000.').optional(),
}).describe('Input parameters for checking project service health.')

export const getProjectHealthOutput = z.strictObject({
  services: z.array(z.looseObject({
    name: z.enum(['auth', 'db', 'db_postgres_user', 'pooler', 'realtime', 'rest', 'storage', 'pg_bouncer']).describe('A Supabase service name to check health for.'),
    healthy: z.boolean().describe('Deprecated upstream health flag. Prefer status when present.'),
    status: z.string().describe('The service health status.'),
    error: z.string().describe('The service health error message when present.'),
  }).describe('A Supabase service health result.')).describe('The health results returned by Supabase.'),
}).describe('Action output.')

export const listProjectApiKeysInput = z.strictObject({
  projectRef: z.string().min(1).max(64).describe('The Supabase project reference, for example \'abcdefghijklmnopqrst\'.'),
  reveal: z.boolean().describe('Whether to reveal the full API key values.').optional(),
}).describe('Input parameters for listing project API keys.')

export const listProjectApiKeysOutput = z.strictObject({
  apiKeys: z.array(z.strictObject({
    id: z.string().describe('The unique identifier of the API key.'),
    name: z.string().describe('The name of the API key.'),
    type: z.enum(['legacy', 'publishable', 'secret', 'unknown']).describe('The type of the API key.'),
    prefix: z.string().describe('The prefix portion of the API key.'),
    hash: z.string().describe('The hash of the API key.'),
    description: z.string().describe('The description of the API key.').nullable().optional(),
    apiKey: z.string().describe('The full API key value when reveal is true and Supabase returns it.').optional(),
    insertedAt: z.string().describe('The timestamp when the API key was created.').optional(),
    updatedAt: z.string().describe('The timestamp when the API key was last updated.').optional(),
    secretJwtTemplate: z.looseObject({}).describe('The JWT template for secret API keys.').nullable().optional(),
  }).describe('A Supabase API key record.')).describe('The list of API keys.'),
}).describe('Action output.')

export const getProjectApiKeyInput = z.strictObject({
  projectRef: z.string().min(1).max(64).describe('The Supabase project reference, for example \'abcdefghijklmnopqrst\'.'),
  apiKeyId: z.string().min(1).describe('The unique identifier of the project API key.'),
  reveal: z.boolean().describe('Whether to reveal the full API key value.').optional(),
}).describe('Input parameters for fetching one project API key.')

export const getProjectApiKeyOutput = z.strictObject({
  apiKey: z.strictObject({
    id: z.string().describe('The unique identifier of the API key.'),
    name: z.string().describe('The name of the API key.'),
    type: z.enum(['legacy', 'publishable', 'secret', 'unknown']).describe('The type of the API key.'),
    prefix: z.string().describe('The prefix portion of the API key.'),
    hash: z.string().describe('The hash of the API key.'),
    description: z.string().describe('The description of the API key.').nullable().optional(),
    apiKey: z.string().describe('The full API key value when reveal is true and Supabase returns it.').optional(),
    insertedAt: z.string().describe('The timestamp when the API key was created.').optional(),
    updatedAt: z.string().describe('The timestamp when the API key was last updated.').optional(),
    secretJwtTemplate: z.looseObject({}).describe('The JWT template for secret API keys.').nullable().optional(),
  }).describe('A Supabase API key record.'),
}).describe('Action output.')

export const createProjectApiKeyInput = z.strictObject({
  projectRef: z.string().min(1).max(64).describe('The Supabase project reference, for example \'abcdefghijklmnopqrst\'.'),
  name: z.string().min(4).max(64).regex(new RegExp('^[a-z_][a-z0-9_]+$')).describe('The API key name. Use lowercase letters, numbers, and underscores; it must start with a lowercase letter or underscore.'),
  type: z.enum(['publishable', 'secret']).describe('The type of API key to create.'),
  description: z.string().min(1).describe('The optional description for the API key.').optional(),
  reveal: z.boolean().describe('Whether to reveal the full API key value in the response.').optional(),
  secretJwtTemplate: z.looseObject({}).describe('The JWT template for secret API keys.').optional(),
}).describe('Input parameters for creating a project API key.')

export const createProjectApiKeyOutput = z.strictObject({
  apiKey: z.strictObject({
    id: z.string().describe('The unique identifier of the API key.'),
    name: z.string().describe('The name of the API key.'),
    type: z.enum(['legacy', 'publishable', 'secret', 'unknown']).describe('The type of the API key.'),
    prefix: z.string().describe('The prefix portion of the API key.'),
    hash: z.string().describe('The hash of the API key.'),
    description: z.string().describe('The description of the API key.').nullable().optional(),
    apiKey: z.string().describe('The full API key value when reveal is true and Supabase returns it.').optional(),
    insertedAt: z.string().describe('The timestamp when the API key was created.').optional(),
    updatedAt: z.string().describe('The timestamp when the API key was last updated.').optional(),
    secretJwtTemplate: z.looseObject({}).describe('The JWT template for secret API keys.').nullable().optional(),
  }).describe('A Supabase API key record.'),
}).describe('Action output.')

export const updateProjectApiKeyInput = z.strictObject({
  projectRef: z.string().min(1).max(64).describe('The Supabase project reference, for example \'abcdefghijklmnopqrst\'.'),
  apiKeyId: z.string().min(1).describe('The unique identifier of the project API key.'),
  name: z.string().min(4).max(64).regex(new RegExp('^[a-z_][a-z0-9_]+$')).describe('The API key name. Use lowercase letters, numbers, and underscores; it must start with a lowercase letter or underscore.').optional(),
  description: z.string().describe('The updated API key description.').nullable().optional(),
  reveal: z.boolean().describe('Whether to reveal the full API key value in the response.').optional(),
  secretJwtTemplate: z.looseObject({}).describe('The updated JWT template for secret API keys.').nullable().optional(),
}).describe('Input parameters for updating a project API key.')

export const updateProjectApiKeyOutput = z.strictObject({
  apiKey: z.strictObject({
    id: z.string().describe('The unique identifier of the API key.'),
    name: z.string().describe('The name of the API key.'),
    type: z.enum(['legacy', 'publishable', 'secret', 'unknown']).describe('The type of the API key.'),
    prefix: z.string().describe('The prefix portion of the API key.'),
    hash: z.string().describe('The hash of the API key.'),
    description: z.string().describe('The description of the API key.').nullable().optional(),
    apiKey: z.string().describe('The full API key value when reveal is true and Supabase returns it.').optional(),
    insertedAt: z.string().describe('The timestamp when the API key was created.').optional(),
    updatedAt: z.string().describe('The timestamp when the API key was last updated.').optional(),
    secretJwtTemplate: z.looseObject({}).describe('The JWT template for secret API keys.').nullable().optional(),
  }).describe('A Supabase API key record.'),
}).describe('Action output.')

export const deleteProjectApiKeyInput = z.strictObject({
  projectRef: z.string().min(1).max(64).describe('The Supabase project reference, for example \'abcdefghijklmnopqrst\'.'),
  apiKeyId: z.string().min(1).describe('The unique identifier of the project API key.'),
  reveal: z.boolean().describe('Whether Supabase should reveal key data in the delete response.').optional(),
  wasCompromised: z.boolean().describe('Whether the key is being deleted because it was compromised.').optional(),
  reason: z.string().min(1).describe('Optional deletion reason sent to Supabase.').optional(),
}).describe('Input parameters for deleting a project API key.')

export const deleteProjectApiKeyOutput = z.strictObject({
  apiKey: z.strictObject({
    id: z.string().describe('The unique identifier of the API key.'),
    name: z.string().describe('The name of the API key.'),
    type: z.enum(['legacy', 'publishable', 'secret', 'unknown']).describe('The type of the API key.'),
    prefix: z.string().describe('The prefix portion of the API key.'),
    hash: z.string().describe('The hash of the API key.'),
    description: z.string().describe('The description of the API key.').nullable().optional(),
    apiKey: z.string().describe('The full API key value when reveal is true and Supabase returns it.').optional(),
    insertedAt: z.string().describe('The timestamp when the API key was created.').optional(),
    updatedAt: z.string().describe('The timestamp when the API key was last updated.').optional(),
    secretJwtTemplate: z.looseObject({}).describe('The JWT template for secret API keys.').nullable().optional(),
  }).describe('A Supabase API key record.'),
}).describe('Action output.')

export const listProjectSecretsInput = z.strictObject({
  projectRef: z.string().min(1).max(64).describe('The Supabase project reference, for example \'abcdefghijklmnopqrst\'.'),
}).describe('Input parameters identifying a Supabase project.')

export const listProjectSecretsOutput = z.strictObject({
  secrets: z.array(z.strictObject({
    name: z.string().describe('The secret name.'),
    value: z.string().describe('The secret value when Supabase returns it.').optional(),
    updatedAt: z.string().describe('The timestamp when the secret was last updated.').optional(),
  }).describe('A Supabase project secret.')).describe('The project secrets returned by Supabase.'),
}).describe('Action output.')

export const upsertProjectSecretsInput = z.strictObject({
  projectRef: z.string().min(1).max(64).describe('The Supabase project reference, for example \'abcdefghijklmnopqrst\'.'),
  secrets: z.array(z.strictObject({
    name: z.string().min(1).max(256).describe('The secret name. It must not start with the reserved SUPABASE_ prefix.'),
    value: z.string().max(24576).describe('The secret value.'),
  }).describe('A secret name/value pair to upsert.')).min(1).describe('The secrets to create or update.'),
}).describe('Input parameters for upserting project secrets.')

export const upsertProjectSecretsOutput = z.strictObject({
  success: z.boolean().describe('Whether Supabase accepted the secret upsert request.'),
}).describe('Action output.')

export const deleteProjectSecretsInput = z.strictObject({
  projectRef: z.string().min(1).max(64).describe('The Supabase project reference, for example \'abcdefghijklmnopqrst\'.'),
  names: z.array(z.string().min(1).describe('A secret name.')).min(1).describe('The names of secrets to delete.'),
}).describe('Input parameters for deleting project secrets.')

export const deleteProjectSecretsOutput = z.strictObject({
  success: z.boolean().describe('Whether Supabase accepted the secret delete request.'),
}).describe('Action output.')

export const generateTypescriptTypesInput = z.strictObject({
  projectRef: z.string().min(1).max(64).describe('The Supabase project reference, for example \'abcdefghijklmnopqrst\'.'),
  includedSchemas: z.array(z.string().min(1)).min(1).describe('Database schemas to include, such as public or auth.').optional(),
}).describe('Input parameters for generating TypeScript types.')

export const generateTypescriptTypesOutput = z.strictObject({
  typescript: z.string().describe('The generated TypeScript type definitions.'),
}).describe('Action output.')

export const runReadOnlyQueryInput = z.strictObject({
  projectRef: z.string().min(1).max(64).describe('The Supabase project reference, for example \'abcdefghijklmnopqrst\'.'),
  query: z.string().min(1).describe('The SQL query to run with read-only permissions.'),
  parameters: z.array(z.unknown().describe('A query parameter.')).describe('Optional positional query parameters.').optional(),
}).describe('Input parameters for running a read-only SQL query.')

export const runReadOnlyQueryOutput = z.strictObject({
  result: z.unknown().describe('The raw read-only query response returned by Supabase, or null when Supabase returns no response body.'),
}).describe('Action output.')

export const listStorageBucketsInput = z.strictObject({
  projectRef: z.string().min(1).max(64).describe('The Supabase project reference, for example \'abcdefghijklmnopqrst\'.'),
}).describe('Input parameters identifying a Supabase project.')

export const listStorageBucketsOutput = z.strictObject({
  buckets: z.array(z.looseObject({}).describe('A JSON object returned by Supabase.')).describe('The Storage buckets returned by Supabase.'),
}).describe('Action output.')

export const listEdgeFunctionsInput = z.strictObject({
  projectRef: z.string().min(1).max(64).describe('The Supabase project reference, for example \'abcdefghijklmnopqrst\'.'),
}).describe('Input parameters identifying a Supabase project.')

export const listEdgeFunctionsOutput = z.strictObject({
  functions: z.array(z.looseObject({}).describe('A JSON object returned by Supabase.')).describe('The Edge Functions returned by Supabase.'),
}).describe('Action output.')

export const getEdgeFunctionInput = z.strictObject({
  projectRef: z.string().min(1).max(64).describe('The Supabase project reference, for example \'abcdefghijklmnopqrst\'.'),
  functionSlug: z.string().min(1).describe('The Edge Function slug.'),
}).describe('Input parameters for fetching an Edge Function.')

export const getEdgeFunctionOutput = z.strictObject({
  function: z.looseObject({}).describe('A JSON object returned by Supabase.'),
}).describe('Action output.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const supabaseActions = {
  list_organizations: {
    description: 'List the organizations available to the authenticated Supabase account.',
    effect: 'read',
    inputSchema: listOrganizationsInput,
    outputSchema: z.toJSONSchema(listOrganizationsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_organization: {
    description: 'Get details for a Supabase organization by slug.',
    effect: 'read',
    inputSchema: getOrganizationInput,
    outputSchema: z.toJSONSchema(getOrganizationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_organization_members: {
    description: 'List members of a Supabase organization.',
    effect: 'read',
    inputSchema: listOrganizationMembersInput,
    outputSchema: z.toJSONSchema(listOrganizationMembersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_organization_projects: {
    description: 'List projects in a Supabase organization with optional search and pagination.',
    effect: 'read',
    inputSchema: listOrganizationProjectsInput,
    outputSchema: z.toJSONSchema(listOrganizationProjectsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_projects: {
    description: 'List Supabase projects visible to the authenticated account.',
    effect: 'read',
    inputSchema: listProjectsInput,
    outputSchema: z.toJSONSchema(listProjectsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_project: {
    description: 'Get detailed metadata for a Supabase project by project ref.',
    effect: 'read',
    inputSchema: getProjectInput,
    outputSchema: z.toJSONSchema(getProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_available_regions: {
    description: 'List Supabase regions available for creating projects in an organization.',
    effect: 'read',
    inputSchema: listAvailableRegionsInput,
    outputSchema: z.toJSONSchema(listAvailableRegionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_project_health: {
    description: 'Check health for selected services in a Supabase project.',
    effect: 'read',
    inputSchema: getProjectHealthInput,
    outputSchema: z.toJSONSchema(getProjectHealthOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_project_api_keys: {
    description: 'List API keys for a Supabase project.',
    effect: 'read',
    inputSchema: listProjectApiKeysInput,
    outputSchema: z.toJSONSchema(listProjectApiKeysOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_project_api_key: {
    description: 'Get one API key record from a Supabase project.',
    effect: 'read',
    inputSchema: getProjectApiKeyInput,
    outputSchema: z.toJSONSchema(getProjectApiKeyOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_project_api_key: {
    description: 'Create a publishable or secret API key for a Supabase project.',
    effect: 'write',
    inputSchema: createProjectApiKeyInput,
    outputSchema: z.toJSONSchema(createProjectApiKeyOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_project_api_key: {
    description: 'Update the name, description, or JWT template for a Supabase project API key.',
    effect: 'write',
    inputSchema: updateProjectApiKeyInput,
    outputSchema: z.toJSONSchema(updateProjectApiKeyOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_project_api_key: {
    description: 'Delete a Supabase project API key.',
    effect: 'destructive',
    inputSchema: deleteProjectApiKeyInput,
    outputSchema: z.toJSONSchema(deleteProjectApiKeyOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_project_secrets: {
    description: 'List secrets configured for a Supabase project.',
    effect: 'read',
    inputSchema: listProjectSecretsInput,
    outputSchema: z.toJSONSchema(listProjectSecretsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  upsert_project_secrets: {
    description: 'Bulk create or update secrets for a Supabase project.',
    effect: 'write',
    inputSchema: upsertProjectSecretsInput,
    outputSchema: z.toJSONSchema(upsertProjectSecretsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_project_secrets: {
    description: 'Bulk delete secrets from a Supabase project.',
    effect: 'destructive',
    inputSchema: deleteProjectSecretsInput,
    outputSchema: z.toJSONSchema(deleteProjectSecretsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  generate_typescript_types: {
    description: 'Generate TypeScript database types for a Supabase project.',
    effect: 'read',
    inputSchema: generateTypescriptTypesInput,
    outputSchema: z.toJSONSchema(generateTypescriptTypesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  run_read_only_query: {
    description: 'Run a SQL query through Supabase as the read-only database user.',
    effect: 'write',
    inputSchema: runReadOnlyQueryInput,
    outputSchema: z.toJSONSchema(runReadOnlyQueryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_storage_buckets: {
    description: 'List Storage buckets for a Supabase project.',
    effect: 'read',
    inputSchema: listStorageBucketsInput,
    outputSchema: z.toJSONSchema(listStorageBucketsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_edge_functions: {
    description: 'List Edge Functions in a Supabase project.',
    effect: 'read',
    inputSchema: listEdgeFunctionsInput,
    outputSchema: z.toJSONSchema(listEdgeFunctionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_edge_function: {
    description: 'Get metadata for one Supabase Edge Function by slug.',
    effect: 'read',
    inputSchema: getEdgeFunctionInput,
    outputSchema: z.toJSONSchema(getEdgeFunctionOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
