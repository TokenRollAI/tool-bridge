/**
 * Appstle Subscriptions 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listCustomersWithSubscriptionsInput = z.strictObject({
  name: z.string().min(1).describe('Filter customers by name. Partial matches are supported.').optional(),
  email: z.email().describe('Filter customers by exact email address.').optional(),
  activeMoreThanOneSubscription: z.boolean().describe('Whether to return only customers with more than one active subscription.').optional(),
  page: z.int().min(0).describe('Zero-based page number to request from Appstle.').optional(),
  size: z.int().min(1).describe('Page size for the customer list.').optional(),
  sort: z.array(z.string().min(1).describe('One sort directive accepted by Appstle.')).describe('Spring pageable sort directives such as id,desc.').optional(),
}).describe('Filters and pagination for listing customers with subscriptions.')

export const listCustomersWithSubscriptionsOutput = z.strictObject({
  customers: z.array(z.looseObject({
    customerId: z.int().describe('Numeric Shopify customer ID.').optional(),
    name: z.string().describe('Customer name returned by Appstle.').optional(),
    email: z.string().describe('Customer email address returned by Appstle.').optional(),
    activeSubscriptions: z.int().describe('Number of active subscriptions for the customer.').optional(),
    inActiveSubscriptions: z.int().describe('Number of inactive subscriptions for the customer.').optional(),
    lifetimeValue: z.number().describe('Customer lifetime value returned by Appstle.').optional(),
    nextOrderDate: z.iso.datetime({ offset: true }).describe('Next subscription order timestamp, when present.').optional(),
  }).describe('Appstle customer subscription summary.')).describe('Customers returned by Appstle.').optional(),
}).describe('Customers with subscription summaries.')

export const getCustomerWithSubscriptionsInput = z.strictObject({
  customerId: z.int().min(1).describe('Numeric Shopify customer ID, without a gid:// prefix.'),
  cursor: z.string().min(1).describe('Pagination cursor returned by Appstle for subscription contracts.').optional(),
}).describe('Customer lookup parameters.')

export const getCustomerWithSubscriptionsOutput = z.strictObject({
  customer: z.looseObject({}).describe('Appstle customer detail object.').nullable().optional(),
}).describe('Customer details with subscription contracts.')

export const getValidSubscriptionContractIdsInput = z.strictObject({
  customerId: z.int().min(1).describe('Numeric Shopify customer ID, without a gid:// prefix.'),
}).describe('Customer identifier for valid subscription contract ID lookup.')

export const getValidSubscriptionContractIdsOutput = z.strictObject({
  contractIds: z.array(z.int().describe('Numeric Shopify subscription contract ID.')).describe('Numeric Shopify subscription contract IDs returned by Appstle.').optional(),
}).describe('Valid subscription contract IDs for the customer.')

export const listCustomerSubscriptionDetailsInput = z.strictObject({
  customerId: z.int().min(1).describe('Numeric Shopify customer ID, without a gid:// prefix.'),
}).describe('Customer identifier for detailed subscription lookup.')

export const listCustomerSubscriptionDetailsOutput = z.strictObject({
  subscriptions: z.array(z.looseObject({}).describe('Appstle subscription detail object.')).describe('Detailed Appstle subscription contract objects.').optional(),
}).describe('Detailed subscription contracts for the customer.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const appstleSubscriptionsActions = {
  list_customers_with_subscriptions: {
    description: 'List customers who have Appstle subscription contracts with optional filters and pagination.',
    effect: 'read',
    inputSchema: listCustomersWithSubscriptionsInput,
    outputSchema: z.toJSONSchema(listCustomersWithSubscriptionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_customer_with_subscriptions: {
    description: 'Retrieve Appstle customer details including subscription contract information.',
    effect: 'read',
    inputSchema: getCustomerWithSubscriptionsInput,
    outputSchema: z.toJSONSchema(getCustomerWithSubscriptionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_valid_subscription_contract_ids: {
    description: 'Return valid Appstle subscription contract IDs for a Shopify customer.',
    effect: 'read',
    inputSchema: getValidSubscriptionContractIdsInput,
    outputSchema: z.toJSONSchema(getValidSubscriptionContractIdsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_customer_subscription_details: {
    description: 'List detailed Appstle subscription contract records for a Shopify customer.',
    effect: 'read',
    inputSchema: listCustomerSubscriptionDetailsInput,
    outputSchema: z.toJSONSchema(listCustomerSubscriptionDetailsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
