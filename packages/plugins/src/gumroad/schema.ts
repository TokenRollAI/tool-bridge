/**
 * Gumroad 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getCurrentUserInput = z.strictObject({}).describe('No input is required to retrieve the authenticated Gumroad user.')

export const getCurrentUserOutput = z.strictObject({
  success: z.boolean().describe('Whether Gumroad reported that the request succeeded.'),
  user: z.looseObject({}).describe('Raw object returned by Gumroad.'),
}).describe('Current Gumroad user response.')

export const listProductsInput = z.strictObject({}).describe('No input is required to list Gumroad products.')

export const listProductsOutput = z.strictObject({
  success: z.boolean().describe('Whether Gumroad reported that the request succeeded.'),
  products: z.array(z.looseObject({}).describe('Raw object returned by Gumroad.')).describe('Products returned by Gumroad.'),
}).describe('Gumroad products list response.')

export const getProductInput = z.strictObject({
  productId: z.string().min(1).describe('Gumroad resource ID.'),
}).describe('Input for retrieving one Gumroad product.')

export const getProductOutput = z.strictObject({
  success: z.boolean().describe('Whether Gumroad reported that the request succeeded.'),
  product: z.looseObject({}).describe('Raw object returned by Gumroad.'),
}).describe('Single Gumroad product response.')

export const listSalesInput = z.strictObject({
  after: z.string().min(1).describe('Date filter in YYYY-MM-DD format.').optional(),
  before: z.string().min(1).describe('Date filter in YYYY-MM-DD format.').optional(),
  productId: z.string().min(1).describe('Gumroad resource ID.').optional(),
  email: z.string().min(1).describe('Buyer email address to filter sales by.').optional(),
  orderId: z.string().min(1).describe('Gumroad order ID to filter sales by.').optional(),
  name: z.string().min(1).describe('Customer name to filter sales by.').optional(),
  licenseKey: z.string().min(1).describe('License key to filter sales by.').optional(),
  pageKey: z.string().min(1).describe('Page key returned by a previous list_sales response.').optional(),
}).describe('Input for listing Gumroad sales.')

export const listSalesOutput = z.strictObject({
  success: z.boolean().describe('Whether Gumroad reported that the request succeeded.'),
  sales: z.array(z.looseObject({}).describe('Raw object returned by Gumroad.')).describe('Sales returned by Gumroad.'),
  next_page_url: z.string().describe('URL for the next sales page when returned.').nullable(),
  next_page_key: z.string().describe('Page key to pass to the next list_sales request.').nullable(),
}).describe('Gumroad sales list response.')

export const getSaleInput = z.strictObject({
  saleId: z.string().min(1).describe('Gumroad resource ID.'),
}).describe('Input for retrieving one Gumroad sale.')

export const getSaleOutput = z.strictObject({
  success: z.boolean().describe('Whether Gumroad reported that the request succeeded.'),
  sale: z.looseObject({}).describe('Raw object returned by Gumroad.'),
}).describe('Single Gumroad sale response.')

export const listProductSubscribersInput = z.strictObject({
  productId: z.string().min(1).describe('Gumroad resource ID.'),
  email: z.string().min(1).describe('Subscriber email address to filter by.').optional(),
  paginated: z.boolean().describe('Whether Gumroad should limit the response to a paginated page.').optional(),
  pageKey: z.string().min(1).describe('Page key returned by a previous subscriber list response.').optional(),
}).describe('Input for listing active Gumroad subscribers for a product.')

export const listProductSubscribersOutput = z.strictObject({
  success: z.boolean().describe('Whether Gumroad reported that the request succeeded.'),
  subscribers: z.array(z.looseObject({}).describe('Raw object returned by Gumroad.')).describe('Subscribers returned by Gumroad.'),
  next_page_url: z.string().describe('URL for the next subscribers page when returned.').nullable(),
  next_page_key: z.string().describe('Page key to pass to the next list_product_subscribers request.').nullable(),
}).describe('Gumroad product subscribers response.')

export const markSaleAsShippedInput = z.strictObject({
  saleId: z.string().min(1).describe('Gumroad resource ID.'),
  trackingUrl: z.url().describe('Tracking URL to attach to the shipment.').optional(),
}).describe('Input for marking a Gumroad sale as shipped.')

export const markSaleAsShippedOutput = z.strictObject({
  success: z.boolean().describe('Whether Gumroad reported that the request succeeded.'),
  sale: z.looseObject({}).describe('Raw object returned by Gumroad.'),
}).describe('Single Gumroad sale response.')

export const refundSaleInput = z.strictObject({
  saleId: z.string().min(1).describe('Gumroad resource ID.'),
  amountCents: z.int().min(1).describe('Partial refund amount in the sale currency\'s smallest unit.').optional(),
}).describe('Input for refunding a Gumroad sale.')

export const refundSaleOutput = z.strictObject({
  success: z.boolean().describe('Whether Gumroad reported that the request succeeded.'),
  sale: z.looseObject({}).describe('Raw object returned by Gumroad.'),
}).describe('Single Gumroad sale response.')

export const resendSaleReceiptInput = z.strictObject({
  saleId: z.string().min(1).describe('Gumroad resource ID.'),
}).describe('Input for resending a Gumroad sale receipt.')

export const resendSaleReceiptOutput = z.strictObject({
  success: z.boolean().describe('Whether Gumroad reported that the request succeeded.'),
}).describe('Gumroad sale receipt resend response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const gumroadActions = {
  get_current_user: {
    description: 'Retrieve the authenticated Gumroad user.',
    effect: 'read',
    inputSchema: getCurrentUserInput,
    outputSchema: z.toJSONSchema(getCurrentUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_products: {
    description: 'List products owned by the authenticated Gumroad user.',
    effect: 'read',
    inputSchema: listProductsInput,
    outputSchema: z.toJSONSchema(listProductsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_product: {
    description: 'Retrieve one Gumroad product by ID.',
    effect: 'read',
    inputSchema: getProductInput,
    outputSchema: z.toJSONSchema(getProductOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_sales: {
    description: 'List successful Gumroad sales with optional filters and pagination.',
    effect: 'read',
    inputSchema: listSalesInput,
    outputSchema: z.toJSONSchema(listSalesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_sale: {
    description: 'Retrieve one Gumroad sale by ID.',
    effect: 'read',
    inputSchema: getSaleInput,
    outputSchema: z.toJSONSchema(getSaleOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_product_subscribers: {
    description: 'List active subscribers for one Gumroad product.',
    effect: 'read',
    inputSchema: listProductSubscribersInput,
    outputSchema: z.toJSONSchema(listProductSubscribersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  mark_sale_as_shipped: {
    description: 'Mark a Gumroad sale as shipped, optionally including a tracking URL.',
    effect: 'write',
    inputSchema: markSaleAsShippedInput,
    outputSchema: z.toJSONSchema(markSaleAsShippedOutput, { io: 'output', unrepresentable: 'any' }),
  },
  refund_sale: {
    description: 'Refund a Gumroad sale, optionally as a partial refund in cents.',
    effect: 'write',
    inputSchema: refundSaleInput,
    outputSchema: z.toJSONSchema(refundSaleOutput, { io: 'output', unrepresentable: 'any' }),
  },
  resend_sale_receipt: {
    description: 'Resend a Gumroad sale receipt to the buyer.',
    effect: 'write',
    inputSchema: resendSaleReceiptInput,
    outputSchema: z.toJSONSchema(resendSaleReceiptOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
