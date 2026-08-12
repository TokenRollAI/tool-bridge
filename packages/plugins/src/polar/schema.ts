/**
 * Polar 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listOrganizationsInput = z.strictObject({
  slug: z.string().min(1).describe('Filter organizations by slug.').optional(),
  page: z.int().min(1).describe('Page number, starting from 1.').optional(),
  limit: z.int().min(1).max(100).describe('Number of items to return per page. Polar supports up to 100.').optional(),
  sorting: z.array(z.enum(['created_at', '-created_at', 'slug', '-slug', 'name', '-name', 'next_review_threshold', '-next_review_threshold', 'days_in_status', '-days_in_status']).describe('A Polar organization sorting field.')).min(1).describe('Polar organization sorting fields.').optional(),
}).describe('Input parameters for listing Polar organizations.')

export const listOrganizationsOutput = z.strictObject({
  items: z.array(z.looseObject({}).describe('organizations')).describe('Polar organizations returned for the requested page.').optional(),
  pagination: z.strictObject({
    total_count: z.int().min(0).describe('Total number of items matching the request.').optional(),
    max_page: z.int().min(0).describe('Maximum page number available for this request.').optional(),
  }).describe('Polar pagination metadata.').optional(),
}).describe('A page of Polar organizations.')

export const getOrganizationInput = z.strictObject({
  id: z.uuid().describe('The Polar resource ID.').optional(),
}).describe('Input parameters for retrieving a Polar organization.')

export const getOrganizationOutput = z.strictObject({
  payload: z.looseObject({}).describe('The raw Polar resource payload.').optional(),
}).describe('A Polar organization response.')

export const listProductsInput = z.strictObject({
  id: z.union([z.uuid().describe('A Polar product ID.'), z.array(z.uuid().describe('A Polar UUID value.')).min(1).describe('Polar product IDs.')]).describe('Filter by product ID.').optional(),
  organization_id: z.union([z.uuid().describe('A Polar organization ID.'), z.array(z.uuid().describe('A Polar UUID value.')).min(1).describe('Polar organization IDs.')]).describe('Filter by organization ID.').optional(),
  query: z.string().min(1).describe('Filter by product name.').optional(),
  is_archived: z.boolean().describe('Filter by archived products.').optional(),
  is_recurring: z.boolean().describe('Filter by recurring products.').optional(),
  benefit_id: z.union([z.uuid().describe('A Polar benefit ID.'), z.array(z.uuid().describe('A Polar UUID value.')).min(1).describe('Polar benefit IDs.')]).describe('Filter products granting a benefit.').optional(),
  visibility: z.array(z.enum(['draft', 'private', 'public']).describe('Polar product visibility.')).min(1).describe('Product visibility values to include.').optional(),
  page: z.int().min(1).describe('Page number, starting from 1.').optional(),
  limit: z.int().min(1).max(100).describe('Number of items to return per page. Polar supports up to 100.').optional(),
  sorting: z.array(z.enum(['created_at', '-created_at', 'name', '-name', 'price_amount_type', '-price_amount_type', 'price_amount', '-price_amount']).describe('A Polar product sorting field.')).min(1).describe('Polar product sorting fields.').optional(),
  metadata: z.record(z.string(), z.union([z.string().describe('A string metadata value.'), z.int().describe('An integer metadata value.'), z.boolean().describe('A boolean metadata value.'), z.array(z.string().describe('A string metadata value.')).min(1).describe('String metadata values.'), z.array(z.int().describe('An integer metadata value.')).min(1).describe('Integer metadata values.'), z.array(z.boolean().describe('A boolean metadata value.')).min(1).describe('Boolean metadata values.')]).describe('A Polar metadata filter value.')).describe('Metadata filters sent with Polar\'s deepObject query style.').optional(),
}).describe('Input parameters for listing Polar products.')

export const listProductsOutput = z.strictObject({
  items: z.array(z.looseObject({}).describe('products')).describe('Polar products returned for the requested page.').optional(),
  pagination: z.strictObject({
    total_count: z.int().min(0).describe('Total number of items matching the request.').optional(),
    max_page: z.int().min(0).describe('Maximum page number available for this request.').optional(),
  }).describe('Polar pagination metadata.').optional(),
}).describe('A page of Polar products.')

export const getProductInput = z.strictObject({
  id: z.uuid().describe('The Polar resource ID.').optional(),
}).describe('Input parameters for retrieving a Polar product.')

export const getProductOutput = z.strictObject({
  payload: z.looseObject({}).describe('The raw Polar resource payload.').optional(),
}).describe('A Polar product response.')

export const listCustomersInput = z.strictObject({
  organization_id: z.union([z.uuid().describe('A Polar organization ID.'), z.array(z.uuid().describe('A Polar UUID value.')).min(1).describe('Polar organization IDs.')]).describe('Filter by organization ID.').optional(),
  email: z.email().describe('Filter by exact customer email.').optional(),
  query: z.string().min(1).describe('Filter by customer name, email, or external ID.').optional(),
  active: z.boolean().describe('Filter by active customers.').optional(),
  page: z.int().min(1).describe('Page number, starting from 1.').optional(),
  limit: z.int().min(1).max(100).describe('Number of items to return per page. Polar supports up to 100.').optional(),
  sorting: z.array(z.enum(['created_at', '-created_at', 'email', '-email', 'name', '-name']).describe('A Polar customer sorting field.')).min(1).describe('Polar customer sorting fields.').optional(),
  metadata: z.record(z.string(), z.union([z.string().describe('A string metadata value.'), z.int().describe('An integer metadata value.'), z.boolean().describe('A boolean metadata value.'), z.array(z.string().describe('A string metadata value.')).min(1).describe('String metadata values.'), z.array(z.int().describe('An integer metadata value.')).min(1).describe('Integer metadata values.'), z.array(z.boolean().describe('A boolean metadata value.')).min(1).describe('Boolean metadata values.')]).describe('A Polar metadata filter value.')).describe('Metadata filters sent with Polar\'s deepObject query style.').optional(),
}).describe('Input parameters for listing Polar customers.')

export const listCustomersOutput = z.strictObject({
  items: z.array(z.looseObject({}).describe('customers')).describe('Polar customers returned for the requested page.').optional(),
  pagination: z.strictObject({
    total_count: z.int().min(0).describe('Total number of items matching the request.').optional(),
    max_page: z.int().min(0).describe('Maximum page number available for this request.').optional(),
  }).describe('Polar pagination metadata.').optional(),
}).describe('A page of Polar customers.')

export const getCustomerInput = z.strictObject({
  id: z.uuid().describe('The Polar resource ID.').optional(),
}).describe('Input parameters for retrieving a Polar customer.')

export const getCustomerOutput = z.strictObject({
  payload: z.looseObject({}).describe('The raw Polar resource payload.').optional(),
}).describe('A Polar customer response.')

export const getCustomerByExternalIdInput = z.strictObject({
  external_id: z.string().min(1).describe('The Polar customer external ID.').optional(),
}).describe('Input parameters for retrieving a Polar customer by external ID.')

export const getCustomerByExternalIdOutput = z.strictObject({
  payload: z.looseObject({}).describe('The raw Polar resource payload.').optional(),
}).describe('A Polar customer response.')

export const getCustomerStateInput = z.strictObject({
  id: z.uuid().describe('The Polar resource ID.').optional(),
}).describe('Input parameters for retrieving a Polar customer state.')

export const getCustomerStateOutput = z.strictObject({
  payload: z.looseObject({}).describe('The raw Polar resource payload.').optional(),
}).describe('A Polar customer state response.')

export const getCustomerStateByExternalIdInput = z.strictObject({
  external_id: z.string().min(1).describe('The Polar customer external ID.').optional(),
}).describe('Input parameters for retrieving a Polar customer state by external ID.')

export const getCustomerStateByExternalIdOutput = z.strictObject({
  payload: z.looseObject({}).describe('The raw Polar resource payload.').optional(),
}).describe('A Polar customer state response.')

export const listOrdersInput = z.strictObject({
  organization_id: z.union([z.uuid().describe('A Polar organization ID.'), z.array(z.uuid().describe('A Polar UUID value.')).min(1).describe('Polar organization IDs.')]).describe('Filter by organization ID.').optional(),
  product_id: z.union([z.uuid().describe('A Polar product ID.'), z.array(z.uuid().describe('A Polar UUID value.')).min(1).describe('Polar product IDs.')]).describe('Filter by product ID.').optional(),
  product_billing_type: z.union([z.enum(['one_time', 'recurring']).describe('Polar product billing type.'), z.array(z.enum(['one_time', 'recurring']).describe('Polar product billing type.')).min(1).describe('Product billing types to include.')]).describe('Filter by product billing type.').optional(),
  discount_id: z.union([z.uuid().describe('A Polar discount ID.'), z.array(z.uuid().describe('A Polar UUID value.')).min(1).describe('Polar discount IDs.')]).describe('Filter by discount ID.').optional(),
  customer_id: z.union([z.uuid().describe('A Polar customer ID.'), z.array(z.uuid().describe('A Polar UUID value.')).min(1).describe('Polar customer IDs.')]).describe('Filter by customer ID.').optional(),
  external_customer_id: z.union([z.string().min(1).describe('A Polar customer external ID.'), z.array(z.string().min(1).describe('A string filter value.')).min(1).describe('Polar customer external IDs.')]).describe('Filter by customer external ID.').optional(),
  checkout_id: z.union([z.uuid().describe('A Polar checkout ID.'), z.array(z.uuid().describe('A Polar UUID value.')).min(1).describe('Polar checkout IDs.')]).describe('Filter by checkout ID.').optional(),
  subscription_id: z.union([z.uuid().describe('A Polar subscription ID.'), z.array(z.uuid().describe('A Polar UUID value.')).min(1).describe('Polar subscription IDs.')]).describe('Filter by subscription ID.').optional(),
  page: z.int().min(1).describe('Page number, starting from 1.').optional(),
  limit: z.int().min(1).max(100).describe('Number of items to return per page. Polar supports up to 100.').optional(),
  sorting: z.array(z.enum(['created_at', '-created_at', 'status', '-status', 'invoice_number', '-invoice_number', 'amount', '-amount', 'net_amount', '-net_amount', 'customer', '-customer', 'product', '-product', 'discount', '-discount', 'subscription', '-subscription']).describe('A Polar order sorting field.')).min(1).describe('Polar order sorting fields.').optional(),
  metadata: z.record(z.string(), z.union([z.string().describe('A string metadata value.'), z.int().describe('An integer metadata value.'), z.boolean().describe('A boolean metadata value.'), z.array(z.string().describe('A string metadata value.')).min(1).describe('String metadata values.'), z.array(z.int().describe('An integer metadata value.')).min(1).describe('Integer metadata values.'), z.array(z.boolean().describe('A boolean metadata value.')).min(1).describe('Boolean metadata values.')]).describe('A Polar metadata filter value.')).describe('Metadata filters sent with Polar\'s deepObject query style.').optional(),
}).describe('Input parameters for listing Polar orders.')

export const listOrdersOutput = z.strictObject({
  items: z.array(z.looseObject({}).describe('orders')).describe('Polar orders returned for the requested page.').optional(),
  pagination: z.strictObject({
    total_count: z.int().min(0).describe('Total number of items matching the request.').optional(),
    max_page: z.int().min(0).describe('Maximum page number available for this request.').optional(),
  }).describe('Polar pagination metadata.').optional(),
}).describe('A page of Polar orders.')

export const getOrderInput = z.strictObject({
  id: z.uuid().describe('The Polar resource ID.').optional(),
}).describe('Input parameters for retrieving a Polar order.')

export const getOrderOutput = z.strictObject({
  payload: z.looseObject({}).describe('The raw Polar resource payload.').optional(),
}).describe('A Polar order response.')

export const listSubscriptionsInput = z.strictObject({
  organization_id: z.union([z.uuid().describe('A Polar organization ID.'), z.array(z.uuid().describe('A Polar UUID value.')).min(1).describe('Polar organization IDs.')]).describe('Filter by organization ID.').optional(),
  product_id: z.union([z.uuid().describe('A Polar product ID.'), z.array(z.uuid().describe('A Polar UUID value.')).min(1).describe('Polar product IDs.')]).describe('Filter by product ID.').optional(),
  customer_id: z.union([z.uuid().describe('A Polar customer ID.'), z.array(z.uuid().describe('A Polar UUID value.')).min(1).describe('Polar customer IDs.')]).describe('Filter by customer ID.').optional(),
  external_customer_id: z.union([z.string().min(1).describe('A Polar customer external ID.'), z.array(z.string().min(1).describe('A string filter value.')).min(1).describe('Polar customer external IDs.')]).describe('Filter by customer external ID.').optional(),
  discount_id: z.union([z.uuid().describe('A Polar discount ID.'), z.array(z.uuid().describe('A Polar UUID value.')).min(1).describe('Polar discount IDs.')]).describe('Filter by discount ID.').optional(),
  active: z.boolean().describe('Filter by active or inactive subscription. This Polar filter is deprecated upstream.').optional(),
  status: z.union([z.enum(['incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid']).describe('Polar subscription status.'), z.array(z.enum(['incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid']).describe('Polar subscription status.')).min(1).describe('Subscription statuses to include.')]).describe('Filter by subscription status.').optional(),
  cancel_at_period_end: z.boolean().describe('Filter by subscriptions set to cancel at period end.').optional(),
  customer_cancellation_reason: z.union([z.enum(['customer_service', 'low_quality', 'missing_features', 'switched_service', 'too_complex', 'too_expensive', 'unused', 'other']).describe('Polar customer cancellation reason.'), z.array(z.enum(['customer_service', 'low_quality', 'missing_features', 'switched_service', 'too_complex', 'too_expensive', 'unused', 'other']).describe('Polar customer cancellation reason.')).min(1).describe('Customer cancellation reasons to include.')]).describe('Filter by customer cancellation reason.').optional(),
  canceled_at_after: z.iso.datetime({ offset: true }).describe('Filter by cancellation timestamp after or equal to this value.').optional(),
  canceled_at_before: z.iso.datetime({ offset: true }).describe('Filter by cancellation timestamp before or equal to this value.').optional(),
  page: z.int().min(1).describe('Page number, starting from 1.').optional(),
  limit: z.int().min(1).max(100).describe('Number of items to return per page. Polar supports up to 100.').optional(),
  sorting: z.array(z.enum(['customer', '-customer', 'status', '-status', 'started_at', '-started_at', 'current_period_end', '-current_period_end', 'ended_at', '-ended_at', 'ends_at', '-ends_at', 'amount', '-amount', 'product', '-product', 'discount', '-discount']).describe('A Polar subscription sorting field.')).min(1).describe('Polar subscription sorting fields.').optional(),
  metadata: z.record(z.string(), z.union([z.string().describe('A string metadata value.'), z.int().describe('An integer metadata value.'), z.boolean().describe('A boolean metadata value.'), z.array(z.string().describe('A string metadata value.')).min(1).describe('String metadata values.'), z.array(z.int().describe('An integer metadata value.')).min(1).describe('Integer metadata values.'), z.array(z.boolean().describe('A boolean metadata value.')).min(1).describe('Boolean metadata values.')]).describe('A Polar metadata filter value.')).describe('Metadata filters sent with Polar\'s deepObject query style.').optional(),
}).describe('Input parameters for listing Polar subscriptions.')

export const listSubscriptionsOutput = z.strictObject({
  items: z.array(z.looseObject({}).describe('subscriptions')).describe('Polar subscriptions returned for the requested page.').optional(),
  pagination: z.strictObject({
    total_count: z.int().min(0).describe('Total number of items matching the request.').optional(),
    max_page: z.int().min(0).describe('Maximum page number available for this request.').optional(),
  }).describe('Polar pagination metadata.').optional(),
}).describe('A page of Polar subscriptions.')

export const getSubscriptionInput = z.strictObject({
  id: z.uuid().describe('The Polar resource ID.').optional(),
}).describe('Input parameters for retrieving a Polar subscription.')

export const getSubscriptionOutput = z.strictObject({
  payload: z.looseObject({}).describe('The raw Polar resource payload.').optional(),
}).describe('A Polar subscription response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const polarActions = {
  list_organizations: {
    description: 'List Polar organizations accessible to the Organization Access Token.',
    effect: 'read',
    inputSchema: listOrganizationsInput,
    outputSchema: z.toJSONSchema(listOrganizationsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_organization: {
    description: 'Get a Polar organization by ID.',
    effect: 'read',
    inputSchema: getOrganizationInput,
    outputSchema: z.toJSONSchema(getOrganizationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_products: {
    description: 'List Polar products with optional organization, name, visibility, and metadata filters.',
    effect: 'read',
    inputSchema: listProductsInput,
    outputSchema: z.toJSONSchema(listProductsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_product: {
    description: 'Get a Polar product by ID.',
    effect: 'read',
    inputSchema: getProductInput,
    outputSchema: z.toJSONSchema(getProductOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_customers: {
    description: 'List Polar customers with optional organization, email, search, activity, and metadata filters.',
    effect: 'read',
    inputSchema: listCustomersInput,
    outputSchema: z.toJSONSchema(listCustomersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_customer: {
    description: 'Get a Polar customer by ID.',
    effect: 'read',
    inputSchema: getCustomerInput,
    outputSchema: z.toJSONSchema(getCustomerOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_customer_by_external_id: {
    description: 'Get a Polar customer by external ID.',
    effect: 'read',
    inputSchema: getCustomerByExternalIdInput,
    outputSchema: z.toJSONSchema(getCustomerByExternalIdOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_customer_state: {
    description: 'Get a Polar customer state by customer ID, including subscriptions and benefits.',
    effect: 'read',
    inputSchema: getCustomerStateInput,
    outputSchema: z.toJSONSchema(getCustomerStateOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_customer_state_by_external_id: {
    description: 'Get a Polar customer state by external customer ID, including subscriptions and benefits.',
    effect: 'read',
    inputSchema: getCustomerStateByExternalIdInput,
    outputSchema: z.toJSONSchema(getCustomerStateByExternalIdOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_orders: {
    description: 'List Polar orders with optional organization, product, customer, checkout, subscription, and metadata filters.',
    effect: 'read',
    inputSchema: listOrdersInput,
    outputSchema: z.toJSONSchema(listOrdersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_order: {
    description: 'Get a Polar order by ID.',
    effect: 'read',
    inputSchema: getOrderInput,
    outputSchema: z.toJSONSchema(getOrderOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_subscriptions: {
    description: 'List Polar subscriptions with optional organization, product, customer, status, cancellation, and metadata filters.',
    effect: 'read',
    inputSchema: listSubscriptionsInput,
    outputSchema: z.toJSONSchema(listSubscriptionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_subscription: {
    description: 'Get a Polar subscription by ID.',
    effect: 'read',
    inputSchema: getSubscriptionInput,
    outputSchema: z.toJSONSchema(getSubscriptionOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
