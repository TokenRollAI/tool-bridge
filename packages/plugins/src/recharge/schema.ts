/**
 * Recharge 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listCustomersInput = z.strictObject({
  limit: z.int().min(1).max(250).describe('The number of records to request. Recharge allows up to 250.').optional(),
  cursor: z.string().min(1).describe('The Recharge cursor returned as next_cursor or previous_cursor.').optional(),
  include: z.array(z.string().min(1).describe('One Recharge include value.')).describe('Related Recharge resources to include, joined as a comma-separated include query parameter.').optional(),
  ids: z.array(z.string().min(1).describe('The Recharge resource ID.')).describe('Recharge resource IDs to request as a comma-separated ids query parameter.').optional(),
  sortBy: z.string().min(1).describe('The Recharge sort_by expression, such as id-desc.').optional(),
  createdAtMin: z.string().describe('A Recharge date or datetime filter value.').optional(),
  createdAtMax: z.string().describe('A Recharge date or datetime filter value.').optional(),
  updatedAtMin: z.string().describe('A Recharge date or datetime filter value.').optional(),
  updatedAtMax: z.string().describe('A Recharge date or datetime filter value.').optional(),
  email: z.email().describe('Customer email address to filter by.').optional(),
}).describe('Query parameters for listing Recharge customers.')

export const listCustomersOutput = z.strictObject({
  customers: z.array(z.looseObject({}).describe('A Recharge resource object returned by the API.')).describe('Customers returned by Recharge.').optional(),
  nextCursor: z.string().describe('The cursor for the next page, when Recharge returns one.').nullable().optional(),
  previousCursor: z.string().describe('The cursor for the previous page, when Recharge returns one.').nullable().optional(),
  raw: z.looseObject({}).describe('The raw Recharge API response.').optional(),
}).describe('The response returned when listing Recharge customers.')

export const getCustomerInput = z.strictObject({
  id: z.string().min(1).describe('The Recharge resource ID.'),
  include: z.array(z.string().min(1).describe('One Recharge include value.')).describe('Related Recharge resources to include, joined as a comma-separated include query parameter.').optional(),
}).describe('Path and include parameters for retrieving one Recharge resource.')

export const getCustomerOutput = z.strictObject({
  customer: z.looseObject({}).describe('The Recharge customer.').optional(),
  raw: z.looseObject({}).describe('The raw Recharge API response.').optional(),
}).describe('The response returned when retrieving a Recharge customer.')

export const listSubscriptionsInput = z.strictObject({
  limit: z.int().min(1).max(250).describe('The number of records to request. Recharge allows up to 250.').optional(),
  cursor: z.string().min(1).describe('The Recharge cursor returned as next_cursor or previous_cursor.').optional(),
  include: z.array(z.string().min(1).describe('One Recharge include value.')).describe('Related Recharge resources to include, joined as a comma-separated include query parameter.').optional(),
  ids: z.array(z.string().min(1).describe('The Recharge resource ID.')).describe('Recharge resource IDs to request as a comma-separated ids query parameter.').optional(),
  sortBy: z.string().min(1).describe('The Recharge sort_by expression, such as id-desc.').optional(),
  createdAtMin: z.string().describe('A Recharge date or datetime filter value.').optional(),
  createdAtMax: z.string().describe('A Recharge date or datetime filter value.').optional(),
  updatedAtMin: z.string().describe('A Recharge date or datetime filter value.').optional(),
  updatedAtMax: z.string().describe('A Recharge date or datetime filter value.').optional(),
  addressId: z.string().min(1).describe('The Recharge resource ID.').optional(),
  customerId: z.string().min(1).describe('The Recharge resource ID.').optional(),
  productTitle: z.string().min(1).describe('Subscription product title to filter by.').optional(),
  status: z.string().min(1).describe('The Recharge status filter value or comma-separated status list.').optional(),
}).describe('Query parameters for listing Recharge subscriptions.')

export const listSubscriptionsOutput = z.strictObject({
  subscriptions: z.array(z.looseObject({}).describe('A Recharge resource object returned by the API.')).describe('Subscriptions returned by Recharge.').optional(),
  nextCursor: z.string().describe('The cursor for the next page, when Recharge returns one.').nullable().optional(),
  previousCursor: z.string().describe('The cursor for the previous page, when Recharge returns one.').nullable().optional(),
  raw: z.looseObject({}).describe('The raw Recharge API response.').optional(),
}).describe('The response returned when listing Recharge subscriptions.')

export const getSubscriptionInput = z.strictObject({
  id: z.string().min(1).describe('The Recharge resource ID.'),
  include: z.array(z.string().min(1).describe('One Recharge include value.')).describe('Related Recharge resources to include, joined as a comma-separated include query parameter.').optional(),
}).describe('Path and include parameters for retrieving one Recharge resource.')

export const getSubscriptionOutput = z.strictObject({
  subscription: z.looseObject({}).describe('The Recharge subscription.').optional(),
  raw: z.looseObject({}).describe('The raw Recharge API response.').optional(),
}).describe('The response returned when retrieving a Recharge subscription.')

export const listOrdersInput = z.strictObject({
  limit: z.int().min(1).max(250).describe('The number of records to request. Recharge allows up to 250.').optional(),
  cursor: z.string().min(1).describe('The Recharge cursor returned as next_cursor or previous_cursor.').optional(),
  include: z.array(z.string().min(1).describe('One Recharge include value.')).describe('Related Recharge resources to include, joined as a comma-separated include query parameter.').optional(),
  ids: z.array(z.string().min(1).describe('The Recharge resource ID.')).describe('Recharge resource IDs to request as a comma-separated ids query parameter.').optional(),
  sortBy: z.string().min(1).describe('The Recharge sort_by expression, such as id-desc.').optional(),
  createdAtMin: z.string().describe('A Recharge date or datetime filter value.').optional(),
  createdAtMax: z.string().describe('A Recharge date or datetime filter value.').optional(),
  updatedAtMin: z.string().describe('A Recharge date or datetime filter value.').optional(),
  updatedAtMax: z.string().describe('A Recharge date or datetime filter value.').optional(),
  addressId: z.string().min(1).describe('The Recharge resource ID.').optional(),
  chargeId: z.string().min(1).describe('The Recharge resource ID.').optional(),
  customerId: z.string().min(1).describe('The Recharge resource ID.').optional(),
  externalOrderId: z.string().min(1).describe('External ecommerce order ID to filter by.').optional(),
  processedAtMin: z.string().describe('A Recharge date or datetime filter value.').optional(),
  processedAtMax: z.string().describe('A Recharge date or datetime filter value.').optional(),
  status: z.string().min(1).describe('The Recharge status filter value or comma-separated status list.').optional(),
}).describe('Query parameters for listing Recharge orders.')

export const listOrdersOutput = z.strictObject({
  orders: z.array(z.looseObject({}).describe('A Recharge resource object returned by the API.')).describe('Orders returned by Recharge.').optional(),
  nextCursor: z.string().describe('The cursor for the next page, when Recharge returns one.').nullable().optional(),
  previousCursor: z.string().describe('The cursor for the previous page, when Recharge returns one.').nullable().optional(),
  raw: z.looseObject({}).describe('The raw Recharge API response.').optional(),
}).describe('The response returned when listing Recharge orders.')

export const getOrderInput = z.strictObject({
  id: z.string().min(1).describe('The Recharge resource ID.'),
  include: z.array(z.string().min(1).describe('One Recharge include value.')).describe('Related Recharge resources to include, joined as a comma-separated include query parameter.').optional(),
}).describe('Path and include parameters for retrieving one Recharge resource.')

export const getOrderOutput = z.strictObject({
  order: z.looseObject({}).describe('The Recharge order.').optional(),
  raw: z.looseObject({}).describe('The raw Recharge API response.').optional(),
}).describe('The response returned when retrieving a Recharge order.')

export const listChargesInput = z.strictObject({
  limit: z.int().min(1).max(250).describe('The number of records to request. Recharge allows up to 250.').optional(),
  cursor: z.string().min(1).describe('The Recharge cursor returned as next_cursor or previous_cursor.').optional(),
  include: z.array(z.string().min(1).describe('One Recharge include value.')).describe('Related Recharge resources to include, joined as a comma-separated include query parameter.').optional(),
  ids: z.array(z.string().min(1).describe('The Recharge resource ID.')).describe('Recharge resource IDs to request as a comma-separated ids query parameter.').optional(),
  sortBy: z.string().min(1).describe('The Recharge sort_by expression, such as id-desc.').optional(),
  createdAtMin: z.string().describe('A Recharge date or datetime filter value.').optional(),
  createdAtMax: z.string().describe('A Recharge date or datetime filter value.').optional(),
  updatedAtMin: z.string().describe('A Recharge date or datetime filter value.').optional(),
  updatedAtMax: z.string().describe('A Recharge date or datetime filter value.').optional(),
  addressId: z.string().min(1).describe('The Recharge resource ID.').optional(),
  customerId: z.string().min(1).describe('The Recharge resource ID.').optional(),
  discountCode: z.string().min(1).describe('Discount code to filter charges by.').optional(),
  discountId: z.string().min(1).describe('The Recharge resource ID.').optional(),
  externalOrderId: z.string().min(1).describe('External ecommerce order ID to filter charges by.').optional(),
  purchaseItemId: z.string().min(1).describe('The Recharge resource ID.').optional(),
  scheduledAt: z.string().describe('A Recharge date or datetime filter value.').optional(),
  scheduledAtMin: z.string().describe('A Recharge date or datetime filter value.').optional(),
  scheduledAtMax: z.string().describe('A Recharge date or datetime filter value.').optional(),
  processedAtMin: z.string().describe('A Recharge date or datetime filter value.').optional(),
  processedAtMax: z.string().describe('A Recharge date or datetime filter value.').optional(),
  status: z.string().min(1).describe('The Recharge status filter value or comma-separated status list.').optional(),
}).describe('Query parameters for listing Recharge charges.')

export const listChargesOutput = z.strictObject({
  charges: z.array(z.looseObject({}).describe('A Recharge resource object returned by the API.')).describe('Charges returned by Recharge.').optional(),
  nextCursor: z.string().describe('The cursor for the next page, when Recharge returns one.').nullable().optional(),
  previousCursor: z.string().describe('The cursor for the previous page, when Recharge returns one.').nullable().optional(),
  raw: z.looseObject({}).describe('The raw Recharge API response.').optional(),
}).describe('The response returned when listing Recharge charges.')

export const getChargeInput = z.strictObject({
  id: z.string().min(1).describe('The Recharge resource ID.'),
  include: z.array(z.string().min(1).describe('One Recharge include value.')).describe('Related Recharge resources to include, joined as a comma-separated include query parameter.').optional(),
}).describe('Path and include parameters for retrieving one Recharge resource.')

export const getChargeOutput = z.strictObject({
  charge: z.looseObject({}).describe('The Recharge charge.').optional(),
  raw: z.looseObject({}).describe('The raw Recharge API response.').optional(),
}).describe('The response returned when retrieving a Recharge charge.')

export const listProductsInput = z.strictObject({
  limit: z.int().min(1).max(250).describe('The number of records to request. Recharge allows up to 250.').optional(),
  cursor: z.string().min(1).describe('The Recharge cursor returned as next_cursor or previous_cursor.').optional(),
  include: z.array(z.string().min(1).describe('One Recharge include value.')).describe('Related Recharge resources to include, joined as a comma-separated include query parameter.').optional(),
  ids: z.array(z.string().min(1).describe('The Recharge resource ID.')).describe('Recharge resource IDs to request as a comma-separated ids query parameter.').optional(),
  sortBy: z.string().min(1).describe('The Recharge sort_by expression, such as id-desc.').optional(),
  createdAtMin: z.string().describe('A Recharge date or datetime filter value.').optional(),
  createdAtMax: z.string().describe('A Recharge date or datetime filter value.').optional(),
  updatedAtMin: z.string().describe('A Recharge date or datetime filter value.').optional(),
  updatedAtMax: z.string().describe('A Recharge date or datetime filter value.').optional(),
  collectionId: z.string().min(1).describe('The Recharge resource ID.').optional(),
  externalProductId: z.string().min(1).describe('External catalog product ID to filter by.').optional(),
  title: z.string().min(1).describe('Product title to filter by.').optional(),
}).describe('Query parameters for listing Recharge products.')

export const listProductsOutput = z.strictObject({
  products: z.array(z.looseObject({}).describe('A Recharge resource object returned by the API.')).describe('Products returned by Recharge.').optional(),
  nextCursor: z.string().describe('The cursor for the next page, when Recharge returns one.').nullable().optional(),
  previousCursor: z.string().describe('The cursor for the previous page, when Recharge returns one.').nullable().optional(),
  raw: z.looseObject({}).describe('The raw Recharge API response.').optional(),
}).describe('The response returned when listing Recharge products.')

export const getProductInput = z.strictObject({
  id: z.string().min(1).describe('The Recharge resource ID.'),
  include: z.array(z.string().min(1).describe('One Recharge include value.')).describe('Related Recharge resources to include, joined as a comma-separated include query parameter.').optional(),
}).describe('Path and include parameters for retrieving one Recharge resource.')

export const getProductOutput = z.strictObject({
  product: z.looseObject({}).describe('The Recharge product.').optional(),
  raw: z.looseObject({}).describe('The raw Recharge API response.').optional(),
}).describe('The response returned when retrieving a Recharge product.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const rechargeActions = {
  list_customers: {
    description: 'List Recharge customers with cursor pagination and common filters.',
    effect: 'read',
    inputSchema: listCustomersInput,
    outputSchema: z.toJSONSchema(listCustomersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_customer: {
    description: 'Retrieve one Recharge customer by ID.',
    effect: 'read',
    inputSchema: getCustomerInput,
    outputSchema: z.toJSONSchema(getCustomerOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_subscriptions: {
    description: 'List Recharge subscriptions with cursor pagination and common filters.',
    effect: 'read',
    inputSchema: listSubscriptionsInput,
    outputSchema: z.toJSONSchema(listSubscriptionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_subscription: {
    description: 'Retrieve one Recharge subscription by ID.',
    effect: 'read',
    inputSchema: getSubscriptionInput,
    outputSchema: z.toJSONSchema(getSubscriptionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_orders: {
    description: 'List Recharge orders with cursor pagination and common filters.',
    effect: 'read',
    inputSchema: listOrdersInput,
    outputSchema: z.toJSONSchema(listOrdersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_order: {
    description: 'Retrieve one Recharge order by ID.',
    effect: 'read',
    inputSchema: getOrderInput,
    outputSchema: z.toJSONSchema(getOrderOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_charges: {
    description: 'List Recharge charges with cursor pagination and common filters.',
    effect: 'read',
    inputSchema: listChargesInput,
    outputSchema: z.toJSONSchema(listChargesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_charge: {
    description: 'Retrieve one Recharge charge by ID.',
    effect: 'read',
    inputSchema: getChargeInput,
    outputSchema: z.toJSONSchema(getChargeOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_products: {
    description: 'List Recharge products with cursor pagination and common filters.',
    effect: 'read',
    inputSchema: listProductsInput,
    outputSchema: z.toJSONSchema(listProductsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_product: {
    description: 'Retrieve one Recharge product by ID.',
    effect: 'read',
    inputSchema: getProductInput,
    outputSchema: z.toJSONSchema(getProductOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
