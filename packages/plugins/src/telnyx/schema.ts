/**
 * Telnyx 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const sendMessageInput = z.strictObject({
  to: z.string().min(1).regex(new RegExp('\\S')).describe('The sending or receiving address, such as an E.164 phone number, alphanumeric sender ID, short code, or number pool.'),
  from: z.string().min(1).regex(new RegExp('\\S')).describe('The sending or receiving address, such as an E.164 phone number, alphanumeric sender ID, short code, or number pool.').optional(),
  messagingProfileId: z.uuid().describe('The Telnyx messaging profile ID.').optional(),
  text: z.string().min(1).regex(new RegExp('\\S')).describe('The SMS message body.').optional(),
  subject: z.string().min(1).regex(new RegExp('\\S')).describe('The MMS message subject.').optional(),
  mediaUrls: z.array(z.url().describe('One media URL for the MMS message.')).min(1).describe('The media URLs Telnyx should attach to an MMS message.').optional(),
  webhookUrl: z.url().describe('The URL where Telnyx should send message webhooks.').optional(),
  webhookFailoverUrl: z.url().describe('The failover URL Telnyx should use if the primary message webhook URL fails.').optional(),
  useProfileWebhooks: z.boolean().describe('Whether Telnyx should use webhooks configured on the messaging profile.').optional(),
  type: z.enum(['SMS', 'MMS']).describe('The protocol Telnyx should use for the message.').optional(),
  autoDetect: z.boolean().describe('Whether Telnyx should detect SMS messages that exceed a recommended part limit.').optional(),
  sendAt: z.iso.datetime({ offset: true }).describe('The ISO 8601 timestamp when Telnyx should send the message.').nullable().optional(),
  encoding: z.enum(['auto', 'gsm7', 'ucs2']).describe('The encoding Telnyx should use for the message.').optional(),
}).describe('The input payload for sending a Telnyx message.')

export const sendMessageOutput = z.strictObject({
  data: z.looseObject({
    id: z.uuid().describe('The Telnyx resource ID.'),
    record_type: z.string().describe('The Telnyx resource type.'),
  }).describe('The Telnyx resource object returned by the API.'),
}).describe('The response returned when Telnyx sends a message.')

export const retrieveMessageInput = z.strictObject({
  id: z.uuid().describe('The Telnyx message ID.'),
}).describe('The input payload for retrieving a Telnyx message.')

export const retrieveMessageOutput = z.strictObject({
  data: z.looseObject({
    id: z.uuid().describe('The Telnyx resource ID.'),
    record_type: z.string().describe('The Telnyx resource type.'),
  }).describe('The Telnyx resource object returned by the API.'),
}).describe('The response returned when retrieving a Telnyx message.')

export const listMessagingProfilesInput = z.strictObject({
  filterName: z.string().min(1).regex(new RegExp('\\S')).describe('The profile name filter passed as filter[name].').optional(),
  filterNameEq: z.string().min(1).regex(new RegExp('\\S')).describe('The exact profile name filter.').optional(),
  filterNameContains: z.string().min(1).regex(new RegExp('\\S')).describe('The partial profile name filter.').optional(),
  pageNumber: z.int().min(1).describe('The Telnyx page number to load.').optional(),
  pageSize: z.int().min(1).max(250).describe('The number of Telnyx profiles to load per page.').optional(),
}).describe('The input payload for listing Telnyx messaging profiles.')

export const listMessagingProfilesOutput = z.strictObject({
  data: z.array(z.looseObject({
    id: z.uuid().describe('The Telnyx resource ID.'),
    record_type: z.string().describe('The Telnyx resource type.'),
  }).describe('The Telnyx resource object returned by the API.')).describe('The Telnyx messaging profiles returned by the API.'),
  meta: z.looseObject({
    page_number: z.int().describe('The current Telnyx page number.').optional(),
    page_size: z.int().describe('The current Telnyx page size.').optional(),
    total_pages: z.int().describe('The total number of pages available from Telnyx.').optional(),
    total_results: z.int().describe('The total number of matching Telnyx resources.').optional(),
  }).describe('The pagination metadata returned by Telnyx.'),
}).describe('The response returned when listing Telnyx messaging profiles.')

export const retrieveMessagingProfileInput = z.strictObject({
  id: z.uuid().describe('The Telnyx messaging profile ID.'),
}).describe('The input payload for retrieving a Telnyx messaging profile.')

export const retrieveMessagingProfileOutput = z.strictObject({
  data: z.looseObject({
    id: z.uuid().describe('The Telnyx resource ID.'),
    record_type: z.string().describe('The Telnyx resource type.'),
  }).describe('The Telnyx resource object returned by the API.'),
}).describe('The response returned when retrieving a Telnyx messaging profile.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const telnyxActions = {
  send_message: {
    description: 'Send an SMS or MMS message through Telnyx Messaging.',
    effect: 'write',
    inputSchema: sendMessageInput,
    outputSchema: z.toJSONSchema(sendMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  retrieve_message: {
    description: 'Retrieve a Telnyx message by ID.',
    effect: 'read',
    inputSchema: retrieveMessageInput,
    outputSchema: z.toJSONSchema(retrieveMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_messaging_profiles: {
    description: 'List Telnyx messaging profiles with optional name filters and pagination.',
    effect: 'read',
    inputSchema: listMessagingProfilesInput,
    outputSchema: z.toJSONSchema(listMessagingProfilesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  retrieve_messaging_profile: {
    description: 'Retrieve a Telnyx messaging profile by ID.',
    effect: 'read',
    inputSchema: retrieveMessagingProfileInput,
    outputSchema: z.toJSONSchema(retrieveMessagingProfileOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
