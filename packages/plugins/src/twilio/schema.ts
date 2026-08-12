/**
 * Twilio 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getAccountInput = z.strictObject({}).describe('No input is required for this action.')

export const getAccountOutput = z.strictObject({
  accountSid: z.string().describe('The Twilio account SID.'),
  friendlyName: z.string().describe('The friendly name of the Twilio account.').nullable(),
  status: z.string().describe('The current status of the Twilio account.').nullable(),
  type: z.string().describe('The Twilio account type.').nullable(),
}).describe('The normalized Twilio account payload.')

export const listUsageRecordsInput = z.strictObject({
  category: z.string().describe('The Twilio usage category to filter by.').optional(),
  startDate: z.iso.date().describe('The inclusive start date in YYYY-MM-DD format.').optional(),
  endDate: z.iso.date().describe('The inclusive end date in YYYY-MM-DD format.').optional(),
  pageSize: z.int().min(1).describe('The maximum number of records to return in one page.').optional(),
}).describe('The input payload for listing Twilio usage records.')

export const listUsageRecordsOutput = z.strictObject({
  usageRecords: z.array(z.strictObject({
    accountSid: z.string().describe('The Twilio account SID that owns the usage.').nullable().optional(),
    category: z.string().describe('The Twilio usage category.').nullable().optional(),
    count: z.string().describe('The number of units consumed in the record.').nullable().optional(),
    countUnit: z.string().describe('The unit for the usage count.').nullable().optional(),
    usage: z.string().describe('The aggregated usage amount.').nullable().optional(),
    usageUnit: z.string().describe('The unit for the aggregated usage amount.').nullable().optional(),
    price: z.string().describe('The billed price for the usage record.').nullable().optional(),
    priceUnit: z.string().describe('The currency unit for the billed price.').nullable().optional(),
    startDate: z.string().describe('The inclusive start date of the usage record.').nullable().optional(),
    endDate: z.string().describe('The inclusive end date of the usage record.').nullable().optional(),
  }).describe('One normalized Twilio usage record.')).describe('The normalized usage records returned by Twilio.'),
  page: z.int().describe('The current Twilio result page.').nullable(),
  pageSize: z.int().describe('The Twilio page size for this result.').nullable(),
  nextPageUri: z.string().describe('The next page URI returned by Twilio, if any.').nullable(),
}).describe('The output payload for listing Twilio usage records.')

export const listMessagesInput = z.strictObject({
  to: z.string().describe('Only include messages sent to this phone number.').optional(),
  from: z.string().describe('Only include messages sent from this phone number.').optional(),
  pageSize: z.int().min(1).describe('The maximum number of records to return in one page.').optional(),
  pageToken: z.string().describe('The Twilio page token used to continue a previous listing.').optional(),
}).describe('The input payload for listing Twilio messages.')

export const listMessagesOutput = z.strictObject({
  messages: z.array(z.strictObject({
    messageSid: z.string().describe('The Twilio message SID.').optional(),
    accountSid: z.string().describe('The Twilio account SID that owns the message.').nullable().optional(),
    status: z.string().describe('The delivery status of the message.').nullable().optional(),
    to: z.string().describe('The destination phone number.').nullable().optional(),
    from: z.string().describe('The sender phone number.').nullable().optional(),
    body: z.string().describe('The text body of the message.').nullable().optional(),
  }).describe('The normalized Twilio message payload.')).describe('The normalized Twilio messages.'),
  nextPageUri: z.string().describe('The next page URI returned by Twilio, if any.').nullable(),
}).describe('The output payload for listing Twilio messages.')

export const getMessageInput = z.strictObject({
  messageSid: z.string().min(1).describe('The Twilio message SID to fetch.'),
}).describe('The input payload for fetching one Twilio message.')

export const getMessageOutput = z.strictObject({
  messageSid: z.string().describe('The Twilio message SID.').optional(),
  accountSid: z.string().describe('The Twilio account SID that owns the message.').nullable().optional(),
  status: z.string().describe('The delivery status of the message.').nullable().optional(),
  to: z.string().describe('The destination phone number.').nullable().optional(),
  from: z.string().describe('The sender phone number.').nullable().optional(),
  body: z.string().describe('The text body of the message.').nullable().optional(),
}).describe('The normalized Twilio message payload.')

export const sendMessageInput = z.strictObject({
  to: z.string().min(1).describe('The destination phone number in E.164 format.'),
  from: z.string().min(1).describe('The Twilio phone number sending the message.'),
  body: z.string().min(1).describe('The text body of the outbound message.'),
}).describe('The input payload for sending a Twilio message.')

export const sendMessageOutput = z.strictObject({
  messageSid: z.string().describe('The Twilio message SID.').optional(),
  accountSid: z.string().describe('The Twilio account SID that owns the message.').nullable().optional(),
  status: z.string().describe('The delivery status of the message.').nullable().optional(),
  to: z.string().describe('The destination phone number.').nullable().optional(),
  from: z.string().describe('The sender phone number.').nullable().optional(),
  body: z.string().describe('The text body of the message.').nullable().optional(),
}).describe('The normalized Twilio message payload.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const twilioActions = {
  get_account: {
    description: 'Fetch the current Twilio account profile for the connected credential.',
    effect: 'read',
    inputSchema: getAccountInput,
    outputSchema: z.toJSONSchema(getAccountOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_usage_records: {
    description: 'List Twilio usage records for the connected account.',
    effect: 'read',
    inputSchema: listUsageRecordsInput,
    outputSchema: z.toJSONSchema(listUsageRecordsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_messages: {
    description: 'List SMS or MMS messages for the connected Twilio account.',
    effect: 'read',
    inputSchema: listMessagesInput,
    outputSchema: z.toJSONSchema(listMessagesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_message: {
    description: 'Fetch one Twilio message by message SID.',
    effect: 'read',
    inputSchema: getMessageInput,
    outputSchema: z.toJSONSchema(getMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_message: {
    description: 'Send an outbound SMS or MMS message with Twilio.',
    effect: 'write',
    inputSchema: sendMessageInput,
    outputSchema: z.toJSONSchema(sendMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
