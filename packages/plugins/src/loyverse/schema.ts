/**
 * Loyverse 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getMerchantInput = z.strictObject({}).describe('This action does not require any input.')

export const getMerchantOutput = z.strictObject({
  merchant: z.looseObject({}).describe('A Loyverse API object returned without reshaping.').optional(),
}).describe('The Loyverse merchant profile response.')

export const listStoresInput = z.strictObject({
  ids: z.array(z.string().min(1).describe('One Loyverse resource ID.')).min(1).describe('Limit results to these Loyverse store IDs.').optional(),
  createdAtMin: z.iso.datetime({ offset: true }).describe('Only include resources created at or after this timestamp.').optional(),
  createdAtMax: z.iso.datetime({ offset: true }).describe('Only include resources created at or before this timestamp.').optional(),
  updatedAtMin: z.iso.datetime({ offset: true }).describe('Only include resources updated at or after this timestamp.').optional(),
  updatedAtMax: z.iso.datetime({ offset: true }).describe('Only include resources updated at or before this timestamp.').optional(),
  limit: z.int().min(1).max(250).default(50).describe('The maximum number of records to return. Loyverse allows up to 250.').optional(),
  cursor: z.string().min(1).describe('The pagination cursor returned by a previous Loyverse list call.').optional(),
  showDeleted: z.boolean().describe('Whether to include soft-deleted Loyverse records.').optional(),
}).describe('The input payload for listing Loyverse stores.')

export const listStoresOutput = z.strictObject({
  stores: z.array(z.looseObject({}).describe('A Loyverse API object returned without reshaping.')).describe('The Loyverse stores returned by the API.').optional(),
  cursor: z.string().describe('The cursor to pass to the next list request, or null when there is no next page.').nullable().optional(),
  raw: z.looseObject({}).describe('The raw Loyverse response payload.').optional(),
}).describe('The Loyverse stores list response.')

export const getStoreInput = z.strictObject({
  id: z.string().min(1).describe('The Loyverse store ID.').optional(),
}).describe('The input payload for reading one Loyverse resource.')

export const getStoreOutput = z.strictObject({
  store: z.looseObject({}).describe('A Loyverse API object returned without reshaping.').optional(),
}).describe('The Loyverse store response.')

export const listItemsInput = z.strictObject({
  ids: z.array(z.string().min(1).describe('One Loyverse resource ID.')).min(1).describe('Limit results to these Loyverse item IDs.').optional(),
  createdAtMin: z.iso.datetime({ offset: true }).describe('Only include resources created at or after this timestamp.').optional(),
  createdAtMax: z.iso.datetime({ offset: true }).describe('Only include resources created at or before this timestamp.').optional(),
  updatedAtMin: z.iso.datetime({ offset: true }).describe('Only include resources updated at or after this timestamp.').optional(),
  updatedAtMax: z.iso.datetime({ offset: true }).describe('Only include resources updated at or before this timestamp.').optional(),
  limit: z.int().min(1).max(250).default(50).describe('The maximum number of records to return. Loyverse allows up to 250.').optional(),
  cursor: z.string().min(1).describe('The pagination cursor returned by a previous Loyverse list call.').optional(),
  showDeleted: z.boolean().describe('Whether to include soft-deleted Loyverse records.').optional(),
}).describe('The input payload for listing Loyverse items.')

export const listItemsOutput = z.strictObject({
  items: z.array(z.looseObject({}).describe('A Loyverse API object returned without reshaping.')).describe('The Loyverse items returned by the API.').optional(),
  cursor: z.string().describe('The cursor to pass to the next list request, or null when there is no next page.').nullable().optional(),
  raw: z.looseObject({}).describe('The raw Loyverse response payload.').optional(),
}).describe('The Loyverse items list response.')

export const getItemInput = z.strictObject({
  id: z.string().min(1).describe('The Loyverse item ID.').optional(),
}).describe('The input payload for reading one Loyverse resource.')

export const getItemOutput = z.strictObject({
  item: z.looseObject({}).describe('A Loyverse API object returned without reshaping.').optional(),
}).describe('The Loyverse item response.')

export const listCategoriesInput = z.strictObject({
  ids: z.array(z.string().min(1).describe('One Loyverse resource ID.')).min(1).describe('Limit results to these Loyverse category IDs.').optional(),
  createdAtMin: z.iso.datetime({ offset: true }).describe('Only include resources created at or after this timestamp.').optional(),
  createdAtMax: z.iso.datetime({ offset: true }).describe('Only include resources created at or before this timestamp.').optional(),
  updatedAtMin: z.iso.datetime({ offset: true }).describe('Only include resources updated at or after this timestamp.').optional(),
  updatedAtMax: z.iso.datetime({ offset: true }).describe('Only include resources updated at or before this timestamp.').optional(),
  limit: z.int().min(1).max(250).default(50).describe('The maximum number of records to return. Loyverse allows up to 250.').optional(),
  cursor: z.string().min(1).describe('The pagination cursor returned by a previous Loyverse list call.').optional(),
  showDeleted: z.boolean().describe('Whether to include soft-deleted Loyverse records.').optional(),
}).describe('The input payload for listing Loyverse categories.')

export const listCategoriesOutput = z.strictObject({
  categories: z.array(z.looseObject({}).describe('A Loyverse API object returned without reshaping.')).describe('The Loyverse categories returned by the API.').optional(),
  cursor: z.string().describe('The cursor to pass to the next list request, or null when there is no next page.').nullable().optional(),
  raw: z.looseObject({}).describe('The raw Loyverse response payload.').optional(),
}).describe('The Loyverse categories list response.')

export const getCategoryInput = z.strictObject({
  id: z.string().min(1).describe('The Loyverse category ID.').optional(),
}).describe('The input payload for reading one Loyverse resource.')

export const getCategoryOutput = z.strictObject({
  category: z.looseObject({}).describe('A Loyverse API object returned without reshaping.').optional(),
}).describe('The Loyverse category response.')

export const listCustomersInput = z.strictObject({
  ids: z.array(z.string().min(1).describe('One Loyverse resource ID.')).min(1).describe('Limit results to these Loyverse customer IDs.').optional(),
  email: z.email().describe('Filter customers by email address.').optional(),
  createdAtMin: z.iso.datetime({ offset: true }).describe('Only include resources created at or after this timestamp.').optional(),
  createdAtMax: z.iso.datetime({ offset: true }).describe('Only include resources created at or before this timestamp.').optional(),
  updatedAtMin: z.iso.datetime({ offset: true }).describe('Only include resources updated at or after this timestamp.').optional(),
  updatedAtMax: z.iso.datetime({ offset: true }).describe('Only include resources updated at or before this timestamp.').optional(),
  limit: z.int().min(1).max(250).default(50).describe('The maximum number of records to return. Loyverse allows up to 250.').optional(),
  cursor: z.string().min(1).describe('The pagination cursor returned by a previous Loyverse list call.').optional(),
}).describe('The input payload for listing Loyverse customers.')

export const listCustomersOutput = z.strictObject({
  customers: z.array(z.looseObject({}).describe('A Loyverse API object returned without reshaping.')).describe('The Loyverse customers returned by the API.').optional(),
  cursor: z.string().describe('The cursor to pass to the next list request, or null when there is no next page.').nullable().optional(),
  raw: z.looseObject({}).describe('The raw Loyverse response payload.').optional(),
}).describe('The Loyverse customers list response.')

export const getCustomerInput = z.strictObject({
  id: z.string().min(1).describe('The Loyverse customer ID.').optional(),
}).describe('The input payload for reading one Loyverse resource.')

export const getCustomerOutput = z.strictObject({
  customer: z.looseObject({}).describe('A Loyverse API object returned without reshaping.').optional(),
}).describe('The Loyverse customer response.')

export const listReceiptsInput = z.strictObject({
  receiptNumbers: z.array(z.string().min(1).describe('One Loyverse receipt number.')).min(1).describe('Receipt numbers used to filter Loyverse receipt results.').optional(),
  sinceReceiptNumber: z.string().min(1).describe('Show receipts after the receipt with this number.').optional(),
  beforeReceiptNumber: z.string().min(1).describe('Show receipts before the receipt with this number.').optional(),
  storeId: z.string().min(1).describe('Filter receipts to one Loyverse store ID.').optional(),
  order: z.string().min(1).describe('Filter receipts by Loyverse order value.').optional(),
  source: z.string().min(1).describe('Filter receipts by source name.').optional(),
  createdAtMin: z.iso.datetime({ offset: true }).describe('Only include resources created at or after this timestamp.').optional(),
  createdAtMax: z.iso.datetime({ offset: true }).describe('Only include resources created at or before this timestamp.').optional(),
  updatedAtMin: z.iso.datetime({ offset: true }).describe('Only include resources updated at or after this timestamp.').optional(),
  updatedAtMax: z.iso.datetime({ offset: true }).describe('Only include resources updated at or before this timestamp.').optional(),
  limit: z.int().min(1).max(250).default(50).describe('The maximum number of records to return. Loyverse allows up to 250.').optional(),
  cursor: z.string().min(1).describe('The pagination cursor returned by a previous Loyverse list call.').optional(),
}).describe('The input payload for listing Loyverse receipts.')

export const listReceiptsOutput = z.strictObject({
  receipts: z.array(z.looseObject({}).describe('A Loyverse API object returned without reshaping.')).describe('The Loyverse receipts returned by the API.').optional(),
  cursor: z.string().describe('The cursor to pass to the next list request, or null when there is no next page.').nullable().optional(),
  raw: z.looseObject({}).describe('The raw Loyverse response payload.').optional(),
}).describe('The Loyverse receipts list response.')

export const getReceiptInput = z.strictObject({
  receiptNumber: z.string().min(1).describe('The Loyverse receipt number.').optional(),
}).describe('The input payload for reading one Loyverse receipt.')

export const getReceiptOutput = z.strictObject({
  receipt: z.looseObject({}).describe('A Loyverse API object returned without reshaping.').optional(),
}).describe('The Loyverse receipt response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const loyverseActions = {
  get_merchant: {
    description: 'Get merchant profile information for the connected Loyverse account.',
    effect: 'read',
    inputSchema: getMerchantInput,
    outputSchema: z.toJSONSchema(getMerchantOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_stores: {
    description: 'List stores in the connected Loyverse account.',
    effect: 'read',
    inputSchema: listStoresInput,
    outputSchema: z.toJSONSchema(listStoresOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_store: {
    description: 'Get one Loyverse store by ID.',
    effect: 'read',
    inputSchema: getStoreInput,
    outputSchema: z.toJSONSchema(getStoreOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_items: {
    description: 'List items in the connected Loyverse account.',
    effect: 'read',
    inputSchema: listItemsInput,
    outputSchema: z.toJSONSchema(listItemsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_item: {
    description: 'Get one Loyverse item by ID.',
    effect: 'read',
    inputSchema: getItemInput,
    outputSchema: z.toJSONSchema(getItemOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_categories: {
    description: 'List item categories in the connected Loyverse account.',
    effect: 'read',
    inputSchema: listCategoriesInput,
    outputSchema: z.toJSONSchema(listCategoriesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_category: {
    description: 'Get one Loyverse category by ID.',
    effect: 'read',
    inputSchema: getCategoryInput,
    outputSchema: z.toJSONSchema(getCategoryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_customers: {
    description: 'List customers in the connected Loyverse account.',
    effect: 'read',
    inputSchema: listCustomersInput,
    outputSchema: z.toJSONSchema(listCustomersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_customer: {
    description: 'Get one Loyverse customer by ID.',
    effect: 'read',
    inputSchema: getCustomerInput,
    outputSchema: z.toJSONSchema(getCustomerOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_receipts: {
    description: 'List receipts in the connected Loyverse account.',
    effect: 'read',
    inputSchema: listReceiptsInput,
    outputSchema: z.toJSONSchema(listReceiptsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_receipt: {
    description: 'Get one Loyverse receipt by receipt number.',
    effect: 'read',
    inputSchema: getReceiptInput,
    outputSchema: z.toJSONSchema(getReceiptOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
