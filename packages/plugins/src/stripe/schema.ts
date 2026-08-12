/**
 * Stripe 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const identifyAccountInput = z.strictObject({}).describe('No input is required to identify a Stripe account.')

export const identifyAccountOutput = z.strictObject({
  account: z.looseObject({}).describe('A raw Stripe object returned by the API.'),
  accountId: z.string().describe('The Stripe account ID.').nullable(),
  email: z.string().describe('The Stripe account email address.').nullable(),
  country: z.string().describe('The Stripe account country.').nullable(),
  defaultCurrency: z.string().describe('The Stripe account default currency.').nullable(),
}).describe('Stripe account metadata.')

export const createCustomerInput = z.strictObject({
  name: z.string().max(256).describe('The customer\'s full name or business name.').optional(),
  email: z.email().describe('The customer\'s email address.').optional(),
  description: z.string().describe('An arbitrary customer description displayed in the Stripe Dashboard.').optional(),
  phone: z.string().max(20).describe('The customer\'s phone number.').optional(),
  balance: z.int().describe('The customer balance in the smallest currency unit.').optional(),
  address: z.strictObject({
    city: z.string().describe('City, district, suburb, town, or village.').optional(),
    country: z.string().describe('Two-letter country code, or a freeform country value where Stripe allows it.').optional(),
    line1: z.string().describe('Address line 1, such as the street, PO Box, or company name.').optional(),
    line2: z.string().describe('Address line 2, such as the apartment, suite, unit, or building.').optional(),
    postal_code: z.string().describe('ZIP or postal code.').optional(),
    state: z.string().describe('State, county, province, or region.').optional(),
  }).describe('A Stripe address object.').optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).describe('Stripe metadata key-value pairs. Values are forwarded as strings, numbers, booleans, or empty strings.').optional(),
  tax_exempt: z.enum(['none', 'exempt', 'reverse']).describe('The customer\'s tax exemption status.').optional(),
}).describe('Input for creating a Stripe customer.')

export const createCustomerOutput = z.strictObject({
  customer: z.looseObject({}).describe('A raw Stripe object returned by the API.').nullable(),
}).describe('A Stripe customer result.')

export const updateCustomerInput = z.strictObject({
  customerId: z.string().min(1).describe('The Stripe customer ID to update.'),
  name: z.string().max(256).describe('The customer\'s full name or business name.').optional(),
  email: z.email().describe('The customer\'s email address.').optional(),
  description: z.string().describe('An arbitrary customer description displayed in the Stripe Dashboard.').optional(),
  phone: z.string().max(20).describe('The customer\'s phone number.').optional(),
  balance: z.int().describe('The customer balance in the smallest currency unit.').optional(),
  address: z.strictObject({
    city: z.string().describe('City, district, suburb, town, or village.').optional(),
    country: z.string().describe('Two-letter country code, or a freeform country value where Stripe allows it.').optional(),
    line1: z.string().describe('Address line 1, such as the street, PO Box, or company name.').optional(),
    line2: z.string().describe('Address line 2, such as the apartment, suite, unit, or building.').optional(),
    postal_code: z.string().describe('ZIP or postal code.').optional(),
    state: z.string().describe('State, county, province, or region.').optional(),
  }).describe('A Stripe address object.').optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).describe('Stripe metadata key-value pairs. Values are forwarded as strings, numbers, booleans, or empty strings.').optional(),
  tax_exempt: z.enum(['none', 'exempt', 'reverse']).describe('The customer\'s tax exemption status.').optional(),
}).describe('Input for updating a Stripe customer.')

export const updateCustomerOutput = z.strictObject({
  customer: z.looseObject({}).describe('A raw Stripe object returned by the API.').nullable(),
}).describe('A Stripe customer result.')

export const getCustomerInput = z.strictObject({
  customerId: z.string().min(1).describe('The Stripe customer ID to retrieve.'),
}).describe('Input for retrieving a Stripe customer.')

export const getCustomerOutput = z.strictObject({
  customer: z.looseObject({}).describe('A raw Stripe object returned by the API.').nullable(),
}).describe('A Stripe customer result.')

export const listCustomersInput = z.strictObject({
  limit: z.int().min(1).max(100).describe('The maximum number of objects to return. Stripe accepts values from 1 to 100.').optional(),
  starting_after: z.string().min(1).describe('A cursor object ID that fetches the next page after that object.').optional(),
  ending_before: z.string().min(1).describe('A cursor object ID that fetches the previous page before that object.').optional(),
  email: z.email().describe('Filter customers by an exact, case-sensitive email address.').optional(),
  created: z.strictObject({
    gt: z.int().describe('Return objects created after this Unix timestamp, exclusive.').optional(),
    gte: z.int().describe('Return objects created after or at this Unix timestamp.').optional(),
    lt: z.int().describe('Return objects created before this Unix timestamp, exclusive.').optional(),
    lte: z.int().describe('Return objects created before or at this Unix timestamp.').optional(),
  }).describe('A Stripe created timestamp interval filter.').optional(),
}).describe('Input for listing Stripe customers.')

export const listCustomersOutput = z.strictObject({
  customers: z.strictObject({
    object: z.string().describe('The Stripe response object type.'),
    url: z.string().describe('The Stripe API URL for this list.'),
    has_more: z.boolean().describe('Whether more objects are available after this page.'),
    data: z.array(z.looseObject({}).describe('A raw Stripe object returned by the API.')).describe('Stripe objects returned on this page.'),
  }).describe('A Stripe list response.'),
}).describe('Stripe customers page.')

export const searchCustomersInput = z.strictObject({
  query: z.string().min(1).describe('A Stripe customer search query, such as email:\'jenny@example.com\'.'),
  limit: z.int().min(1).max(100).describe('The maximum number of objects to return. Stripe accepts values from 1 to 100.').optional(),
  page: z.string().describe('A Stripe search pagination token returned by a previous search response.').optional(),
}).describe('Input for searching Stripe customers.')

export const searchCustomersOutput = z.strictObject({
  customers: z.strictObject({
    object: z.string().describe('The Stripe response object type.'),
    url: z.string().describe('The Stripe API URL for this list.'),
    has_more: z.boolean().describe('Whether more objects are available after this page.'),
    data: z.array(z.looseObject({}).describe('A raw Stripe object returned by the API.')).describe('Stripe objects returned on this page.'),
  }).describe('A Stripe list response.'),
}).describe('Stripe customer search results.')

export const deleteCustomerInput = z.strictObject({
  customerId: z.string().min(1).describe('The Stripe customer ID to delete.'),
}).describe('Input for deleting a Stripe customer.')

export const deleteCustomerOutput = z.strictObject({
  deleted: z.boolean().describe('Whether Stripe deleted the object.'),
  object: z.string().describe('The deleted Stripe object type.'),
  id: z.string().describe('The deleted Stripe object ID.'),
  raw: z.looseObject({}).describe('A raw Stripe object returned by the API.'),
}).describe('A Stripe delete result.')

export const createProductInput = z.strictObject({
  name: z.string().min(1).describe('The product\'s display name.'),
  active: z.boolean().describe('Whether the product is available for purchase.').optional(),
  description: z.string().describe('The product description.').optional(),
  id: z.string().describe('A caller-supplied product ID. Stripe normally generates this when omitted.').optional(),
  images: z.array(z.url().describe('One public product image URL.')).max(8).describe('Public image URLs for the product.').optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).describe('Stripe metadata key-value pairs. Values are forwarded as strings, numbers, booleans, or empty strings.').optional(),
  shippable: z.boolean().describe('Whether this product is shipped as a physical good.').optional(),
  statement_descriptor: z.string().max(22).describe('Statement descriptor for subscription payments.').optional(),
  tax_code: z.string().describe('Stripe tax code ID for this product.').optional(),
  unit_label: z.string().max(12).describe('A label that represents units of this product.').optional(),
  url: z.url().describe('A publicly accessible product webpage URL.').optional(),
}).describe('Input for creating a Stripe product.')

export const createProductOutput = z.strictObject({
  product: z.looseObject({}).describe('A raw Stripe object returned by the API.').nullable(),
}).describe('A Stripe product result.')

export const updateProductInput = z.strictObject({
  productId: z.string().min(1).describe('The Stripe product ID to update.'),
  name: z.string().min(1).describe('The product\'s display name.').optional(),
  active: z.boolean().describe('Whether the product is available for purchase.').optional(),
  description: z.string().describe('The product description.').optional(),
  id: z.string().describe('A caller-supplied product ID. Stripe normally generates this when omitted.').optional(),
  images: z.array(z.url().describe('One public product image URL.')).max(8).describe('Public image URLs for the product.').optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).describe('Stripe metadata key-value pairs. Values are forwarded as strings, numbers, booleans, or empty strings.').optional(),
  shippable: z.boolean().describe('Whether this product is shipped as a physical good.').optional(),
  statement_descriptor: z.string().max(22).describe('Statement descriptor for subscription payments.').optional(),
  tax_code: z.string().describe('Stripe tax code ID for this product.').optional(),
  unit_label: z.string().max(12).describe('A label that represents units of this product.').optional(),
  url: z.url().describe('A publicly accessible product webpage URL.').optional(),
}).describe('Input for updating a Stripe product.')

export const updateProductOutput = z.strictObject({
  product: z.looseObject({}).describe('A raw Stripe object returned by the API.').nullable(),
}).describe('A Stripe product result.')

export const getProductInput = z.strictObject({
  productId: z.string().min(1).describe('The Stripe product ID to retrieve.'),
}).describe('Input for retrieving a Stripe product.')

export const getProductOutput = z.strictObject({
  product: z.looseObject({}).describe('A raw Stripe object returned by the API.').nullable(),
}).describe('A Stripe product result.')

export const listProductsInput = z.strictObject({
  limit: z.int().min(1).max(100).describe('The maximum number of objects to return. Stripe accepts values from 1 to 100.').optional(),
  starting_after: z.string().min(1).describe('A cursor object ID that fetches the next page after that object.').optional(),
  ending_before: z.string().min(1).describe('A cursor object ID that fetches the previous page before that object.').optional(),
  active: z.boolean().describe('Filter products by active status.').optional(),
  ids: z.array(z.string().min(1).describe('A Stripe product ID.')).describe('Filter products by Stripe product IDs.').optional(),
  created: z.strictObject({
    gt: z.int().describe('Return objects created after this Unix timestamp, exclusive.').optional(),
    gte: z.int().describe('Return objects created after or at this Unix timestamp.').optional(),
    lt: z.int().describe('Return objects created before this Unix timestamp, exclusive.').optional(),
    lte: z.int().describe('Return objects created before or at this Unix timestamp.').optional(),
  }).describe('A Stripe created timestamp interval filter.').optional(),
}).describe('Input for listing Stripe products.')

export const listProductsOutput = z.strictObject({
  products: z.strictObject({
    object: z.string().describe('The Stripe response object type.'),
    url: z.string().describe('The Stripe API URL for this list.'),
    has_more: z.boolean().describe('Whether more objects are available after this page.'),
    data: z.array(z.looseObject({}).describe('A raw Stripe object returned by the API.')).describe('Stripe objects returned on this page.'),
  }).describe('A Stripe list response.'),
}).describe('Stripe products page.')

export const searchProductsInput = z.strictObject({
  query: z.string().min(1).describe('A Stripe product search query, such as active:\'true\'.'),
  limit: z.int().min(1).max(100).describe('The maximum number of objects to return. Stripe accepts values from 1 to 100.').optional(),
  page: z.string().describe('A Stripe search pagination token returned by a previous search response.').optional(),
}).describe('Input for searching Stripe products.')

export const searchProductsOutput = z.strictObject({
  products: z.strictObject({
    object: z.string().describe('The Stripe response object type.'),
    url: z.string().describe('The Stripe API URL for this list.'),
    has_more: z.boolean().describe('Whether more objects are available after this page.'),
    data: z.array(z.looseObject({}).describe('A raw Stripe object returned by the API.')).describe('Stripe objects returned on this page.'),
  }).describe('A Stripe list response.'),
}).describe('Stripe product search results.')

export const deleteProductInput = z.strictObject({
  productId: z.string().min(1).describe('The Stripe product ID to delete.'),
}).describe('Input for deleting a Stripe product.')

export const deleteProductOutput = z.strictObject({
  deleted: z.boolean().describe('Whether Stripe deleted the object.'),
  object: z.string().describe('The deleted Stripe object type.'),
  id: z.string().describe('The deleted Stripe object ID.'),
  raw: z.looseObject({}).describe('A raw Stripe object returned by the API.'),
}).describe('A Stripe delete result.')

export const createPriceInput = z.strictObject({
  currency: z.string().min(3).max(3).describe('Three-letter ISO currency code in lowercase.'),
  product: z.string().min(1).describe('The Stripe product ID this price belongs to.').optional(),
  product_data: z.strictObject({
    name: z.string().min(1).describe('The product\'s display name.'),
    active: z.boolean().describe('Whether the product is available for purchase.').optional(),
    metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).describe('Stripe metadata key-value pairs. Values are forwarded as strings, numbers, booleans, or empty strings.').optional(),
    statement_descriptor: z.string().max(22).describe('Statement descriptor for subscription payments.').optional(),
    tax_code: z.string().describe('Stripe tax code ID for this product.').optional(),
    unit_label: z.string().max(12).describe('A label that represents units of this product.').optional(),
  }).describe('Inline product data for creating a product while creating a price.').optional(),
  unit_amount: z.int().describe('Unit amount in the smallest currency unit.').optional(),
  unit_amount_decimal: z.string().describe('Decimal unit amount in the smallest currency unit.').optional(),
  custom_unit_amount: z.strictObject({
    enabled: z.literal(true).describe('Whether customer-defined pricing is enabled for this price.'),
    minimum: z.int().describe('The minimum allowed amount in the smallest currency unit.').optional(),
    maximum: z.int().describe('The maximum allowed amount in the smallest currency unit.').optional(),
    preset: z.int().describe('The suggested amount in the smallest currency unit.').optional(),
  }).describe('Custom unit amount configuration that lets the payer choose the price amount.').optional(),
  active: z.boolean().describe('Whether the price can be used for new purchases.').optional(),
  lookup_key: z.string().max(200).describe('A lookup key used to retrieve this price dynamically.').optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).describe('Stripe metadata key-value pairs. Values are forwarded as strings, numbers, booleans, or empty strings.').optional(),
  nickname: z.string().describe('A brief internal description of the price.').optional(),
  recurring: z.strictObject({
    interval: z.enum(['day', 'week', 'month', 'year']).describe('The billing frequency interval.'),
    interval_count: z.int().describe('The number of intervals between subscription billings.').optional(),
    usage_type: z.enum(['licensed', 'metered']).describe('How usage is billed for this price.').optional(),
  }).describe('Recurring billing configuration for a Stripe price.').optional(),
  tax_behavior: z.enum(['exclusive', 'inclusive', 'unspecified']).describe('How Stripe should handle tax for this price.').optional(),
}).describe('Input for creating a Stripe price.')

export const createPriceOutput = z.strictObject({
  price: z.looseObject({}).describe('A raw Stripe object returned by the API.').nullable(),
}).describe('A Stripe price result.')

export const updatePriceInput = z.strictObject({
  priceId: z.string().min(1).describe('The Stripe price ID to update.'),
  active: z.boolean().describe('Whether the price can be used for new purchases.').optional(),
  lookup_key: z.string().max(200).describe('A lookup key used to retrieve this price dynamically.').optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).describe('Stripe metadata key-value pairs. Values are forwarded as strings, numbers, booleans, or empty strings.').optional(),
  nickname: z.string().describe('A brief internal description of the price.').optional(),
  tax_behavior: z.enum(['exclusive', 'inclusive', 'unspecified']).describe('How Stripe should handle tax for this price.').optional(),
}).describe('Input for updating a Stripe price.')

export const updatePriceOutput = z.strictObject({
  price: z.looseObject({}).describe('A raw Stripe object returned by the API.').nullable(),
}).describe('A Stripe price result.')

export const getPriceInput = z.strictObject({
  priceId: z.string().min(1).describe('The Stripe price ID to retrieve.'),
}).describe('Input for retrieving a Stripe price.')

export const getPriceOutput = z.strictObject({
  price: z.looseObject({}).describe('A raw Stripe object returned by the API.').nullable(),
}).describe('A Stripe price result.')

export const listPricesInput = z.strictObject({
  limit: z.int().min(1).max(100).describe('The maximum number of objects to return. Stripe accepts values from 1 to 100.').optional(),
  starting_after: z.string().min(1).describe('A cursor object ID that fetches the next page after that object.').optional(),
  ending_before: z.string().min(1).describe('A cursor object ID that fetches the previous page before that object.').optional(),
  active: z.boolean().describe('Filter prices by active status.').optional(),
  currency: z.string().min(3).max(3).describe('Filter prices by three-letter ISO currency code in lowercase.').optional(),
  product: z.string().min(1).describe('Filter prices by Stripe product ID.').optional(),
  type: z.enum(['one_time', 'recurring']).describe('Filter prices by one-time or recurring type.').optional(),
  created: z.strictObject({
    gt: z.int().describe('Return objects created after this Unix timestamp, exclusive.').optional(),
    gte: z.int().describe('Return objects created after or at this Unix timestamp.').optional(),
    lt: z.int().describe('Return objects created before this Unix timestamp, exclusive.').optional(),
    lte: z.int().describe('Return objects created before or at this Unix timestamp.').optional(),
  }).describe('A Stripe created timestamp interval filter.').optional(),
}).describe('Input for listing Stripe prices.')

export const listPricesOutput = z.strictObject({
  prices: z.strictObject({
    object: z.string().describe('The Stripe response object type.'),
    url: z.string().describe('The Stripe API URL for this list.'),
    has_more: z.boolean().describe('Whether more objects are available after this page.'),
    data: z.array(z.looseObject({}).describe('A raw Stripe object returned by the API.')).describe('Stripe objects returned on this page.'),
  }).describe('A Stripe list response.'),
}).describe('Stripe prices page.')

export const searchPricesInput = z.strictObject({
  query: z.string().min(1).describe('A Stripe price search query, such as active:\'true\'.'),
  limit: z.int().min(1).max(100).describe('The maximum number of objects to return. Stripe accepts values from 1 to 100.').optional(),
  page: z.string().describe('A Stripe search pagination token returned by a previous search response.').optional(),
}).describe('Input for searching Stripe prices.')

export const searchPricesOutput = z.strictObject({
  prices: z.strictObject({
    object: z.string().describe('The Stripe response object type.'),
    url: z.string().describe('The Stripe API URL for this list.'),
    has_more: z.boolean().describe('Whether more objects are available after this page.'),
    data: z.array(z.looseObject({}).describe('A raw Stripe object returned by the API.')).describe('Stripe objects returned on this page.'),
  }).describe('A Stripe list response.'),
}).describe('Stripe price search results.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const stripeActions = {
  identify_account: {
    description: 'Retrieve the Stripe account associated with the current secret API key.',
    effect: 'read',
    inputSchema: identifyAccountInput,
    outputSchema: z.toJSONSchema(identifyAccountOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_customer: {
    description: 'Create a Stripe customer with common profile and metadata fields.',
    effect: 'write',
    inputSchema: createCustomerInput,
    outputSchema: z.toJSONSchema(createCustomerOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_customer: {
    description: 'Update a Stripe customer with common profile and metadata fields.',
    effect: 'write',
    inputSchema: updateCustomerInput,
    outputSchema: z.toJSONSchema(updateCustomerOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_customer: {
    description: 'Retrieve a Stripe customer by ID.',
    effect: 'read',
    inputSchema: getCustomerInput,
    outputSchema: z.toJSONSchema(getCustomerOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_customers: {
    description: 'List Stripe customers with optional email, created timestamp, and cursor filters.',
    effect: 'read',
    inputSchema: listCustomersInput,
    outputSchema: z.toJSONSchema(listCustomersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_customers: {
    description: 'Search Stripe customers with Stripe\'s search query syntax.',
    effect: 'read',
    inputSchema: searchCustomersInput,
    outputSchema: z.toJSONSchema(searchCustomersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_customer: {
    description: 'Delete a Stripe customer by ID.',
    effect: 'destructive',
    inputSchema: deleteCustomerInput,
    outputSchema: z.toJSONSchema(deleteCustomerOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_product: {
    description: 'Create a Stripe product with common catalog fields.',
    effect: 'write',
    inputSchema: createProductInput,
    outputSchema: z.toJSONSchema(createProductOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_product: {
    description: 'Update a Stripe product with common catalog fields.',
    effect: 'write',
    inputSchema: updateProductInput,
    outputSchema: z.toJSONSchema(updateProductOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_product: {
    description: 'Retrieve a Stripe product by ID.',
    effect: 'read',
    inputSchema: getProductInput,
    outputSchema: z.toJSONSchema(getProductOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_products: {
    description: 'List Stripe products with optional active and cursor filters.',
    effect: 'read',
    inputSchema: listProductsInput,
    outputSchema: z.toJSONSchema(listProductsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_products: {
    description: 'Search Stripe products with Stripe\'s search query syntax.',
    effect: 'read',
    inputSchema: searchProductsInput,
    outputSchema: z.toJSONSchema(searchProductsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_product: {
    description: 'Delete a Stripe product by ID.',
    effect: 'destructive',
    inputSchema: deleteProductInput,
    outputSchema: z.toJSONSchema(deleteProductOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_price: {
    description: 'Create a Stripe one-time or recurring price for an existing or inline product.',
    effect: 'write',
    inputSchema: createPriceInput,
    outputSchema: z.toJSONSchema(createPriceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_price: {
    description: 'Update mutable fields on a Stripe price.',
    effect: 'write',
    inputSchema: updatePriceInput,
    outputSchema: z.toJSONSchema(updatePriceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_price: {
    description: 'Retrieve a Stripe price by ID.',
    effect: 'read',
    inputSchema: getPriceInput,
    outputSchema: z.toJSONSchema(getPriceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_prices: {
    description: 'List Stripe prices with optional product, active, type, and cursor filters.',
    effect: 'read',
    inputSchema: listPricesInput,
    outputSchema: z.toJSONSchema(listPricesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_prices: {
    description: 'Search Stripe prices with Stripe\'s search query syntax.',
    effect: 'read',
    inputSchema: searchPricesInput,
    outputSchema: z.toJSONSchema(searchPricesOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
