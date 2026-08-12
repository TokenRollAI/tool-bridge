/**
 * CommPeak 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listStreamsInput = z.strictObject({
  page: z.int().min(1).describe('The 1-based page number to request.').optional(),
  itemsPerPage: z.int().min(1).describe('The number of items to request per page.').optional(),
}).describe('Pagination input for listing TextPeak resources.')

export const listStreamsOutput = z.strictObject({
  streams: z.array(z.strictObject({
    id: z.int().describe('The stream identifier.').nullable(),
    streamUid: z.string().describe('The opaque stream UID.').nullable(),
    name: z.string().describe('The stream name.').nullable(),
    description: z.string().describe('The stream description.').nullable(),
    type: z.string().describe('The stream type returned by TextPeak.').nullable(),
    callerId: z.string().describe('The caller ID for voice streams when returned.').nullable(),
    ipAcl: z.string().describe('The stream IP allow-list when returned.').nullable(),
    state: z.string().describe('The stream state returned by TextPeak.').nullable(),
    streamTags: z.array(z.strictObject({
      id: z.int().describe('The tag identifier.').nullable(),
      value: z.string().describe('The tag value.').nullable(),
    }).describe('A tag attached to a TextPeak stream.')).describe('The tags returned with the stream.'),
    raw: z.looseObject({}).describe('The raw object returned by CommPeak.'),
  }).describe('A normalized TextPeak stream.')).describe('The streams returned by CommPeak.'),
}).describe('The TextPeak streams returned by CommPeak.')

export const getStreamInput = z.strictObject({
  streamId: z.int().min(1).describe('The numeric TextPeak stream ID.'),
}).describe('Input for retrieving one TextPeak stream.')

export const getStreamOutput = z.strictObject({
  stream: z.strictObject({
    id: z.int().describe('The stream identifier.').nullable(),
    streamUid: z.string().describe('The opaque stream UID.').nullable(),
    name: z.string().describe('The stream name.').nullable(),
    description: z.string().describe('The stream description.').nullable(),
    type: z.string().describe('The stream type returned by TextPeak.').nullable(),
    callerId: z.string().describe('The caller ID for voice streams when returned.').nullable(),
    ipAcl: z.string().describe('The stream IP allow-list when returned.').nullable(),
    state: z.string().describe('The stream state returned by TextPeak.').nullable(),
    streamTags: z.array(z.strictObject({
      id: z.int().describe('The tag identifier.').nullable(),
      value: z.string().describe('The tag value.').nullable(),
    }).describe('A tag attached to a TextPeak stream.')).describe('The tags returned with the stream.'),
    raw: z.looseObject({}).describe('The raw object returned by CommPeak.'),
  }).describe('A normalized TextPeak stream.'),
}).describe('The TextPeak stream returned by CommPeak.')

export const getStreamTokenInput = z.strictObject({
  streamId: z.int().min(1).describe('The numeric TextPeak stream ID.'),
}).describe('Input for retrieving one TextPeak stream token.')

export const getStreamTokenOutput = z.strictObject({
  token: z.string().describe('The stream token sent as the raw Authorization header value.'),
}).describe('The TextPeak stream token returned by CommPeak.')

export const listSendersInput = z.strictObject({
  page: z.int().min(1).describe('The 1-based page number to request.').optional(),
  itemsPerPage: z.int().min(1).describe('The number of items to request per page.').optional(),
}).describe('Pagination input for listing TextPeak resources.')

export const listSendersOutput = z.strictObject({
  senders: z.array(z.strictObject({
    id: z.int().describe('The sender identifier.').nullable(),
    name: z.string().describe('The sender display name.').nullable(),
    value: z.string().describe('The sender ID or phone number used on outbound messages.').nullable(),
    dailyLimit: z.int().describe('The maximum messages this sender may send per day.').nullable(),
    stream: z.string().describe('The stream IRI this sender belongs to when returned.').nullable(),
    senderType: z.string().describe('The sender type returned by TextPeak.').nullable(),
    status: z.string().describe('The sender approval status returned by TextPeak.').nullable(),
    raw: z.looseObject({}).describe('The raw object returned by CommPeak.'),
  }).describe('A normalized TextPeak sender identity.')).describe('The sender identities returned by CommPeak.'),
}).describe('The TextPeak sender identities returned by CommPeak.')

export const listDomainsInput = z.strictObject({
  page: z.int().min(1).describe('The 1-based page number to request.').optional(),
  itemsPerPage: z.int().min(1).describe('The number of items to request per page.').optional(),
}).describe('Pagination input for listing TextPeak resources.')

export const listDomainsOutput = z.strictObject({
  domains: z.array(z.strictObject({
    id: z.int().describe('The domain identifier.').nullable(),
    name: z.string().describe('The domain name.').nullable(),
    ip: z.string().describe('The IP address the domain should point to when returned.').nullable(),
    status: z.string().describe('The domain configuration status returned by TextPeak.').nullable(),
    raw: z.looseObject({}).describe('The raw object returned by CommPeak.'),
  }).describe('A normalized TextPeak domain.')).describe('The domains returned by CommPeak.'),
}).describe('The TextPeak domains returned by CommPeak.')

export const listMessagesInput = z.strictObject({
  type: z.string().min(1).describe('The message direction to return, such as outgoing.').optional(),
  status: z.string().min(1).describe('The delivery status filter.').optional(),
  streamId: z.int().min(1).describe('The numeric TextPeak stream ID.').optional(),
  phone: z.string().min(1).describe('The recipient phone number filter.').optional(),
  startDate: z.iso.date().describe('A date filter in YYYY-MM-DD format.').optional(),
  endDate: z.iso.date().describe('A date filter in YYYY-MM-DD format.').optional(),
  page: z.int().min(1).describe('The 1-based page number to request.').optional(),
  itemsPerPage: z.int().min(1).describe('The number of items to request per page.').optional(),
}).describe('Input filters for listing outgoing TextPeak messages.')

export const listMessagesOutput = z.strictObject({
  items: z.array(z.strictObject({
    type: z.string().describe('The message direction returned by TextPeak.').nullable(),
    messageUuid: z.string().describe('The message UUID.').nullable(),
    externalKey: z.string().describe('The vendor or external reference.').nullable(),
    sentAt: z.string().describe('The UTC time when the message was sent.').nullable(),
    deliveredAt: z.string().describe('The UTC time when delivery was confirmed.').nullable(),
    status: z.string().describe('The delivery status returned by TextPeak.').nullable(),
    sourceNumber: z.string().describe('The sender number or ID.').nullable(),
    sourceName: z.string().describe('The sender display name.').nullable(),
    destinationNumber: z.string().describe('The recipient phone number.').nullable(),
    countryCode: z.string().describe('The recipient country dialing code.').nullable(),
    countryIso: z.string().describe('The recipient ISO 3166 alpha-2 country code.').nullable(),
    countryName: z.string().describe('The recipient country name.').nullable(),
    cost: z.number().describe('The message cost returned by TextPeak.').nullable(),
    channel: z.string().describe('The delivery channel returned by TextPeak.').nullable(),
    content: z.strictObject({
      type: z.string().describe('The content type returned by TextPeak.').nullable(),
      text: z.string().describe('The message body returned by TextPeak.').nullable(),
    }).describe('The message content returned by TextPeak.').nullable(),
    conversationUuid: z.string().describe('The conversation UUID.').nullable(),
    streamId: z.string().describe('The stream identifier returned by TextPeak.').nullable(),
    campaignId: z.string().describe('The campaign identifier when returned.').nullable(),
    raw: z.looseObject({}).describe('The raw object returned by CommPeak.'),
  }).describe('A normalized outgoing TextPeak message.')).describe('The outgoing messages returned by CommPeak.'),
  page: z.strictObject({
    totalItems: z.int().describe('The total number of matching records when returned.').nullable(),
    raw: z.looseObject({}).describe('The raw object returned by CommPeak.'),
  }).describe('A normalized paginated TextPeak response.'),
}).describe('The outgoing TextPeak messages returned by CommPeak.')

export const listIncomingMessagesInput = z.strictObject({
  streamId: z.int().min(1).describe('The numeric TextPeak stream ID.').optional(),
  sender: z.string().min(1).describe('The sender phone number filter.').optional(),
  destination: z.string().min(1).describe('The destination number or sender ID filter.').optional(),
  startDate: z.iso.date().describe('A date filter in YYYY-MM-DD format.').optional(),
  endDate: z.iso.date().describe('A date filter in YYYY-MM-DD format.').optional(),
  page: z.int().min(1).describe('The 1-based page number to request.').optional(),
  itemsPerPage: z.int().min(1).describe('The number of items to request per page.').optional(),
}).describe('Input filters for listing incoming TextPeak messages.')

export const listIncomingMessagesOutput = z.strictObject({
  items: z.array(z.strictObject({
    messageUuid: z.string().describe('The message UUID.').nullable(),
    receivedAt: z.string().describe('The UTC time when the message was received.').nullable(),
    sourceNumber: z.string().describe('The sender phone number.').nullable(),
    destinationNumber: z.string().describe('The recipient number or sender ID.').nullable(),
    contactName: z.string().describe('The resolved contact name when returned.').nullable(),
    countryCode: z.string().describe('The sender country dialing code.').nullable(),
    countryIso: z.string().describe('The sender ISO 3166 alpha-2 country code.').nullable(),
    countryName: z.string().describe('The sender country name.').nullable(),
    text: z.string().describe('The incoming message text.').nullable(),
    length: z.int().describe('The incoming message body length.').nullable(),
    conversationUuid: z.string().describe('The conversation UUID.').nullable(),
    streamId: z.string().describe('The stream identifier returned by TextPeak.').nullable(),
    raw: z.looseObject({}).describe('The raw object returned by CommPeak.'),
  }).describe('A normalized incoming TextPeak message.')).describe('The incoming messages returned by CommPeak.'),
  page: z.strictObject({
    totalItems: z.int().describe('The total number of matching records when returned.').nullable(),
    raw: z.looseObject({}).describe('The raw object returned by CommPeak.'),
  }).describe('A normalized paginated TextPeak response.'),
}).describe('The incoming TextPeak messages returned by CommPeak.')

export const sendSmsInput = z.strictObject({
  streamId: z.int().min(1).describe('The numeric TextPeak stream ID.'),
  sender: z.string().min(1).describe('The top-level sender applied to every message. Omit it when each message has its own sender.').optional(),
  messages: z.array(z.strictObject({
    internalId: z.string().min(1).describe('Your unique identifier for the message, echoed in responses and delivery webhooks.').optional(),
    sender: z.string().min(1).describe('The per-message sender ID or phone number. Required when no top-level sender is provided.').optional(),
    recipientPhone: z.string().min(1).describe('The recipient phone number in international digits-only format.'),
    messageContent: z.string().min(1).describe('The SMS message body.'),
  }).describe('One SMS message to send through TextPeak.')).min(1).max(250).describe('The SMS messages to send. TextPeak supports up to 250 per request.'),
}).describe('Input for sending one or more SMS messages through TextPeak.')

export const sendSmsOutput = z.strictObject({
  status: z.boolean().describe('Whether TextPeak accepted the batch for delivery.'),
  taskId: z.string().describe('The accepted batch task ID.').nullable(),
  messages: z.array(z.strictObject({
    internalId: z.string().describe('The internal ID supplied in the request.').nullable(),
    messageUuid: z.string().describe('The platform-assigned message UUID.').nullable(),
    conversationUuid: z.string().describe('The conversation UUID.').nullable(),
    error: z.string().describe('The per-message error code when the message failed.').nullable(),
    details: z.string().describe('The per-message failure detail when returned.').nullable(),
    raw: z.looseObject({}).describe('The raw object returned by CommPeak.'),
  }).describe('One TextPeak SMS send result.')).describe('The per-message acceptance results returned by TextPeak.'),
  raw: z.looseObject({}).describe('The raw object returned by CommPeak.'),
}).describe('The SMS send acceptance response returned by TextPeak.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const commpeakActions = {
  list_streams: {
    description: 'List TextPeak streams in the CommPeak account.',
    effect: 'read',
    inputSchema: listStreamsInput,
    outputSchema: z.toJSONSchema(listStreamsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_stream: {
    description: 'Retrieve one TextPeak stream by ID.',
    effect: 'read',
    inputSchema: getStreamInput,
    outputSchema: z.toJSONSchema(getStreamOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_stream_token: {
    description: 'Retrieve the stream token used to call TextPeak messaging endpoints.',
    effect: 'read',
    inputSchema: getStreamTokenInput,
    outputSchema: z.toJSONSchema(getStreamTokenOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_senders: {
    description: 'List TextPeak sender identities in the CommPeak account.',
    effect: 'read',
    inputSchema: listSendersInput,
    outputSchema: z.toJSONSchema(listSendersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_domains: {
    description: 'List TextPeak domains in the CommPeak account.',
    effect: 'read',
    inputSchema: listDomainsInput,
    outputSchema: z.toJSONSchema(listDomainsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_messages: {
    description: 'List outgoing TextPeak messages with optional filters.',
    effect: 'read',
    inputSchema: listMessagesInput,
    outputSchema: z.toJSONSchema(listMessagesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_incoming_messages: {
    description: 'List incoming TextPeak messages with optional filters.',
    effect: 'read',
    inputSchema: listIncomingMessagesInput,
    outputSchema: z.toJSONSchema(listIncomingMessagesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_sms: {
    description: 'Send one or more SMS messages through a TextPeak stream, fetching the stream token with the API key before sending.',
    effect: 'write',
    inputSchema: sendSmsInput,
    outputSchema: z.toJSONSchema(sendSmsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
