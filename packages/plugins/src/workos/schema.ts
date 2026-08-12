/**
 * WorkOS 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listUsersInput = z.strictObject({
  before: z.string().min(1).describe('An object ID that defines the cursor position before the requested page.').optional(),
  after: z.string().min(1).describe('An object ID that defines the cursor position after the requested page.').optional(),
  limit: z.int().min(1).max(100).describe('Upper limit on the number of objects to return, between 1 and 100.').optional(),
  order: z.enum(['normal', 'desc', 'asc']).describe('Order the results by creation time.').optional(),
  organization_id: z.string().min(1).describe('Filter users by the organization they are members of.').optional(),
  email: z.string().min(1).describe('Filter users by their email address.').optional(),
}).describe('Input parameters for listing WorkOS users.')

export const listUsersOutput = z.strictObject({
  users: z.array(z.looseObject({
    object: z.string().describe('Object type returned by WorkOS.').optional(),
    id: z.string().describe('The unique ID of the user.').optional(),
    email: z.string().describe('The email address of the user.').optional(),
    first_name: z.string().describe('The first name of the user.').nullable().optional(),
    last_name: z.string().describe('The last name of the user.').nullable().optional(),
    name: z.string().describe('The user\'s full name.').nullable().optional(),
    email_verified: z.boolean().describe('Whether the user\'s email has been verified.').optional(),
    external_id: z.string().describe('The external ID of the user.').nullable().optional(),
    metadata: z.looseObject({}).describe('Metadata key/value pairs associated with the resource.').optional(),
    created_at: z.string().describe('An ISO 8601 timestamp for when the user was created.').optional(),
    updated_at: z.string().describe('An ISO 8601 timestamp for when the user was last updated.').optional(),
  }).describe('WorkOS user object.')).describe('Users returned by WorkOS.'),
  list_metadata: z.looseObject({
    before: z.string().describe('Cursor for the previous page when returned by WorkOS.').nullable().optional(),
    after: z.string().describe('Cursor for the next page when returned by WorkOS.').nullable().optional(),
  }).describe('WorkOS pagination metadata returned for a list request.'),
  raw: z.looseObject({}).describe('Raw WorkOS response payload.'),
}).describe('A page of WorkOS users.')

export const getUserInput = z.strictObject({
  id: z.string().min(1).describe('The unique ID of the user.'),
}).describe('Input parameters for getting a WorkOS user.')

export const getUserOutput = z.strictObject({
  user: z.looseObject({
    object: z.string().describe('Object type returned by WorkOS.').optional(),
    id: z.string().describe('The unique ID of the user.').optional(),
    email: z.string().describe('The email address of the user.').optional(),
    first_name: z.string().describe('The first name of the user.').nullable().optional(),
    last_name: z.string().describe('The last name of the user.').nullable().optional(),
    name: z.string().describe('The user\'s full name.').nullable().optional(),
    email_verified: z.boolean().describe('Whether the user\'s email has been verified.').optional(),
    external_id: z.string().describe('The external ID of the user.').nullable().optional(),
    metadata: z.looseObject({}).describe('Metadata key/value pairs associated with the resource.').optional(),
    created_at: z.string().describe('An ISO 8601 timestamp for when the user was created.').optional(),
    updated_at: z.string().describe('An ISO 8601 timestamp for when the user was last updated.').optional(),
  }).describe('WorkOS user object.'),
  raw: z.looseObject({}).describe('Raw WorkOS response payload.'),
}).describe('A WorkOS user response.')

export const createUserInput = z.strictObject({
  email: z.email().describe('The email address of the user.'),
  first_name: z.string().min(1).describe('The first name of the user.').optional(),
  last_name: z.string().min(1).describe('The last name of the user.').optional(),
  name: z.string().min(1).describe('The user\'s full name.').optional(),
  email_verified: z.boolean().describe('Whether the user\'s email address was previously verified.').optional(),
  metadata: z.looseObject({}).describe('Metadata key/value pairs associated with the resource.').optional(),
  external_id: z.string().min(1).describe('The external identifier of the user.').optional(),
  password: z.string().min(1).describe('The password to set for the user.').optional(),
}).describe('Input parameters for creating a WorkOS user.')

export const createUserOutput = z.strictObject({
  user: z.looseObject({
    object: z.string().describe('Object type returned by WorkOS.').optional(),
    id: z.string().describe('The unique ID of the user.').optional(),
    email: z.string().describe('The email address of the user.').optional(),
    first_name: z.string().describe('The first name of the user.').nullable().optional(),
    last_name: z.string().describe('The last name of the user.').nullable().optional(),
    name: z.string().describe('The user\'s full name.').nullable().optional(),
    email_verified: z.boolean().describe('Whether the user\'s email has been verified.').optional(),
    external_id: z.string().describe('The external ID of the user.').nullable().optional(),
    metadata: z.looseObject({}).describe('Metadata key/value pairs associated with the resource.').optional(),
    created_at: z.string().describe('An ISO 8601 timestamp for when the user was created.').optional(),
    updated_at: z.string().describe('An ISO 8601 timestamp for when the user was last updated.').optional(),
  }).describe('WorkOS user object.'),
  raw: z.looseObject({}).describe('Raw WorkOS response payload.'),
}).describe('A WorkOS user response.')

export const updateUserInput = z.strictObject({
  id: z.string().min(1).describe('The unique ID of the user.'),
  first_name: z.string().min(1).describe('The first name of the user.').optional(),
  last_name: z.string().min(1).describe('The last name of the user.').optional(),
  name: z.string().min(1).describe('The user\'s full name.').optional(),
  email_verified: z.boolean().describe('Whether the user\'s email address was previously verified.').optional(),
  metadata: z.looseObject({}).describe('Metadata key/value pairs associated with the resource.').optional(),
  external_id: z.string().min(1).describe('The external identifier of the user.').optional(),
  password: z.string().min(1).describe('The password to set for the user.').optional(),
}).describe('Input parameters for updating a WorkOS user.')

export const updateUserOutput = z.strictObject({
  user: z.looseObject({
    object: z.string().describe('Object type returned by WorkOS.').optional(),
    id: z.string().describe('The unique ID of the user.').optional(),
    email: z.string().describe('The email address of the user.').optional(),
    first_name: z.string().describe('The first name of the user.').nullable().optional(),
    last_name: z.string().describe('The last name of the user.').nullable().optional(),
    name: z.string().describe('The user\'s full name.').nullable().optional(),
    email_verified: z.boolean().describe('Whether the user\'s email has been verified.').optional(),
    external_id: z.string().describe('The external ID of the user.').nullable().optional(),
    metadata: z.looseObject({}).describe('Metadata key/value pairs associated with the resource.').optional(),
    created_at: z.string().describe('An ISO 8601 timestamp for when the user was created.').optional(),
    updated_at: z.string().describe('An ISO 8601 timestamp for when the user was last updated.').optional(),
  }).describe('WorkOS user object.'),
  raw: z.looseObject({}).describe('Raw WorkOS response payload.'),
}).describe('A WorkOS user response.')

export const listOrganizationsInput = z.strictObject({
  before: z.string().min(1).describe('An object ID that defines the cursor position before the requested page.').optional(),
  after: z.string().min(1).describe('An object ID that defines the cursor position after the requested page.').optional(),
  limit: z.int().min(1).max(100).describe('Upper limit on the number of objects to return, between 1 and 100.').optional(),
  order: z.enum(['normal', 'desc', 'asc']).describe('Order the results by creation time.').optional(),
  domains: z.array(z.string().min(1).describe('A domain name.')).describe('Domains to match against organizations.').optional(),
  search: z.string().min(1).describe('Search text matched against organization names.').optional(),
}).describe('Input parameters for listing WorkOS organizations.')

export const listOrganizationsOutput = z.strictObject({
  organizations: z.array(z.looseObject({
    object: z.string().describe('Object type returned by WorkOS.').optional(),
    id: z.string().describe('Unique identifier of the organization.').optional(),
    name: z.string().describe('A descriptive name for the organization.').optional(),
    domains: z.array(z.looseObject({}).describe('Organization domain.')).describe('Domains associated with the organization.').optional(),
    metadata: z.looseObject({}).describe('Metadata key/value pairs associated with the resource.').optional(),
    external_id: z.string().describe('The external ID of the organization.').nullable().optional(),
    created_at: z.string().describe('The timestamp when the organization was created.').optional(),
    updated_at: z.string().describe('The timestamp when the organization was last updated.').optional(),
  }).describe('WorkOS organization object.')).describe('Organizations returned by WorkOS.'),
  list_metadata: z.looseObject({
    before: z.string().describe('Cursor for the previous page when returned by WorkOS.').nullable().optional(),
    after: z.string().describe('Cursor for the next page when returned by WorkOS.').nullable().optional(),
  }).describe('WorkOS pagination metadata returned for a list request.'),
  raw: z.looseObject({}).describe('Raw WorkOS response payload.'),
}).describe('A page of WorkOS organizations.')

export const getOrganizationInput = z.strictObject({
  id: z.string().min(1).describe('Unique identifier of the organization.'),
}).describe('Input parameters for getting a WorkOS organization.')

export const getOrganizationOutput = z.strictObject({
  organization: z.looseObject({
    object: z.string().describe('Object type returned by WorkOS.').optional(),
    id: z.string().describe('Unique identifier of the organization.').optional(),
    name: z.string().describe('A descriptive name for the organization.').optional(),
    domains: z.array(z.looseObject({}).describe('Organization domain.')).describe('Domains associated with the organization.').optional(),
    metadata: z.looseObject({}).describe('Metadata key/value pairs associated with the resource.').optional(),
    external_id: z.string().describe('The external ID of the organization.').nullable().optional(),
    created_at: z.string().describe('The timestamp when the organization was created.').optional(),
    updated_at: z.string().describe('The timestamp when the organization was last updated.').optional(),
  }).describe('WorkOS organization object.'),
  raw: z.looseObject({}).describe('Raw WorkOS response payload.'),
}).describe('A WorkOS organization response.')

export const createOrganizationInput = z.strictObject({
  name: z.string().min(1).describe('The name of the organization.'),
  allow_profiles_outside_organization: z.boolean().describe('Whether the organization allows profiles from outside the organization to sign in.').optional(),
  domain_data: z.array(z.looseObject({
    domain: z.string().describe('The organization domain name.').optional(),
    state: z.string().describe('The domain verification state.').optional(),
  }).describe('WorkOS organization domain data.')).describe('Domains associated with the organization, including verification state.').optional(),
  metadata: z.looseObject({}).describe('Metadata key/value pairs associated with the resource.').optional(),
  external_id: z.string().min(1).describe('An external identifier for the organization.').optional(),
}).describe('Input parameters for creating a WorkOS organization.')

export const createOrganizationOutput = z.strictObject({
  organization: z.looseObject({
    object: z.string().describe('Object type returned by WorkOS.').optional(),
    id: z.string().describe('Unique identifier of the organization.').optional(),
    name: z.string().describe('A descriptive name for the organization.').optional(),
    domains: z.array(z.looseObject({}).describe('Organization domain.')).describe('Domains associated with the organization.').optional(),
    metadata: z.looseObject({}).describe('Metadata key/value pairs associated with the resource.').optional(),
    external_id: z.string().describe('The external ID of the organization.').nullable().optional(),
    created_at: z.string().describe('The timestamp when the organization was created.').optional(),
    updated_at: z.string().describe('The timestamp when the organization was last updated.').optional(),
  }).describe('WorkOS organization object.'),
  raw: z.looseObject({}).describe('Raw WorkOS response payload.'),
}).describe('A WorkOS organization response.')

export const updateOrganizationInput = z.strictObject({
  id: z.string().min(1).describe('Unique identifier of the organization.'),
  name: z.string().min(1).describe('The name of the organization.').optional(),
  allow_profiles_outside_organization: z.boolean().describe('Whether the organization allows profiles from outside the organization to sign in.').optional(),
  domain_data: z.array(z.looseObject({
    domain: z.string().describe('The organization domain name.').optional(),
    state: z.string().describe('The domain verification state.').optional(),
  }).describe('WorkOS organization domain data.')).describe('Domains associated with the organization, including verification state.').optional(),
  metadata: z.looseObject({}).describe('Metadata key/value pairs associated with the resource.').optional(),
  external_id: z.string().min(1).describe('An external identifier for the organization.').optional(),
}).describe('Input parameters for updating a WorkOS organization.')

export const updateOrganizationOutput = z.strictObject({
  organization: z.looseObject({
    object: z.string().describe('Object type returned by WorkOS.').optional(),
    id: z.string().describe('Unique identifier of the organization.').optional(),
    name: z.string().describe('A descriptive name for the organization.').optional(),
    domains: z.array(z.looseObject({}).describe('Organization domain.')).describe('Domains associated with the organization.').optional(),
    metadata: z.looseObject({}).describe('Metadata key/value pairs associated with the resource.').optional(),
    external_id: z.string().describe('The external ID of the organization.').nullable().optional(),
    created_at: z.string().describe('The timestamp when the organization was created.').optional(),
    updated_at: z.string().describe('The timestamp when the organization was last updated.').optional(),
  }).describe('WorkOS organization object.'),
  raw: z.looseObject({}).describe('Raw WorkOS response payload.'),
}).describe('A WorkOS organization response.')

export const listOrganizationMembershipsInput = z.strictObject({
  before: z.string().min(1).describe('An object ID that defines the cursor position before the requested page.').optional(),
  after: z.string().min(1).describe('An object ID that defines the cursor position after the requested page.').optional(),
  limit: z.int().min(1).max(100).describe('Upper limit on the number of objects to return, between 1 and 100.').optional(),
  order: z.enum(['normal', 'desc', 'asc']).describe('Order the results by creation time.').optional(),
  organization_id: z.string().min(1).describe('The ID of the organization which the user belongs to.').optional(),
  user_id: z.string().min(1).describe('The ID of the user.').optional(),
  statuses: z.array(z.enum(['active', 'inactive', 'pending']).describe('A WorkOS organization membership status.')).describe('Statuses to include in the membership list.').optional(),
}).describe('Input parameters for listing WorkOS organization memberships.')

export const listOrganizationMembershipsOutput = z.strictObject({
  organization_memberships: z.array(z.looseObject({
    object: z.string().describe('Object type returned by WorkOS.').optional(),
    id: z.string().describe('The unique ID of the organization membership.').optional(),
    userId: z.string().describe('The ID of the WorkOS user.').optional(),
    organizationId: z.string().describe('The ID of the WorkOS organization.').optional(),
    organizationName: z.string().describe('The name of the WorkOS organization.').optional(),
    status: z.enum(['active', 'inactive', 'pending']).describe('A WorkOS organization membership status.').optional(),
    createdAt: z.string().describe('The timestamp when the organization membership was created.').optional(),
    updatedAt: z.string().describe('The timestamp when the organization membership was last updated.').optional(),
  }).describe('WorkOS organization membership object.')).describe('Organization memberships returned by WorkOS.'),
  list_metadata: z.looseObject({
    before: z.string().describe('Cursor for the previous page when returned by WorkOS.').nullable().optional(),
    after: z.string().describe('Cursor for the next page when returned by WorkOS.').nullable().optional(),
  }).describe('WorkOS pagination metadata returned for a list request.'),
  raw: z.looseObject({}).describe('Raw WorkOS response payload.'),
}).describe('A page of WorkOS organization memberships.')

export const getOrganizationMembershipInput = z.strictObject({
  id: z.string().min(1).describe('The unique ID of the organization membership.'),
}).describe('Input parameters for getting a WorkOS organization membership.')

export const getOrganizationMembershipOutput = z.strictObject({
  organization_membership: z.looseObject({
    object: z.string().describe('Object type returned by WorkOS.').optional(),
    id: z.string().describe('The unique ID of the organization membership.').optional(),
    userId: z.string().describe('The ID of the WorkOS user.').optional(),
    organizationId: z.string().describe('The ID of the WorkOS organization.').optional(),
    organizationName: z.string().describe('The name of the WorkOS organization.').optional(),
    status: z.enum(['active', 'inactive', 'pending']).describe('A WorkOS organization membership status.').optional(),
    createdAt: z.string().describe('The timestamp when the organization membership was created.').optional(),
    updatedAt: z.string().describe('The timestamp when the organization membership was last updated.').optional(),
  }).describe('WorkOS organization membership object.'),
  raw: z.looseObject({}).describe('Raw WorkOS response payload.'),
}).describe('A WorkOS organization membership response.')

export const createOrganizationMembershipInput = z.strictObject({
  user_id: z.string().min(1).describe('The ID of the user.'),
  organization_id: z.string().min(1).describe('The ID of the organization which the user belongs to.'),
  role_slug: z.string().min(1).describe('A single role identifier.').optional(),
  role_slugs: z.array(z.string().min(1).describe('A role identifier.')).describe('Role identifiers to assign to the user.').optional(),
}).describe('Input parameters for creating a WorkOS organization membership.')

export const createOrganizationMembershipOutput = z.strictObject({
  organization_membership: z.looseObject({
    object: z.string().describe('Object type returned by WorkOS.').optional(),
    id: z.string().describe('The unique ID of the organization membership.').optional(),
    userId: z.string().describe('The ID of the WorkOS user.').optional(),
    organizationId: z.string().describe('The ID of the WorkOS organization.').optional(),
    organizationName: z.string().describe('The name of the WorkOS organization.').optional(),
    status: z.enum(['active', 'inactive', 'pending']).describe('A WorkOS organization membership status.').optional(),
    createdAt: z.string().describe('The timestamp when the organization membership was created.').optional(),
    updatedAt: z.string().describe('The timestamp when the organization membership was last updated.').optional(),
  }).describe('WorkOS organization membership object.'),
  raw: z.looseObject({}).describe('Raw WorkOS response payload.'),
}).describe('A WorkOS organization membership response.')

export const updateOrganizationMembershipInput = z.strictObject({
  id: z.string().min(1).describe('The unique ID of the organization membership.'),
  role_slug: z.string().min(1).describe('A single role identifier.').optional(),
  role_slugs: z.array(z.string().min(1).describe('A role identifier.')).describe('Role identifiers to assign to the user.').optional(),
}).describe('Input parameters for updating a WorkOS organization membership.')

export const updateOrganizationMembershipOutput = z.strictObject({
  organization_membership: z.looseObject({
    object: z.string().describe('Object type returned by WorkOS.').optional(),
    id: z.string().describe('The unique ID of the organization membership.').optional(),
    userId: z.string().describe('The ID of the WorkOS user.').optional(),
    organizationId: z.string().describe('The ID of the WorkOS organization.').optional(),
    organizationName: z.string().describe('The name of the WorkOS organization.').optional(),
    status: z.enum(['active', 'inactive', 'pending']).describe('A WorkOS organization membership status.').optional(),
    createdAt: z.string().describe('The timestamp when the organization membership was created.').optional(),
    updatedAt: z.string().describe('The timestamp when the organization membership was last updated.').optional(),
  }).describe('WorkOS organization membership object.'),
  raw: z.looseObject({}).describe('Raw WorkOS response payload.'),
}).describe('A WorkOS organization membership response.')

export const deactivateOrganizationMembershipInput = z.strictObject({
  id: z.string().min(1).describe('The unique ID of the organization membership.'),
}).describe('Input parameters for deactivating a WorkOS organization membership.')

export const deactivateOrganizationMembershipOutput = z.strictObject({
  organization_membership: z.looseObject({
    object: z.string().describe('Object type returned by WorkOS.').optional(),
    id: z.string().describe('The unique ID of the organization membership.').optional(),
    userId: z.string().describe('The ID of the WorkOS user.').optional(),
    organizationId: z.string().describe('The ID of the WorkOS organization.').optional(),
    organizationName: z.string().describe('The name of the WorkOS organization.').optional(),
    status: z.enum(['active', 'inactive', 'pending']).describe('A WorkOS organization membership status.').optional(),
    createdAt: z.string().describe('The timestamp when the organization membership was created.').optional(),
    updatedAt: z.string().describe('The timestamp when the organization membership was last updated.').optional(),
  }).describe('WorkOS organization membership object.'),
  raw: z.looseObject({}).describe('Raw WorkOS response payload.'),
}).describe('A WorkOS organization membership response.')

export const reactivateOrganizationMembershipInput = z.strictObject({
  id: z.string().min(1).describe('The unique ID of the organization membership.'),
}).describe('Input parameters for reactivating a WorkOS organization membership.')

export const reactivateOrganizationMembershipOutput = z.strictObject({
  organization_membership: z.looseObject({
    object: z.string().describe('Object type returned by WorkOS.').optional(),
    id: z.string().describe('The unique ID of the organization membership.').optional(),
    userId: z.string().describe('The ID of the WorkOS user.').optional(),
    organizationId: z.string().describe('The ID of the WorkOS organization.').optional(),
    organizationName: z.string().describe('The name of the WorkOS organization.').optional(),
    status: z.enum(['active', 'inactive', 'pending']).describe('A WorkOS organization membership status.').optional(),
    createdAt: z.string().describe('The timestamp when the organization membership was created.').optional(),
    updatedAt: z.string().describe('The timestamp when the organization membership was last updated.').optional(),
  }).describe('WorkOS organization membership object.'),
  raw: z.looseObject({}).describe('Raw WorkOS response payload.'),
}).describe('A WorkOS organization membership response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const workosActions = {
  list_users: {
    description: 'List WorkOS AuthKit users with optional cursor and identity filters.',
    effect: 'read',
    inputSchema: listUsersInput,
    outputSchema: z.toJSONSchema(listUsersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_user: {
    description: 'Get a WorkOS AuthKit user by ID.',
    effect: 'read',
    inputSchema: getUserInput,
    outputSchema: z.toJSONSchema(getUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_user: {
    description: 'Create a WorkOS AuthKit user in the current environment.',
    effect: 'write',
    inputSchema: createUserInput,
    outputSchema: z.toJSONSchema(createUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_user: {
    description: 'Update properties of an existing WorkOS AuthKit user.',
    effect: 'write',
    inputSchema: updateUserInput,
    outputSchema: z.toJSONSchema(updateUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_organizations: {
    description: 'List WorkOS organizations with optional cursor, domain, and text filters.',
    effect: 'read',
    inputSchema: listOrganizationsInput,
    outputSchema: z.toJSONSchema(listOrganizationsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_organization: {
    description: 'Get a WorkOS organization by ID.',
    effect: 'read',
    inputSchema: getOrganizationInput,
    outputSchema: z.toJSONSchema(getOrganizationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_organization: {
    description: 'Create a WorkOS organization in the current environment.',
    effect: 'write',
    inputSchema: createOrganizationInput,
    outputSchema: z.toJSONSchema(createOrganizationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_organization: {
    description: 'Update properties of an existing WorkOS organization.',
    effect: 'write',
    inputSchema: updateOrganizationInput,
    outputSchema: z.toJSONSchema(updateOrganizationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_organization_memberships: {
    description: 'List WorkOS organization memberships filtered by user, organization, or membership status.',
    effect: 'read',
    inputSchema: listOrganizationMembershipsInput,
    outputSchema: z.toJSONSchema(listOrganizationMembershipsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_organization_membership: {
    description: 'Get a WorkOS organization membership by ID.',
    effect: 'read',
    inputSchema: getOrganizationMembershipInput,
    outputSchema: z.toJSONSchema(getOrganizationMembershipOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_organization_membership: {
    description: 'Create an active WorkOS organization membership for a user and organization.',
    effect: 'write',
    inputSchema: createOrganizationMembershipInput,
    outputSchema: z.toJSONSchema(createOrganizationMembershipOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_organization_membership: {
    description: 'Update roles on an existing WorkOS organization membership.',
    effect: 'write',
    inputSchema: updateOrganizationMembershipInput,
    outputSchema: z.toJSONSchema(updateOrganizationMembershipOutput, { io: 'output', unrepresentable: 'any' }),
  },
  deactivate_organization_membership: {
    description: 'Deactivate an active WorkOS organization membership.',
    effect: 'write',
    inputSchema: deactivateOrganizationMembershipInput,
    outputSchema: z.toJSONSchema(deactivateOrganizationMembershipOutput, { io: 'output', unrepresentable: 'any' }),
  },
  reactivate_organization_membership: {
    description: 'Reactivate an inactive WorkOS organization membership.',
    effect: 'write',
    inputSchema: reactivateOrganizationMembershipInput,
    outputSchema: z.toJSONSchema(reactivateOrganizationMembershipOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
