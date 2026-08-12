/**
 * Whop 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listCompaniesInput = z.strictObject({
  after: z.string().min(1).describe('Cursor for returning resources after this position.').optional(),
  before: z.string().min(1).describe('Cursor for returning resources before this position.').optional(),
  first: z.int().min(1).describe('Number of resources to return from the start of the list.').optional(),
  last: z.int().min(1).describe('Number of resources to return from the end of the list.').optional(),
  parent_company_id: z.string().min(1).describe('Parent platform company ID for listing connected accounts.').optional(),
  direction: z.enum(['asc', 'desc']).describe('Sort direction for returned Whop resources.').optional(),
  created_before: z.iso.datetime({ offset: true }).describe('Only return companies created before this timestamp.').optional(),
  created_after: z.iso.datetime({ offset: true }).describe('Only return companies created after this timestamp.').optional(),
}).describe('Query parameters for listing Whop companies.')

export const listCompaniesOutput = z.strictObject({
  data: z.array(z.looseObject({
    id: z.string().min(1).describe('The unique Whop company identifier.').optional(),
    title: z.string().min(1).describe('The company display name.').optional(),
    description: z.string().describe('The company promotional description.').nullable().optional(),
    verified: z.boolean().describe('Whether Whop has verified this company.').optional(),
    created_at: z.iso.datetime({ offset: true }).describe('The datetime when this company was created.').optional(),
    updated_at: z.iso.datetime({ offset: true }).describe('The datetime when this company was last updated.').optional(),
    member_count: z.int().describe('The number of active members across this company\'s products.').optional(),
    owner_user: z.looseObject({
      id: z.string().min(1).describe('The unique Whop user identifier.').optional(),
      name: z.string().describe('The user\'s display name.').nullable().optional(),
      username: z.string().min(1).describe('The user\'s public username.').optional(),
    }).describe('Whop owner user summary.').optional(),
    route: z.string().min(1).describe('The company store route slug.').optional(),
    metadata: z.looseObject({}).describe('Custom metadata stored on this company.').nullable().optional(),
  }).describe('Whop company resource.')).describe('Companies returned by Whop.').optional(),
  page_info: z.strictObject({
    end_cursor: z.string().describe('Cursor for the next page when paginating forward.').nullable().optional(),
    start_cursor: z.string().describe('Cursor for the previous page when paginating backward.').nullable().optional(),
    has_next_page: z.boolean().describe('Whether more resources are available after this page.').optional(),
    has_previous_page: z.boolean().describe('Whether more resources are available before this page.').optional(),
  }).describe('Whop cursor pagination metadata.').optional(),
}).describe('Paginated Whop company list response.')

export const getCompanyInput = z.strictObject({
  id: z.string().min(1).describe('The unique Whop company identifier or route slug.').optional(),
}).describe('Path parameters for retrieving a Whop company.')

export const getCompanyOutput = z.looseObject({
  id: z.string().min(1).describe('The unique Whop company identifier.').optional(),
  title: z.string().min(1).describe('The company display name.').optional(),
  description: z.string().describe('The company promotional description.').nullable().optional(),
  verified: z.boolean().describe('Whether Whop has verified this company.').optional(),
  created_at: z.iso.datetime({ offset: true }).describe('The datetime when this company was created.').optional(),
  updated_at: z.iso.datetime({ offset: true }).describe('The datetime when this company was last updated.').optional(),
  member_count: z.int().describe('The number of active members across this company\'s products.').optional(),
  owner_user: z.looseObject({
    id: z.string().min(1).describe('The unique Whop user identifier.').optional(),
    name: z.string().describe('The user\'s display name.').nullable().optional(),
    username: z.string().min(1).describe('The user\'s public username.').optional(),
  }).describe('Whop owner user summary.').optional(),
  route: z.string().min(1).describe('The company store route slug.').optional(),
  metadata: z.looseObject({}).describe('Custom metadata stored on this company.').nullable().optional(),
}).describe('Whop company resource.')

export const listProductsInput = z.strictObject({
  company_id: z.string().min(1).describe('The unique Whop company identifier.'),
  visibilities: z.array(z.string().min(1).describe('One product visibility state.')).min(1).describe('Product visibility states to include.').optional(),
  access_pass_types: z.array(z.string().min(1).describe('One product access pass type.')).min(1).describe('Product access pass types to include.').optional(),
  direction: z.enum(['asc', 'desc']).describe('Sort direction for returned Whop resources.').optional(),
  order: z.string().min(1).describe('Product field to sort by. Defaults to created_at.').optional(),
  first: z.int().min(1).max(100).describe('Number of products to return. Default and max is 100.').optional(),
  after: z.string().min(1).describe('Cursor for returning products after this position.').optional(),
  last: z.int().min(1).describe('Number of products to return from the end of the range.').optional(),
  before: z.string().min(1).describe('Cursor for returning products before this position.').optional(),
}).describe('Query parameters for listing Whop products.')

export const listProductsOutput = z.strictObject({
  data: z.array(z.looseObject({
    id: z.string().min(1).describe('The unique Whop product identifier.').optional(),
    created_at: z.iso.datetime({ offset: true }).describe('The datetime when this product was created.').optional(),
    updated_at: z.iso.datetime({ offset: true }).describe('The datetime when this product was last updated.').optional(),
    title: z.string().describe('The product display name.').nullable().optional(),
    visibility: z.string().describe('The product visibility state.').nullable().optional(),
    headline: z.string().describe('The product marketing headline.').nullable().optional(),
    verified: z.boolean().describe('Whether Whop has verified this product.').optional(),
    member_count: z.number().describe('The active membership count for this product.').optional(),
    route: z.string().describe('The product public route slug.').nullable().optional(),
    published_reviews_count: z.number().describe('The number of published reviews for this product.').optional(),
    external_identifier: z.string().describe('External identifier stored on this product.').nullable().optional(),
    metadata: z.looseObject({}).describe('Custom metadata stored on this product.').nullable().optional(),
  }).describe('Whop product resource.')).describe('Products returned by Whop.').optional(),
  page_info: z.strictObject({
    end_cursor: z.string().describe('Cursor for the next page when paginating forward.').nullable().optional(),
    start_cursor: z.string().describe('Cursor for the previous page when paginating backward.').nullable().optional(),
    has_next_page: z.boolean().describe('Whether more resources are available after this page.').optional(),
    has_previous_page: z.boolean().describe('Whether more resources are available before this page.').optional(),
  }).describe('Whop cursor pagination metadata.').optional(),
}).describe('Paginated Whop product list response.')

export const getProductInput = z.strictObject({
  id: z.string().min(1).describe('The unique Whop product identifier.').optional(),
}).describe('Path parameters for retrieving a Whop product.')

export const getProductOutput = z.looseObject({
  id: z.string().min(1).describe('The unique Whop product identifier.').optional(),
  created_at: z.iso.datetime({ offset: true }).describe('The datetime when this product was created.').optional(),
  updated_at: z.iso.datetime({ offset: true }).describe('The datetime when this product was last updated.').optional(),
  title: z.string().describe('The product display name.').nullable().optional(),
  visibility: z.string().describe('The product visibility state.').nullable().optional(),
  headline: z.string().describe('The product marketing headline.').nullable().optional(),
  verified: z.boolean().describe('Whether Whop has verified this product.').optional(),
  member_count: z.number().describe('The active membership count for this product.').optional(),
  route: z.string().describe('The product public route slug.').nullable().optional(),
  published_reviews_count: z.number().describe('The number of published reviews for this product.').optional(),
  external_identifier: z.string().describe('External identifier stored on this product.').nullable().optional(),
  metadata: z.looseObject({}).describe('Custom metadata stored on this product.').nullable().optional(),
}).describe('Whop product resource.')

export const listMembershipsInput = z.strictObject({
  after: z.string().min(1).describe('Cursor for returning resources after this position.').optional(),
  before: z.string().min(1).describe('Cursor for returning resources before this position.').optional(),
  first: z.int().min(1).describe('Number of resources to return from the start of the list.').optional(),
  last: z.int().min(1).describe('Number of resources to return from the end of the list.').optional(),
  company_id: z.string().min(1).describe('The Whop company identifier. Required when using an API key.'),
  direction: z.enum(['asc', 'desc']).describe('Sort direction for returned Whop resources.').optional(),
  order: z.enum(['id', 'created_at', 'status', 'canceled_at', 'date_joined', 'total_spend']).describe('Sortable Whop membership column.').optional(),
  product_ids: z.array(z.string().min(1).describe('One Whop product identifier.')).min(1).describe('Product identifiers to filter memberships by.').optional(),
  statuses: z.array(z.enum(['trialing', 'active', 'past_due', 'completed', 'canceled', 'expired', 'unresolved', 'drafted', 'canceling']).describe('Whop membership lifecycle status.')).min(1).describe('Membership statuses to include.').optional(),
  cancel_options: z.array(z.enum(['too_expensive', 'switching', 'missing_features', 'technical_issues', 'bad_experience', 'other', 'testing']).describe('Whop membership cancellation reason.')).min(1).describe('Cancellation reasons to filter memberships by.').optional(),
  plan_ids: z.array(z.string().min(1).describe('One Whop plan identifier.')).min(1).describe('Plan identifiers to filter memberships by.').optional(),
  user_ids: z.array(z.string().min(1).describe('One Whop user identifier.')).min(1).describe('User identifiers to filter memberships by.').optional(),
  promo_code_ids: z.array(z.string().min(1).describe('One Whop promo code identifier.')).min(1).describe('Promo code identifiers to filter memberships by.').optional(),
  created_before: z.iso.datetime({ offset: true }).describe('Only return memberships created before this timestamp.').optional(),
  created_after: z.iso.datetime({ offset: true }).describe('Only return memberships created after this timestamp.').optional(),
}).describe('Query parameters for listing Whop memberships.')

export const listMembershipsOutput = z.strictObject({
  data: z.array(z.looseObject({
    id: z.string().min(1).describe('The unique Whop membership identifier.').optional(),
    status: z.enum(['trialing', 'active', 'past_due', 'completed', 'canceled', 'expired', 'unresolved', 'drafted', 'canceling']).describe('Whop membership lifecycle status.').optional(),
    created_at: z.iso.datetime({ offset: true }).describe('The datetime when this membership was created.').optional(),
    joined_at: z.iso.datetime({ offset: true }).describe('The datetime when the user joined the company.').nullable().optional(),
    updated_at: z.iso.datetime({ offset: true }).describe('The datetime when this membership was last updated.').optional(),
    manage_url: z.string().describe('URL where the customer can manage this membership.').nullable().optional(),
    member: z.looseObject({
      id: z.string().min(1).describe('The unique Whop resource identifier.').optional(),
    }).describe('Whop linked resource summary.').nullable().optional(),
    user: z.looseObject({
      id: z.string().min(1).describe('The unique Whop user identifier.').optional(),
      username: z.string().min(1).describe('The user\'s public username.').optional(),
      name: z.string().describe('The user\'s display name.').nullable().optional(),
      email: z.string().describe('The user\'s email address when the credential has email access.').nullable().optional(),
    }).describe('Whop user summary.').nullable().optional(),
    cancel_at_period_end: z.boolean().describe('Whether this membership will cancel at period end.').optional(),
    cancel_option: z.enum(['too_expensive', 'switching', 'missing_features', 'technical_issues', 'bad_experience', 'other', 'testing']).describe('Whop membership cancellation reason.').nullable().optional(),
    cancellation_reason: z.string().describe('Free-text cancellation reason.').nullable().optional(),
    canceled_at: z.iso.datetime({ offset: true }).describe('The datetime when this membership was canceled.').nullable().optional(),
    currency: z.string().describe('The membership billing currency.').nullable().optional(),
    company: z.looseObject({
      id: z.string().min(1).describe('The unique Whop company identifier.').optional(),
      title: z.string().min(1).describe('The company display name.').optional(),
    }).describe('Company linked to this membership.').optional(),
    plan: z.looseObject({
      id: z.string().min(1).describe('The unique Whop plan identifier.').optional(),
      metadata: z.looseObject({}).describe('Custom metadata stored on the plan.').nullable().optional(),
    }).describe('Plan linked to this membership.').optional(),
    promo_code: z.looseObject({
      id: z.string().min(1).describe('The unique Whop resource identifier.').optional(),
    }).describe('Whop linked resource summary.').nullable().optional(),
    product: z.looseObject({
      id: z.string().min(1).describe('The unique Whop product identifier.').optional(),
      title: z.string().min(1).describe('The product display name.').optional(),
      metadata: z.looseObject({}).describe('Custom metadata stored on the product.').nullable().optional(),
    }).describe('Product linked to this membership.').optional(),
    license_key: z.string().describe('Software license key linked to this membership.').nullable().optional(),
    metadata: z.looseObject({}).describe('Custom metadata stored on this membership.').nullable().optional(),
    payment_collection_paused: z.boolean().describe('Whether recurring payment collection is paused for this membership.').optional(),
    checkout_configuration_id: z.string().describe('Checkout configuration identifier that produced this membership.').nullable().optional(),
  }).describe('Whop membership resource.')).describe('Memberships returned by Whop.').optional(),
  page_info: z.strictObject({
    end_cursor: z.string().describe('Cursor for the next page when paginating forward.').nullable().optional(),
    start_cursor: z.string().describe('Cursor for the previous page when paginating backward.').nullable().optional(),
    has_next_page: z.boolean().describe('Whether more resources are available after this page.').optional(),
    has_previous_page: z.boolean().describe('Whether more resources are available before this page.').optional(),
  }).describe('Whop cursor pagination metadata.').optional(),
}).describe('Paginated Whop membership list response.')

export const getMembershipInput = z.strictObject({
  id: z.string().min(1).describe('The unique Whop membership identifier or license key.').optional(),
}).describe('Path parameters for retrieving a Whop membership.')

export const getMembershipOutput = z.looseObject({
  id: z.string().min(1).describe('The unique Whop membership identifier.').optional(),
  status: z.enum(['trialing', 'active', 'past_due', 'completed', 'canceled', 'expired', 'unresolved', 'drafted', 'canceling']).describe('Whop membership lifecycle status.').optional(),
  created_at: z.iso.datetime({ offset: true }).describe('The datetime when this membership was created.').optional(),
  joined_at: z.iso.datetime({ offset: true }).describe('The datetime when the user joined the company.').nullable().optional(),
  updated_at: z.iso.datetime({ offset: true }).describe('The datetime when this membership was last updated.').optional(),
  manage_url: z.string().describe('URL where the customer can manage this membership.').nullable().optional(),
  member: z.looseObject({
    id: z.string().min(1).describe('The unique Whop resource identifier.').optional(),
  }).describe('Whop linked resource summary.').nullable().optional(),
  user: z.looseObject({
    id: z.string().min(1).describe('The unique Whop user identifier.').optional(),
    username: z.string().min(1).describe('The user\'s public username.').optional(),
    name: z.string().describe('The user\'s display name.').nullable().optional(),
    email: z.string().describe('The user\'s email address when the credential has email access.').nullable().optional(),
  }).describe('Whop user summary.').nullable().optional(),
  cancel_at_period_end: z.boolean().describe('Whether this membership will cancel at period end.').optional(),
  cancel_option: z.enum(['too_expensive', 'switching', 'missing_features', 'technical_issues', 'bad_experience', 'other', 'testing']).describe('Whop membership cancellation reason.').nullable().optional(),
  cancellation_reason: z.string().describe('Free-text cancellation reason.').nullable().optional(),
  canceled_at: z.iso.datetime({ offset: true }).describe('The datetime when this membership was canceled.').nullable().optional(),
  currency: z.string().describe('The membership billing currency.').nullable().optional(),
  company: z.looseObject({
    id: z.string().min(1).describe('The unique Whop company identifier.').optional(),
    title: z.string().min(1).describe('The company display name.').optional(),
  }).describe('Company linked to this membership.').optional(),
  plan: z.looseObject({
    id: z.string().min(1).describe('The unique Whop plan identifier.').optional(),
    metadata: z.looseObject({}).describe('Custom metadata stored on the plan.').nullable().optional(),
  }).describe('Plan linked to this membership.').optional(),
  promo_code: z.looseObject({
    id: z.string().min(1).describe('The unique Whop resource identifier.').optional(),
  }).describe('Whop linked resource summary.').nullable().optional(),
  product: z.looseObject({
    id: z.string().min(1).describe('The unique Whop product identifier.').optional(),
    title: z.string().min(1).describe('The product display name.').optional(),
    metadata: z.looseObject({}).describe('Custom metadata stored on the product.').nullable().optional(),
  }).describe('Product linked to this membership.').optional(),
  license_key: z.string().describe('Software license key linked to this membership.').nullable().optional(),
  metadata: z.looseObject({}).describe('Custom metadata stored on this membership.').nullable().optional(),
  payment_collection_paused: z.boolean().describe('Whether recurring payment collection is paused for this membership.').optional(),
  checkout_configuration_id: z.string().describe('Checkout configuration identifier that produced this membership.').nullable().optional(),
}).describe('Whop membership resource.')

export const listAuthorizedUsersInput = z.strictObject({
  after: z.string().min(1).describe('Cursor for returning resources after this position.').optional(),
  before: z.string().min(1).describe('Cursor for returning resources before this position.').optional(),
  first: z.int().min(1).describe('Number of resources to return from the start of the list.').optional(),
  last: z.int().min(1).describe('Number of resources to return from the end of the list.').optional(),
  company_id: z.string().min(1).describe('The unique Whop company identifier.').optional(),
  user_id: z.string().min(1).describe('The unique Whop user identifier.').optional(),
  role: z.enum(['owner', 'admin', 'sales_manager', 'moderator', 'advertiser', 'app_manager', 'support', 'manager', 'custom']).describe('Role assigned to a Whop authorized user.').optional(),
  created_before: z.iso.datetime({ offset: true }).describe('Only return authorized users created before this timestamp.').optional(),
  created_after: z.iso.datetime({ offset: true }).describe('Only return authorized users created after this timestamp.').optional(),
}).describe('Query parameters for listing Whop authorized users.')

export const listAuthorizedUsersOutput = z.strictObject({
  data: z.array(z.looseObject({
    id: z.string().min(1).describe('The unique Whop authorized user identifier.').optional(),
    role: z.enum(['owner', 'admin', 'sales_manager', 'moderator', 'advertiser', 'app_manager', 'support', 'manager', 'custom']).describe('Role assigned to a Whop authorized user.').optional(),
    user: z.looseObject({
      id: z.string().min(1).describe('The unique Whop user identifier.').optional(),
      username: z.string().min(1).describe('The user\'s public username.').optional(),
      name: z.string().describe('The user\'s display name.').nullable().optional(),
      email: z.string().describe('The user\'s email address when the credential has email access.').nullable().optional(),
    }).describe('Whop user summary.').optional(),
    company: z.looseObject({
      id: z.string().min(1).describe('The unique Whop company identifier.').optional(),
      title: z.string().min(1).describe('The company display name.').optional(),
    }).describe('Company this user can administer.').optional(),
  }).describe('Whop authorized user resource.')).describe('Authorized users returned by Whop.').optional(),
  page_info: z.strictObject({
    end_cursor: z.string().describe('Cursor for the next page when paginating forward.').nullable().optional(),
    start_cursor: z.string().describe('Cursor for the previous page when paginating backward.').nullable().optional(),
    has_next_page: z.boolean().describe('Whether more resources are available after this page.').optional(),
    has_previous_page: z.boolean().describe('Whether more resources are available before this page.').optional(),
  }).describe('Whop cursor pagination metadata.').optional(),
}).describe('Paginated Whop authorized user list response.')

export const getAuthorizedUserInput = z.strictObject({
  id: z.string().min(1).describe('The unique Whop authorized user identifier.').optional(),
}).describe('Path parameters for retrieving a Whop authorized user.')

export const getAuthorizedUserOutput = z.looseObject({
  id: z.string().min(1).describe('The unique Whop authorized user identifier.').optional(),
  role: z.enum(['owner', 'admin', 'sales_manager', 'moderator', 'advertiser', 'app_manager', 'support', 'manager', 'custom']).describe('Role assigned to a Whop authorized user.').optional(),
  user: z.looseObject({
    id: z.string().min(1).describe('The unique Whop user identifier.').optional(),
    username: z.string().min(1).describe('The user\'s public username.').optional(),
    name: z.string().describe('The user\'s display name.').nullable().optional(),
    email: z.string().describe('The user\'s email address when the credential has email access.').nullable().optional(),
  }).describe('Whop user summary.').optional(),
  company: z.looseObject({
    id: z.string().min(1).describe('The unique Whop company identifier.').optional(),
    title: z.string().min(1).describe('The company display name.').optional(),
  }).describe('Company this user can administer.').optional(),
}).describe('Whop authorized user resource.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const whopActions = {
  list_companies: {
    description: 'List Whop companies accessible to the credential, optionally filtering connected accounts by parent company.',
    effect: 'read',
    inputSchema: listCompaniesInput,
    outputSchema: z.toJSONSchema(listCompaniesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_company: {
    description: 'Retrieve a Whop company by ID or route slug.',
    effect: 'read',
    inputSchema: getCompanyInput,
    outputSchema: z.toJSONSchema(getCompanyOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_products: {
    description: 'List Whop products belonging to a company with optional visibility, type, sort, and cursor filters.',
    effect: 'read',
    inputSchema: listProductsInput,
    outputSchema: z.toJSONSchema(listProductsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_product: {
    description: 'Retrieve a Whop product by ID.',
    effect: 'read',
    inputSchema: getProductInput,
    outputSchema: z.toJSONSchema(getProductOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_memberships: {
    description: 'List Whop memberships for a company with optional product, plan, user, status, and cursor filters.',
    effect: 'read',
    inputSchema: listMembershipsInput,
    outputSchema: z.toJSONSchema(listMembershipsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_membership: {
    description: 'Retrieve a Whop membership by membership ID or license key.',
    effect: 'read',
    inputSchema: getMembershipInput,
    outputSchema: z.toJSONSchema(getMembershipOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_authorized_users: {
    description: 'List authorized Whop team members with optional company, user, role, date, and cursor filters.',
    effect: 'read',
    inputSchema: listAuthorizedUsersInput,
    outputSchema: z.toJSONSchema(listAuthorizedUsersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_authorized_user: {
    description: 'Retrieve a Whop authorized user by ID.',
    effect: 'read',
    inputSchema: getAuthorizedUserInput,
    outputSchema: z.toJSONSchema(getAuthorizedUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
