/**
 * Mocean 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getBalanceInput = z.strictObject({}).describe('Input parameters for retrieving Mocean account balance.')

export const getBalanceOutput = z.strictObject({
  status: z.int().describe('Mocean response status code. Zero indicates a successful request.'),
  value: z.number().describe('Current Mocean account balance value returned by Mocean.'),
}).describe('Mocean account balance response.')

export const listPricingInput = z.strictObject({
  type: z.enum(['sms', 'number-lookup', 'verify']).describe('Mocean service type to retrieve pricing for.').optional(),
  mcc: z.string().min(1).describe('Mobile Country Code to filter pricing by destination.').optional(),
  mnc: z.string().min(1).describe('Mobile Network Code to filter pricing by operator.').optional(),
}).describe('Input parameters for retrieving Mocean account pricing.')

export const listPricingOutput = z.strictObject({
  status: z.int().describe('Mocean response status code. Zero indicates a successful request.'),
  destinations: z.array(z.looseObject({
    country: z.string().min(1).describe('Destination country name returned by Mocean.').optional(),
    operator: z.string().min(1).describe('Destination operator name returned by Mocean.').optional(),
    mcc: z.string().min(1).describe('Mobile Country Code returned by Mocean.').optional(),
    mnc: z.string().min(1).describe('Mobile Network Code returned by Mocean.').optional(),
    price: z.string().min(1).describe('Price returned by Mocean for this destination.').optional(),
    currency: z.string().min(1).describe('Currency code returned by Mocean for the price.').optional(),
  }).describe('Pricing entry for one Mocean destination or operator.')).describe('Pricing entries returned by Mocean for the requested destination filters.'),
}).describe('Mocean account pricing response.')

export const getMessageStatusInput = z.strictObject({
  messageId: z.string().min(1).describe('Mocean message ID returned by send_sms.'),
}).describe('Input parameters for retrieving the delivery status of an outbound Mocean SMS message.')

export const getMessageStatusOutput = z.strictObject({
  status: z.int().describe('Mocean response status code. Zero indicates a successful request.'),
  messageStatus: z.int().describe('Mocean delivery status code for the message. Documented values include delivered, failed, expired, pending, and not found.'),
  messageId: z.string().min(1).describe('Mocean message identifier.'),
  creditDeducted: z.string().min(1).describe('Credits deducted for the message.'),
}).describe('Mocean outbound SMS message status response.')

export const lookupNumberInput = z.strictObject({
  to: z.string().min(1).describe('Phone number to look up, including country code.'),
}).describe('Input parameters for performing a synchronous Mocean number lookup.')

export const lookupNumberOutput = z.strictObject({
  status: z.int().describe('Mocean response status code. Zero indicates a successful request.'),
  messageId: z.string().min(1).describe('Mocean message identifier for the lookup.').optional(),
  to: z.string().min(1).describe('Phone number returned by Mocean for the lookup.').optional(),
  currentCarrier: z.looseObject({
    country: z.string().min(1).describe('Carrier country returned by Mocean.'),
    name: z.string().min(1).describe('Carrier name returned by Mocean.'),
    networkCode: z.string().min(1).describe('Carrier network code returned by Mocean.'),
    mcc: z.string().min(1).describe('Carrier Mobile Country Code returned by Mocean.'),
    mnc: z.string().min(1).describe('Carrier Mobile Network Code returned by Mocean.'),
  }).describe('Carrier information returned by Mocean.').optional(),
  originalCarrier: z.looseObject({
    country: z.string().min(1).describe('Carrier country returned by Mocean.'),
    name: z.string().min(1).describe('Carrier name returned by Mocean.'),
    networkCode: z.string().min(1).describe('Carrier network code returned by Mocean.'),
    mcc: z.string().min(1).describe('Carrier Mobile Country Code returned by Mocean.'),
    mnc: z.string().min(1).describe('Carrier Mobile Network Code returned by Mocean.'),
  }).describe('Carrier information returned by Mocean.').optional(),
  ported: z.enum(['ported', 'not_ported', 'unknown']).describe('Mocean porting status for the phone number.').optional(),
}).describe('Synchronous Mocean number lookup response.')

export const sendSmsInput = z.strictObject({
  from: z.string().min(1).describe('SMS sender ID shown to the recipient.'),
  to: z.string().min(1).describe('Recipient phone number including country code.'),
  text: z.string().min(1).describe('SMS message text to send to the recipient.'),
  deliveryReportUrl: z.url().describe('Callback URL that Mocean should call with delivery report updates.').optional(),
}).describe('Input parameters for sending an SMS message with Mocean.')

export const sendSmsOutput = z.strictObject({
  messages: z.array(z.looseObject({
    status: z.int().describe('Mocean response status code. Zero indicates a successful request.'),
    receiver: z.string().min(1).describe('Phone number that Mocean accepted for this message.').optional(),
    messageId: z.string().min(1).describe('Mocean message identifier returned for status queries.').optional(),
    errorMessage: z.string().min(1).describe('Mocean error message when the recipient submission failed.').optional(),
  }).describe('Result for one SMS recipient returned by Mocean.')).describe('Per-recipient SMS submission results returned by Mocean.'),
}).describe('Mocean SMS submission response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const moceanActions = {
  get_balance: {
    description: 'Retrieve the current Mocean account balance.',
    effect: 'read',
    inputSchema: getBalanceInput,
    outputSchema: z.toJSONSchema(getBalanceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_pricing: {
    description: 'Retrieve Mocean account pricing for SMS, number lookup, or verify services.',
    effect: 'read',
    inputSchema: listPricingInput,
    outputSchema: z.toJSONSchema(listPricingOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_message_status: {
    description: 'Retrieve the delivery status for a Mocean SMS message.',
    effect: 'read',
    inputSchema: getMessageStatusInput,
    outputSchema: z.toJSONSchema(getMessageStatusOutput, { io: 'output', unrepresentable: 'any' }),
  },
  lookup_number: {
    description: 'Look up carrier information for a phone number through Mocean.',
    effect: 'write',
    inputSchema: lookupNumberInput,
    outputSchema: z.toJSONSchema(lookupNumberOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_sms: {
    description: 'Send an SMS message through Mocean.',
    effect: 'write',
    inputSchema: sendSmsInput,
    outputSchema: z.toJSONSchema(sendSmsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
