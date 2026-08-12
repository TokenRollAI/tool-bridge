/**
 * Woodpecker.co 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listUsersInput = z.strictObject({
  page: z.int().min(0).describe('The zero-based results page to request.').optional(),
  sort: z.enum(['+id', '-id']).describe('The user sort order supported by Woodpecker.').optional(),
}).describe('The input payload for listing Woodpecker users.')

export const listUsersOutput = z.strictObject({
  users: z.array(z.strictObject({
    id: z.int().describe('The Woodpecker user ID.').nullable().optional(),
    name: z.string().describe('The user\'s full name.').nullable().optional(),
    email: z.string().describe('The user\'s email address.').nullable().optional(),
    role: z.string().describe('The user\'s role in the account.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw object returned by Woodpecker.').optional(),
  }).describe('A normalized Woodpecker user.')).describe('The users returned by Woodpecker.').optional(),
  pagination: z.strictObject({
    total_elements: z.int().describe('The total number of matching elements.').nullable().optional(),
    total_pages: z.int().describe('The total number of result pages.').nullable().optional(),
    current_page_number: z.int().describe('The current page number returned by Woodpecker.').nullable().optional(),
    page_size: z.int().describe('The maximum number of items in the page.').nullable().optional(),
  }).describe('Woodpecker pagination metadata.').optional(),
  raw: z.looseObject({}).describe('The raw object returned by Woodpecker.').optional(),
}).describe('The response returned when listing Woodpecker users.')

export const listCampaignsInput = z.strictObject({
  status: z.enum(['RUNNING', 'DRAFT', 'STOPPED', 'PAUSED', 'EDITED', 'COMPLETED']).describe('The campaign status to filter by.').optional(),
}).describe('The input payload for listing Woodpecker campaigns.')

export const listCampaignsOutput = z.strictObject({
  campaigns: z.array(z.strictObject({
    id: z.int().describe('The Woodpecker campaign ID.').nullable().optional(),
    name: z.string().describe('The campaign name.').nullable().optional(),
    status: z.string().describe('The campaign status.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw object returned by Woodpecker.').optional(),
  }).describe('A normalized Woodpecker campaign.')).describe('The campaigns returned by Woodpecker.').optional(),
  raw: z.union([z.array(z.looseObject({}).describe('The raw object returned by Woodpecker.')).describe('The raw objects returned by Woodpecker.'), z.looseObject({}).describe('The raw object returned by Woodpecker.')]).describe('The raw list payload returned by a Woodpecker v1 endpoint.').optional(),
}).describe('The response returned when listing Woodpecker campaigns.')

export const getCampaignInput = z.strictObject({
  campaign_id: z.int().min(1).describe('The Woodpecker campaign ID.'),
}).describe('The input payload for getting one Woodpecker campaign.')

export const getCampaignOutput = z.strictObject({
  campaign: z.strictObject({
    id: z.int().describe('The Woodpecker campaign ID.').nullable().optional(),
    name: z.string().describe('The campaign name.').nullable().optional(),
    status: z.string().describe('The campaign status.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw object returned by Woodpecker.').optional(),
  }).describe('A normalized Woodpecker campaign.').optional(),
}).describe('The response returned when getting one Woodpecker campaign.')

export const getCampaignStatisticsInput = z.strictObject({
  campaign_id: z.int().min(1).describe('The Woodpecker campaign ID.'),
}).describe('The input payload for getting Woodpecker campaign statistics.')

export const getCampaignStatisticsOutput = z.strictObject({
  statistics: z.looseObject({}).describe('The campaign statistics object returned by Woodpecker.').optional(),
  raw: z.looseObject({}).describe('The raw object returned by Woodpecker.').optional(),
}).describe('The response returned when getting Woodpecker campaign statistics.')

export const listProspectsInput = z.strictObject({
  page: z.int().min(1).describe('The one-based results page to request.').optional(),
  per_page: z.int().min(1).max(1000).describe('The number of prospects per page, up to 1000.').optional(),
  sort: z.string().min(1).describe('The prospects sort expression, such as +company.').optional(),
  ids: z.array(z.int().min(1).describe('One Woodpecker prospect ID.')).min(1).describe('The Woodpecker prospect IDs to request; the connector serializes them for the official id filter.').optional(),
  status: z.enum(['ACTIVE', 'BOUNCED', 'REPLIED', 'BLACKLIST', 'INVALID']).describe('The global prospect status to filter by.').optional(),
  contacted: z.boolean().describe('Whether to return prospects that have ever been contacted.').optional(),
  interested: z.enum(['INTERESTED', 'MAYBE-LATER', 'NOT-INTERESTED', 'NOT-MARKED']).describe('The campaign interest level to filter prospects by.').optional(),
  activity: z.enum(['OPENED', 'NOT-OPENED', 'CLICKED', 'NOT-CLICKED']).describe('The prospect activity filter.').optional(),
  diff: z.string().min(1).describe('The Woodpecker diff expression, such as activity>2026-01-15 08:00:00; URL encoding is handled by the connector.').optional(),
}).describe('The input payload for listing Woodpecker prospects.')

export const listProspectsOutput = z.strictObject({
  prospects: z.array(z.strictObject({
    id: z.int().describe('The Woodpecker prospect ID.').nullable().optional(),
    email: z.string().describe('The prospect email address.').nullable().optional(),
    status: z.string().describe('The prospect global status.').nullable().optional(),
    first_name: z.string().describe('The prospect first name when returned.').nullable().optional(),
    last_name: z.string().describe('The prospect last name when returned.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw object returned by Woodpecker.').optional(),
  }).describe('A normalized Woodpecker prospect.')).describe('The prospects returned by Woodpecker.').optional(),
  raw: z.union([z.array(z.looseObject({}).describe('The raw object returned by Woodpecker.')).describe('The raw objects returned by Woodpecker.'), z.looseObject({}).describe('The raw object returned by Woodpecker.')]).describe('The raw list payload returned by a Woodpecker v1 endpoint.').optional(),
}).describe('The response returned when listing Woodpecker prospects.')

export const listMailboxesInput = z.strictObject({}).describe('The input payload for listing Woodpecker mailboxes.')

export const listMailboxesOutput = z.strictObject({
  mailboxes: z.array(z.strictObject({
    id: z.int().describe('The Woodpecker mailbox configuration ID.').nullable().optional(),
    type: z.string().describe('The mailbox configuration type, such as SMTP or IMAP.').nullable().optional(),
    email: z.string().describe('The mailbox email address.').nullable().optional(),
    provider: z.string().describe('The email provider name returned by Woodpecker.').nullable().optional(),
    login: z.string().describe('The mailbox login returned by Woodpecker.').nullable().optional(),
    details: z.looseObject({}).describe('The raw Woodpecker mailbox details object.').optional(),
    raw: z.looseObject({}).describe('The raw object returned by Woodpecker.').optional(),
  }).describe('A normalized Woodpecker mailbox.')).describe('The mailboxes returned by Woodpecker.').optional(),
  raw: z.array(z.looseObject({}).describe('The raw object returned by Woodpecker.')).describe('The raw mailbox objects returned by Woodpecker.').optional(),
}).describe('The response returned when listing Woodpecker mailboxes.')

export const getMailboxInput = z.strictObject({
  mailbox_id: z.int().min(1).describe('The Woodpecker mailbox configuration ID.'),
}).describe('The input payload for getting one Woodpecker mailbox.')

export const getMailboxOutput = z.strictObject({
  mailbox: z.strictObject({
    id: z.int().describe('The Woodpecker mailbox configuration ID.').nullable().optional(),
    type: z.string().describe('The mailbox configuration type, such as SMTP or IMAP.').nullable().optional(),
    email: z.string().describe('The mailbox email address.').nullable().optional(),
    provider: z.string().describe('The email provider name returned by Woodpecker.').nullable().optional(),
    login: z.string().describe('The mailbox login returned by Woodpecker.').nullable().optional(),
    details: z.looseObject({}).describe('The raw Woodpecker mailbox details object.').optional(),
    raw: z.looseObject({}).describe('The raw object returned by Woodpecker.').optional(),
  }).describe('A normalized Woodpecker mailbox.').optional(),
}).describe('The response returned when getting one Woodpecker mailbox.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const woodpeckerCoActions = {
  list_users: {
    description: 'List active Woodpecker users in the authenticated account.',
    effect: 'read',
    inputSchema: listUsersInput,
    outputSchema: z.toJSONSchema(listUsersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_campaigns: {
    description: 'List Woodpecker campaigns, optionally filtered by campaign status.',
    effect: 'read',
    inputSchema: listCampaignsInput,
    outputSchema: z.toJSONSchema(listCampaignsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_campaign: {
    description: 'Get Woodpecker campaign settings and content by campaign ID.',
    effect: 'read',
    inputSchema: getCampaignInput,
    outputSchema: z.toJSONSchema(getCampaignOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_campaign_statistics: {
    description: 'Get Woodpecker statistics for one campaign by campaign ID.',
    effect: 'read',
    inputSchema: getCampaignStatisticsInput,
    outputSchema: z.toJSONSchema(getCampaignStatisticsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_prospects: {
    description: 'List prospects from the Woodpecker prospect database with optional filters.',
    effect: 'read',
    inputSchema: listProspectsInput,
    outputSchema: z.toJSONSchema(listProspectsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_mailboxes: {
    description: 'List Woodpecker mailboxes connected to the authenticated account.',
    effect: 'read',
    inputSchema: listMailboxesInput,
    outputSchema: z.toJSONSchema(listMailboxesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_mailbox: {
    description: 'Get one Woodpecker mailbox by mailbox configuration ID.',
    effect: 'read',
    inputSchema: getMailboxInput,
    outputSchema: z.toJSONSchema(getMailboxOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
