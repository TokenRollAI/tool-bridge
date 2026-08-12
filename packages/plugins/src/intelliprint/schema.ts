/**
 * Intelliprint 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listPrintsInput = z.strictObject({
  limit: z.int().min(1).max(1000).describe('The maximum number of Intelliprint objects to return. The official API supports 1 through 1000.').optional(),
  skip: z.int().min(0).describe('The number of Intelliprint objects to skip before returning results.').optional(),
  sortOrder: z.enum(['asc', 'desc']).describe('The sort direction for the Intelliprint list request.').optional(),
  fields: z.array(z.string().min(1).describe('One Intelliprint response field name to include.')).min(1).describe('The optional Intelliprint response fields to request.').optional(),
  sortField: z.enum(['created', 'confirmed_at', 'reference', 'type', 'letters', 'pages', 'sheets', 'letters.returned.date', 'cost.after_tax', 'cost.amount']).describe('The Intelliprint print field used to sort the list response.').optional(),
  testmode: z.boolean().describe('Whether to return only test mode print jobs.').optional(),
  confirmed: z.boolean().describe('Whether to filter print jobs by confirmation state.').optional(),
  type: z.enum(['letter', 'postcard']).describe('The Intelliprint print job type to filter by.').optional(),
  reference: z.string().min(1).describe('A print job reference filter.').optional(),
  letterStatus: z.string().min(1).describe('The letter status filter sent as letters.status.').optional(),
  returnedAcknowledged: z.boolean().describe('Whether to filter returned letters by the acknowledged flag.').optional(),
}).describe('Input parameters for listing Intelliprint print jobs.')

export const listPrintsOutput = z.strictObject({
  data: z.array(z.looseObject({}).describe('An Intelliprint print job object returned in the list.')).describe('The Intelliprint objects returned for this page.').optional(),
  totalAvailable: z.int().describe('The total number of Intelliprint objects available across paginated requests.').optional(),
  hasMore: z.boolean().describe('Whether another Intelliprint page is available after this response.').optional(),
  raw: z.looseObject({}).describe('The raw Intelliprint list response payload.').optional(),
}).describe('The normalized Intelliprint print job list response.')

export const getPrintInput = z.strictObject({
  id: z.string().min(1).describe('The Intelliprint print job ID to retrieve.').optional(),
}).describe('Input parameters for retrieving an Intelliprint print job.')

export const getPrintOutput = z.strictObject({
  print: z.looseObject({
    id: z.string().describe('The Intelliprint object ID.').optional(),
    object: z.string().describe('The Intelliprint object type.').optional(),
    created: z.int().describe('The UNIX timestamp when the Intelliprint object was created.').optional(),
  }).describe('An Intelliprint print job object.').optional(),
  raw: z.looseObject({}).describe('The raw Intelliprint print job response payload.').optional(),
}).describe('The normalized Intelliprint print job response.')

export const listBackgroundsInput = z.strictObject({
  limit: z.int().min(1).max(1000).describe('The maximum number of Intelliprint objects to return. The official API supports 1 through 1000.').optional(),
  skip: z.int().min(0).describe('The number of Intelliprint objects to skip before returning results.').optional(),
  sortOrder: z.enum(['asc', 'desc']).describe('The sort direction for the Intelliprint list request.').optional(),
  fields: z.array(z.string().min(1).describe('One Intelliprint response field name to include.')).min(1).describe('The optional Intelliprint response fields to request.').optional(),
  sortField: z.enum(['created', 'name']).describe('The Intelliprint background field used to sort the list response.').optional(),
  team: z.string().min(1).describe('The Intelliprint team ID used to filter reusable backgrounds.').optional(),
}).describe('Input parameters for listing Intelliprint backgrounds.')

export const listBackgroundsOutput = z.strictObject({
  data: z.array(z.looseObject({}).describe('An Intelliprint background object returned in the list.')).describe('The Intelliprint objects returned for this page.').optional(),
  totalAvailable: z.int().describe('The total number of Intelliprint objects available across paginated requests.').optional(),
  hasMore: z.boolean().describe('Whether another Intelliprint page is available after this response.').optional(),
  raw: z.looseObject({}).describe('The raw Intelliprint list response payload.').optional(),
}).describe('The normalized Intelliprint background list response.')

export const getBackgroundInput = z.strictObject({
  id: z.string().min(1).describe('The Intelliprint background ID to retrieve.').optional(),
}).describe('Input parameters for retrieving an Intelliprint background.')

export const getBackgroundOutput = z.strictObject({
  background: z.looseObject({
    id: z.string().describe('The Intelliprint object ID.').optional(),
    object: z.string().describe('The Intelliprint object type.').optional(),
    created: z.int().describe('The UNIX timestamp when the Intelliprint object was created.').optional(),
  }).describe('An Intelliprint background object.').optional(),
  raw: z.looseObject({}).describe('The raw Intelliprint background response payload.').optional(),
}).describe('The normalized Intelliprint background response.')

export const listMailingListsInput = z.strictObject({
  limit: z.int().min(1).max(1000).describe('The maximum number of Intelliprint objects to return. The official API supports 1 through 1000.').optional(),
  skip: z.int().min(0).describe('The number of Intelliprint objects to skip before returning results.').optional(),
  sortOrder: z.enum(['asc', 'desc']).describe('The sort direction for the Intelliprint list request.').optional(),
  fields: z.array(z.string().min(1).describe('One Intelliprint response field name to include.')).min(1).describe('The optional Intelliprint response fields to request.').optional(),
  sortField: z.enum(['created', 'name', 'recipients']).describe('The Intelliprint mailing list field used to sort the list response.').optional(),
}).describe('Input parameters for listing Intelliprint mailing lists.')

export const listMailingListsOutput = z.strictObject({
  data: z.array(z.looseObject({}).describe('An Intelliprint mailing list object returned in the list.')).describe('The Intelliprint objects returned for this page.').optional(),
  totalAvailable: z.int().describe('The total number of Intelliprint objects available across paginated requests.').optional(),
  hasMore: z.boolean().describe('Whether another Intelliprint page is available after this response.').optional(),
  raw: z.looseObject({}).describe('The raw Intelliprint list response payload.').optional(),
}).describe('The normalized Intelliprint mailing list response.')

export const getMailingListInput = z.strictObject({
  id: z.string().min(1).describe('The Intelliprint mailing list ID to retrieve.').optional(),
}).describe('Input parameters for retrieving an Intelliprint mailing list.')

export const getMailingListOutput = z.strictObject({
  mailingList: z.looseObject({
    id: z.string().describe('The Intelliprint object ID.').optional(),
    object: z.string().describe('The Intelliprint object type.').optional(),
    created: z.int().describe('The UNIX timestamp when the Intelliprint object was created.').optional(),
  }).describe('An Intelliprint mailing list object.').optional(),
  raw: z.looseObject({}).describe('The raw Intelliprint mailing list response payload.').optional(),
}).describe('The normalized Intelliprint mailing list response.')

export const listMailingListRecipientsInput = z.strictObject({
  mailingListId: z.string().min(1).describe('The Intelliprint mailing list ID whose recipients are listed.'),
  limit: z.int().min(1).max(1000).describe('The maximum number of Intelliprint objects to return. The official API supports 1 through 1000.').optional(),
  skip: z.int().min(0).describe('The number of Intelliprint objects to skip before returning results.').optional(),
  sortOrder: z.enum(['asc', 'desc']).describe('The sort direction for the Intelliprint list request.').optional(),
  fields: z.array(z.string().min(1).describe('One Intelliprint response field name to include.')).min(1).describe('The optional Intelliprint response fields to request.').optional(),
  sortField: z.enum(['created', 'name']).describe('The Intelliprint mailing list recipient field used to sort the list response.').optional(),
}).describe('Input parameters for listing recipients in an Intelliprint mailing list.')

export const listMailingListRecipientsOutput = z.strictObject({
  data: z.array(z.looseObject({}).describe('An Intelliprint mailing list recipient object returned in the list.')).describe('The Intelliprint objects returned for this page.').optional(),
  totalAvailable: z.int().describe('The total number of Intelliprint objects available across paginated requests.').optional(),
  hasMore: z.boolean().describe('Whether another Intelliprint page is available after this response.').optional(),
  raw: z.looseObject({}).describe('The raw Intelliprint list response payload.').optional(),
}).describe('The normalized Intelliprint mailing list recipient response.')

export const getMailingListRecipientInput = z.strictObject({
  mailingListId: z.string().min(1).describe('The Intelliprint mailing list ID containing the recipient.').optional(),
  id: z.string().min(1).describe('The Intelliprint mailing list recipient ID to retrieve.').optional(),
}).describe('Input parameters for retrieving an Intelliprint mailing list recipient.')

export const getMailingListRecipientOutput = z.strictObject({
  recipient: z.looseObject({
    id: z.string().describe('The Intelliprint object ID.').optional(),
    object: z.string().describe('The Intelliprint object type.').optional(),
    created: z.int().describe('The UNIX timestamp when the Intelliprint object was created.').optional(),
  }).describe('An Intelliprint mailing list recipient object.').optional(),
  raw: z.looseObject({}).describe('The raw Intelliprint mailing list recipient response payload.').optional(),
}).describe('The normalized Intelliprint mailing list recipient response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const intelliprintActions = {
  list_prints: {
    description: 'List Intelliprint print jobs with official pagination, sorting, and print-specific filters.',
    effect: 'read',
    inputSchema: listPrintsInput,
    outputSchema: z.toJSONSchema(listPrintsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_print: {
    description: 'Retrieve a single Intelliprint print job by ID.',
    effect: 'read',
    inputSchema: getPrintInput,
    outputSchema: z.toJSONSchema(getPrintOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_backgrounds: {
    description: 'List Intelliprint reusable backgrounds with official pagination, sorting, field selection, and team filtering.',
    effect: 'read',
    inputSchema: listBackgroundsInput,
    outputSchema: z.toJSONSchema(listBackgroundsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_background: {
    description: 'Retrieve a single Intelliprint reusable background by ID.',
    effect: 'read',
    inputSchema: getBackgroundInput,
    outputSchema: z.toJSONSchema(getBackgroundOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_mailing_lists: {
    description: 'List Intelliprint mailing lists with official pagination and sorting options.',
    effect: 'read',
    inputSchema: listMailingListsInput,
    outputSchema: z.toJSONSchema(listMailingListsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_mailing_list: {
    description: 'Retrieve a single Intelliprint mailing list by ID.',
    effect: 'read',
    inputSchema: getMailingListInput,
    outputSchema: z.toJSONSchema(getMailingListOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_mailing_list_recipients: {
    description: 'List recipients for one Intelliprint mailing list with official pagination, sorting, and field selection.',
    effect: 'read',
    inputSchema: listMailingListRecipientsInput,
    outputSchema: z.toJSONSchema(listMailingListRecipientsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_mailing_list_recipient: {
    description: 'Retrieve one recipient from an Intelliprint mailing list.',
    effect: 'read',
    inputSchema: getMailingListRecipientInput,
    outputSchema: z.toJSONSchema(getMailingListRecipientOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
