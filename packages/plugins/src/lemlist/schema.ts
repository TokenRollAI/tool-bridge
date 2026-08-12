/**
 * lemlist 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getTeamInput = z.strictObject({}).describe('Input parameters for retrieving the lemlist team.')

export const getTeamOutput = z.strictObject({
  team: z.looseObject({
    _id: z.string().describe('Unique team identifier.'),
    name: z.string().describe('Team name.'),
    userIds: z.array(z.string().describe('User ID.')).describe('User IDs in this team.').optional(),
    createdBy: z.string().describe('User ID who created the team.').optional(),
    createdAt: z.string().describe('Date and time when the team was created.').optional(),
    beta: z.array(z.string().describe('Beta feature name.')).describe('Beta features enabled for the team.').optional(),
    pictureId: z.string().describe('Team profile picture file ID.').optional(),
    customDomain: z.string().describe('Custom domain for the team.').optional(),
    raw: z.looseObject({}).describe('Raw team payload returned by lemlist.').optional(),
  }).describe('lemlist team information.').optional(),
}).describe('lemlist team response.')

export const listCampaignsInput = z.strictObject({
  limit: z.int().min(1).max(100).describe('Number of campaigns to retrieve. lemlist allows up to 100.').optional(),
  offset: z.int().min(0).describe('Offset from the start for pagination.').optional(),
  page: z.int().min(1).describe('Page number to retrieve.').optional(),
  sortBy: z.enum(['createdAt']).describe('Field by which to sort campaigns.').optional(),
  sortOrder: z.enum(['asc', 'desc']).describe('Sort direction for campaign listing.').optional(),
  status: z.enum(['running', 'draft', 'archived', 'ended', 'paused', 'errors']).describe('Campaign status filter supported by lemlist.').optional(),
  createdBy: z.string().min(1).describe('Creator user ID used to filter campaigns.').optional(),
}).describe('Input parameters for listing lemlist campaigns.')

export const listCampaignsOutput = z.strictObject({
  campaigns: z.array(z.looseObject({
    _id: z.string().describe('Unique campaign identifier.'),
    name: z.string().describe('Campaign name.'),
    labels: z.array(z.string().describe('Campaign label.')).describe('Categorization labels.').optional(),
    createdAt: z.string().describe('Creation timestamp.').optional(),
    createdBy: z.string().describe('Creator user ID.').optional(),
    status: z.string().describe('Campaign status returned by lemlist.').optional(),
    sequenceId: z.string().describe('Main sequence ID.').optional(),
    scheduleIds: z.array(z.string().describe('Schedule ID.')).describe('Associated schedule IDs.').optional(),
    teamId: z.string().describe('ID of the team that owns this campaign.').optional(),
    hasError: z.boolean().describe('Whether the campaign has errors.').optional(),
    errors: z.array(z.string().describe('Campaign error message.')).describe('Campaign error messages.').optional(),
    creator: z.looseObject({
      userId: z.string().describe('Creator user ID.').optional(),
      userEmail: z.email().describe('Creator email address.').optional(),
    }).describe('Campaign creator information.').optional(),
    senders: z.array(z.looseObject({
      id: z.string().describe('Sender user ID.').optional(),
      email: z.email().describe('Sender email address.').optional(),
      sendUserMailboxId: z.string().describe('Mailbox ID used for sending.').optional(),
    }).describe('Campaign sender configuration.')).describe('Campaign senders configuration.').optional(),
    raw: z.looseObject({}).describe('Raw campaign payload returned by lemlist.').optional(),
  }).describe('lemlist campaign summary or detail.')).describe('Campaigns returned by lemlist.').optional(),
}).describe('lemlist campaign list response.')

export const getCampaignInput = z.strictObject({
  campaignId: z.string().min(1).describe('Unique identifier of the campaign to retrieve.').optional(),
}).describe('Input parameters for retrieving a lemlist campaign.')

export const getCampaignOutput = z.strictObject({
  campaign: z.looseObject({
    _id: z.string().describe('Unique campaign identifier.'),
    name: z.string().describe('Campaign name.'),
    labels: z.array(z.string().describe('Campaign label.')).describe('Categorization labels.').optional(),
    createdAt: z.string().describe('Creation timestamp.').optional(),
    createdBy: z.string().describe('Creator user ID.').optional(),
    status: z.string().describe('Campaign status returned by lemlist.').optional(),
    sequenceId: z.string().describe('Main sequence ID.').optional(),
    scheduleIds: z.array(z.string().describe('Schedule ID.')).describe('Associated schedule IDs.').optional(),
    teamId: z.string().describe('ID of the team that owns this campaign.').optional(),
    hasError: z.boolean().describe('Whether the campaign has errors.').optional(),
    errors: z.array(z.string().describe('Campaign error message.')).describe('Campaign error messages.').optional(),
    creator: z.looseObject({
      userId: z.string().describe('Creator user ID.').optional(),
      userEmail: z.email().describe('Creator email address.').optional(),
    }).describe('Campaign creator information.').optional(),
    senders: z.array(z.looseObject({
      id: z.string().describe('Sender user ID.').optional(),
      email: z.email().describe('Sender email address.').optional(),
      sendUserMailboxId: z.string().describe('Mailbox ID used for sending.').optional(),
    }).describe('Campaign sender configuration.')).describe('Campaign senders configuration.').optional(),
    raw: z.looseObject({}).describe('Raw campaign payload returned by lemlist.').optional(),
  }).describe('lemlist campaign summary or detail.').optional(),
}).describe('lemlist campaign response.')

export const listCampaignLeadsInput = z.strictObject({
  campaignId: z.string().min(1).describe('Unique identifier of the campaign whose leads should be listed.'),
  state: z.string().min(1).describe('Lead state filter such as scanned, contacted, or interested.').optional(),
  limit: z.int().min(1).max(500).describe('Maximum number of leads to return. lemlist allows up to 500.').optional(),
}).describe('Input parameters for listing leads in a lemlist campaign.')

export const listCampaignLeadsOutput = z.strictObject({
  leads: z.array(z.looseObject({
    _id: z.string().describe('Unique lead identifier.'),
    contactId: z.string().describe('Associated contact identifier.').optional(),
    state: z.string().describe('Current lead state.').optional(),
    raw: z.looseObject({}).describe('Raw lead payload returned by lemlist.').optional(),
  }).describe('lemlist lead summary.')).describe('Leads returned by lemlist.').optional(),
}).describe('lemlist campaign leads response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const lemlistActions = {
  get_team: {
    description: 'Retrieve information about the lemlist team for the API key.',
    effect: 'read',
    inputSchema: getTeamInput,
    outputSchema: z.toJSONSchema(getTeamOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_campaigns: {
    description: 'List lemlist campaigns with optional pagination and status filters.',
    effect: 'read',
    inputSchema: listCampaignsInput,
    outputSchema: z.toJSONSchema(listCampaignsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_campaign: {
    description: 'Retrieve one lemlist campaign by campaign ID.',
    effect: 'read',
    inputSchema: getCampaignInput,
    outputSchema: z.toJSONSchema(getCampaignOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_campaign_leads: {
    description: 'List leads from a lemlist campaign with optional state filtering.',
    effect: 'read',
    inputSchema: listCampaignLeadsInput,
    outputSchema: z.toJSONSchema(listCampaignLeadsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
