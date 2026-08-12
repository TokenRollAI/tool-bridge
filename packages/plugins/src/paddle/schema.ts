/**
 * Paddle 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listProductsInput = z.strictObject({
  after: z.string().min(1).describe('Paddle ID cursor returned in a previous list response.').optional(),
  perPage: z.int().min(1).max(200).describe('Maximum number of entities to request from Paddle.').optional(),
  orderBy: z.string().min(1).describe('Paddle order_by expression such as `id[DESC]`.').optional(),
  skipCount: z.boolean().describe('Whether to send Skip-Count: true to speed up list responses.').optional(),
  ids: z.array(z.string().min(1).describe('A Paddle product ID.')).describe('Product IDs to return.').optional(),
  include: z.array(z.enum(['prices']).describe('A supported Paddle product include value.')).describe('Related entities to include in each product.').optional(),
  status: z.array(z.enum(['active', 'archived']).describe('Paddle entity status.')).describe('Product statuses to return.').optional(),
  taxCategory: z.array(z.enum(['digital-goods', 'ebooks', 'implementation-services', 'professional-services', 'saas', 'software-programming-services', 'standard', 'training-services', 'website-hosting']).describe('Paddle product tax category.')).describe('Product tax categories to return.').optional(),
  type: z.enum(['standard', 'custom']).describe('Paddle entity type.').optional(),
}).describe('Input for listing Paddle products.')

export const listProductsOutput = z.strictObject({
  data: z.array(z.looseObject({}).describe('Raw Paddle entity returned by the API.')).describe('A Paddle product entity.').optional(),
  meta: z.looseObject({}).describe('Paddle response metadata, including pagination for list endpoints.').optional(),
}).describe('Products returned by Paddle.')

export const getProductInput = z.strictObject({
  id: z.string().min(1).describe('Paddle product ID, prefixed with `pro_`.').optional(),
}).describe('Input for retrieving a Paddle product.')

export const getProductOutput = z.strictObject({
  product: z.looseObject({}).describe('Raw Paddle entity returned by the API.').nullable().optional(),
  meta: z.looseObject({}).describe('Paddle response metadata when returned by the API.').optional(),
}).describe('A Paddle product result.')

export const createProductInput = z.strictObject({
  name: z.string().min(1).describe('Name of the product.'),
  description: z.string().min(1).describe('Short description for the product.').optional(),
  tax_category: z.enum(['digital-goods', 'ebooks', 'implementation-services', 'professional-services', 'saas', 'software-programming-services', 'standard', 'training-services', 'website-hosting']).describe('Paddle product tax category.').optional(),
  type: z.enum(['standard', 'custom']).describe('Paddle entity type.').optional(),
  image_url: z.url().describe('Image URL for this product.').optional(),
  custom_data: z.record(z.string(), z.unknown().describe('A custom data value.')).describe('Custom data attached to a Paddle entity.').nullable().optional(),
}).describe('Product fields forwarded to Paddle.')

export const createProductOutput = z.strictObject({
  product: z.looseObject({}).describe('Raw Paddle entity returned by the API.').nullable().optional(),
  meta: z.looseObject({}).describe('Paddle response metadata when returned by the API.').optional(),
}).describe('A created Paddle product result.')

export const updateProductInput = z.strictObject({
  id: z.string().min(1).describe('Paddle product ID, prefixed with `pro_`.'),
  name: z.string().min(1).describe('Name of the product.').optional(),
  description: z.string().min(1).describe('Short description for the product.').optional(),
  tax_category: z.enum(['digital-goods', 'ebooks', 'implementation-services', 'professional-services', 'saas', 'software-programming-services', 'standard', 'training-services', 'website-hosting']).describe('Paddle product tax category.').optional(),
  type: z.enum(['standard', 'custom']).describe('Paddle entity type.').optional(),
  image_url: z.url().describe('Image URL for this product.').optional(),
  custom_data: z.record(z.string(), z.unknown().describe('A custom data value.')).describe('Custom data attached to a Paddle entity.').nullable().optional(),
  status: z.enum(['active', 'archived']).describe('Paddle entity status.').optional(),
}).describe('Input for updating a Paddle product.')

export const updateProductOutput = z.strictObject({
  product: z.looseObject({}).describe('Raw Paddle entity returned by the API.').nullable().optional(),
  meta: z.looseObject({}).describe('Paddle response metadata when returned by the API.').optional(),
}).describe('An updated Paddle product result.')

export const listPricesInput = z.strictObject({
  after: z.string().min(1).describe('Paddle ID cursor returned in a previous list response.').optional(),
  perPage: z.int().min(1).max(200).describe('Maximum number of entities to request from Paddle.').optional(),
  orderBy: z.string().min(1).describe('Paddle order_by expression such as `id[DESC]`.').optional(),
  skipCount: z.boolean().describe('Whether to send Skip-Count: true to speed up list responses.').optional(),
  ids: z.array(z.string().min(1).describe('A Paddle price ID.')).describe('Price IDs to return.').optional(),
  include: z.array(z.enum(['product']).describe('A supported Paddle price include value.')).describe('Related entities to include in each price.').optional(),
  productIds: z.array(z.string().min(1).describe('A Paddle product ID.')).describe('Product IDs whose prices should be returned.').optional(),
  status: z.array(z.enum(['active', 'archived']).describe('Paddle entity status.')).describe('Price statuses to return.').optional(),
  recurring: z.boolean().describe('Whether to return recurring prices.').optional(),
  billingCycleInterval: z.enum(['day', 'week', 'month', 'year']).describe('Billing interval unit.').optional(),
  billingCycleFrequency: z.int().min(1).describe('Billing cycle frequency to filter by.').optional(),
  type: z.enum(['standard', 'custom']).describe('Paddle entity type.').optional(),
}).describe('Input for listing Paddle prices.')

export const listPricesOutput = z.strictObject({
  data: z.array(z.looseObject({}).describe('Raw Paddle entity returned by the API.')).describe('A Paddle price entity.').optional(),
  meta: z.looseObject({}).describe('Paddle response metadata, including pagination for list endpoints.').optional(),
}).describe('Prices returned by Paddle.')

export const getPriceInput = z.strictObject({
  id: z.string().min(1).describe('Paddle price ID, prefixed with `pri_`.').optional(),
}).describe('Input for retrieving a Paddle price.')

export const getPriceOutput = z.strictObject({
  price: z.looseObject({}).describe('Raw Paddle entity returned by the API.').nullable().optional(),
  meta: z.looseObject({}).describe('Paddle response metadata when returned by the API.').optional(),
}).describe('A Paddle price result.')

export const createPriceInput = z.strictObject({
  product_id: z.string().min(1).describe('Paddle product ID, prefixed with `pro_`.'),
  description: z.string().min(1).describe('Internal description for this price.'),
  unit_price: z.strictObject({
    amount: z.string().min(1).describe('Amount in the lowest denomination for the currency, represented as a string.').optional(),
    currency_code: z.string().min(1).describe('Three-letter ISO 4217 currency code.').optional(),
  }).describe('Money amount in Paddle\'s lowest currency denomination.'),
  type: z.enum(['standard', 'custom']).describe('Paddle entity type.').optional(),
  name: z.string().min(1).describe('Name of this price.').optional(),
  billing_cycle: z.strictObject({
    interval: z.enum(['day', 'week', 'month', 'year']).describe('Billing interval unit.').optional(),
    frequency: z.int().min(1).describe('Number of intervals in the billing cycle.').optional(),
  }).describe('Recurring billing cycle for a Paddle price, or null for a one-time price.').nullable().optional(),
  trial_period: z.strictObject({
    interval: z.enum(['day', 'week', 'month', 'year']).describe('Billing interval unit.'),
    frequency: z.int().min(1).describe('Number of intervals in the trial period.'),
    requires_payment_method: z.boolean().describe('Whether a payment method is required for the trial.').optional(),
    unit_price: z.strictObject({
      amount: z.string().min(1).describe('Amount in the lowest denomination for the currency, represented as a string.').optional(),
      currency_code: z.string().min(1).describe('Three-letter ISO 4217 currency code.').optional(),
    }).describe('Money amount in Paddle\'s lowest currency denomination.').nullable().optional(),
  }).describe('Trial period configuration for a Paddle price.').nullable().optional(),
  tax_mode: z.enum(['account_setting', 'external', 'internal', 'location']).describe('How Paddle should calculate tax for this price.').optional(),
  quantity: z.strictObject({
    minimum: z.int().min(1).describe('Minimum quantity that can be purchased.').optional(),
    maximum: z.int().min(1).describe('Maximum quantity that can be purchased.').optional(),
  }).describe('Quantity limits for the related product at this price.').optional(),
  custom_data: z.record(z.string(), z.unknown().describe('A custom data value.')).describe('Custom data attached to a Paddle entity.').nullable().optional(),
}).describe('Price fields forwarded to Paddle.')

export const createPriceOutput = z.strictObject({
  price: z.looseObject({}).describe('Raw Paddle entity returned by the API.').nullable().optional(),
  meta: z.looseObject({}).describe('Paddle response metadata when returned by the API.').optional(),
}).describe('A created Paddle price result.')

export const updatePriceInput = z.strictObject({
  id: z.string().min(1).describe('Paddle price ID, prefixed with `pri_`.'),
  product_id: z.string().min(1).describe('Paddle product ID, prefixed with `pro_`.').optional(),
  description: z.string().min(1).describe('Internal description for this price.').optional(),
  unit_price: z.strictObject({
    amount: z.string().min(1).describe('Amount in the lowest denomination for the currency, represented as a string.').optional(),
    currency_code: z.string().min(1).describe('Three-letter ISO 4217 currency code.').optional(),
  }).describe('Money amount in Paddle\'s lowest currency denomination.').optional(),
  type: z.enum(['standard', 'custom']).describe('Paddle entity type.').optional(),
  name: z.string().min(1).describe('Name of this price.').optional(),
  billing_cycle: z.strictObject({
    interval: z.enum(['day', 'week', 'month', 'year']).describe('Billing interval unit.').optional(),
    frequency: z.int().min(1).describe('Number of intervals in the billing cycle.').optional(),
  }).describe('Recurring billing cycle for a Paddle price, or null for a one-time price.').nullable().optional(),
  trial_period: z.strictObject({
    interval: z.enum(['day', 'week', 'month', 'year']).describe('Billing interval unit.'),
    frequency: z.int().min(1).describe('Number of intervals in the trial period.'),
    requires_payment_method: z.boolean().describe('Whether a payment method is required for the trial.').optional(),
    unit_price: z.strictObject({
      amount: z.string().min(1).describe('Amount in the lowest denomination for the currency, represented as a string.').optional(),
      currency_code: z.string().min(1).describe('Three-letter ISO 4217 currency code.').optional(),
    }).describe('Money amount in Paddle\'s lowest currency denomination.').nullable().optional(),
  }).describe('Trial period configuration for a Paddle price.').nullable().optional(),
  tax_mode: z.enum(['account_setting', 'external', 'internal', 'location']).describe('How Paddle should calculate tax for this price.').optional(),
  quantity: z.strictObject({
    minimum: z.int().min(1).describe('Minimum quantity that can be purchased.').optional(),
    maximum: z.int().min(1).describe('Maximum quantity that can be purchased.').optional(),
  }).describe('Quantity limits for the related product at this price.').optional(),
  custom_data: z.record(z.string(), z.unknown().describe('A custom data value.')).describe('Custom data attached to a Paddle entity.').nullable().optional(),
  status: z.enum(['active', 'archived']).describe('Paddle entity status.').optional(),
}).describe('Input for updating a Paddle price.')

export const updatePriceOutput = z.strictObject({
  price: z.looseObject({}).describe('Raw Paddle entity returned by the API.').nullable().optional(),
  meta: z.looseObject({}).describe('Paddle response metadata when returned by the API.').optional(),
}).describe('An updated Paddle price result.')

export const listCustomersInput = z.strictObject({
  after: z.string().min(1).describe('Paddle ID cursor returned in a previous list response.').optional(),
  perPage: z.int().min(1).max(200).describe('Maximum number of entities to request from Paddle.').optional(),
  orderBy: z.string().min(1).describe('Paddle order_by expression such as `id[DESC]`.').optional(),
  skipCount: z.boolean().describe('Whether to send Skip-Count: true to speed up list responses.').optional(),
  ids: z.array(z.string().min(1).describe('A Paddle customer ID.')).describe('Customer IDs to return.').optional(),
  emails: z.array(z.string().min(1).describe('A customer email address.')).describe('Email addresses to match exactly.').optional(),
  status: z.array(z.enum(['active', 'archived']).describe('Paddle entity status.')).describe('Customer statuses to return.').optional(),
  search: z.string().max(100).describe('Search query matched against customer ID, name, and email.').optional(),
}).describe('Input for listing Paddle customers.')

export const listCustomersOutput = z.strictObject({
  data: z.array(z.looseObject({}).describe('Raw Paddle entity returned by the API.')).describe('A Paddle customer entity.').optional(),
  meta: z.looseObject({}).describe('Paddle response metadata, including pagination for list endpoints.').optional(),
}).describe('Customers returned by Paddle.')

export const getCustomerInput = z.strictObject({
  id: z.string().min(1).describe('Paddle customer ID, prefixed with `ctm_`.').optional(),
}).describe('Input for retrieving a Paddle customer.')

export const getCustomerOutput = z.strictObject({
  customer: z.looseObject({}).describe('Raw Paddle entity returned by the API.').nullable().optional(),
  meta: z.looseObject({}).describe('Paddle response metadata when returned by the API.').optional(),
}).describe('A Paddle customer result.')

export const createCustomerInput = z.strictObject({
  name: z.string().min(1).describe('Full name for this customer.').optional(),
  email: z.email().min(1).describe('Email address for this customer.'),
  locale: z.string().min(1).describe('IETF BCP 47 locale tag for this customer.').optional(),
  custom_data: z.record(z.string(), z.unknown().describe('A custom data value.')).describe('Custom data attached to a Paddle entity.').nullable().optional(),
}).describe('Customer fields forwarded to Paddle.')

export const createCustomerOutput = z.strictObject({
  customer: z.looseObject({}).describe('Raw Paddle entity returned by the API.').nullable().optional(),
  meta: z.looseObject({}).describe('Paddle response metadata when returned by the API.').optional(),
}).describe('A created Paddle customer result.')

export const updateCustomerInput = z.strictObject({
  id: z.string().min(1).describe('Paddle customer ID, prefixed with `ctm_`.'),
  name: z.string().min(1).describe('Full name for this customer.').optional(),
  email: z.email().min(1).describe('Email address for this customer.').optional(),
  locale: z.string().min(1).describe('IETF BCP 47 locale tag for this customer.').optional(),
  custom_data: z.record(z.string(), z.unknown().describe('A custom data value.')).describe('Custom data attached to a Paddle entity.').nullable().optional(),
  status: z.enum(['active', 'archived']).describe('Paddle entity status.').optional(),
}).describe('Input for updating a Paddle customer.')

export const updateCustomerOutput = z.strictObject({
  customer: z.looseObject({}).describe('Raw Paddle entity returned by the API.').nullable().optional(),
  meta: z.looseObject({}).describe('Paddle response metadata when returned by the API.').optional(),
}).describe('An updated Paddle customer result.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const paddleActions = {
  list_products: {
    description: 'List Paddle products with optional filtering, pagination, and price inclusion.',
    effect: 'read',
    inputSchema: listProductsInput,
    outputSchema: z.toJSONSchema(listProductsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_product: {
    description: 'Get one Paddle product by ID.',
    effect: 'read',
    inputSchema: getProductInput,
    outputSchema: z.toJSONSchema(getProductOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_product: {
    description: 'Create a Paddle product in the catalog.',
    effect: 'write',
    inputSchema: createProductInput,
    outputSchema: z.toJSONSchema(createProductOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_product: {
    description: 'Update a Paddle product, including archiving or reactivating it through status.',
    effect: 'write',
    inputSchema: updateProductInput,
    outputSchema: z.toJSONSchema(updateProductOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_prices: {
    description: 'List Paddle prices with optional product, status, recurring, and billing filters.',
    effect: 'read',
    inputSchema: listPricesInput,
    outputSchema: z.toJSONSchema(listPricesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_price: {
    description: 'Get one Paddle price by ID.',
    effect: 'read',
    inputSchema: getPriceInput,
    outputSchema: z.toJSONSchema(getPriceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_price: {
    description: 'Create a Paddle price for a product.',
    effect: 'write',
    inputSchema: createPriceInput,
    outputSchema: z.toJSONSchema(createPriceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_price: {
    description: 'Update a Paddle price, including archiving or reactivating it through status.',
    effect: 'write',
    inputSchema: updatePriceInput,
    outputSchema: z.toJSONSchema(updatePriceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_customers: {
    description: 'List Paddle customers with optional email, status, search, and pagination filters.',
    effect: 'read',
    inputSchema: listCustomersInput,
    outputSchema: z.toJSONSchema(listCustomersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_customer: {
    description: 'Get one Paddle customer by ID.',
    effect: 'read',
    inputSchema: getCustomerInput,
    outputSchema: z.toJSONSchema(getCustomerOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_customer: {
    description: 'Create a Paddle customer.',
    effect: 'write',
    inputSchema: createCustomerInput,
    outputSchema: z.toJSONSchema(createCustomerOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_customer: {
    description: 'Update a Paddle customer, including archiving or reactivating it through status.',
    effect: 'write',
    inputSchema: updateCustomerInput,
    outputSchema: z.toJSONSchema(updateCustomerOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
