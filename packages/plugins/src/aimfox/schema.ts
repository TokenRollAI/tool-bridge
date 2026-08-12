/**
 * Aimfox 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listCampaignsInput = z.strictObject({
  outreach_type: z.enum(['inbound', 'outbound']).describe('The outreach type to filter campaigns by.').optional(),
  accepts_profiles: z.boolean().describe('Whether to return only campaigns that accept profile inserts.').optional(),
}).describe('Input for listing Aimfox campaigns.')

export const listCampaignsOutput = z.strictObject({
  status: z.string().describe('The status returned by Aimfox.').nullable().optional(),
  campaigns: z.array(z.looseObject({}).describe('A raw object returned by Aimfox.')).describe('Raw objects returned by Aimfox.').optional(),
}).describe('The campaigns returned by Aimfox.')

export const getCampaignInput = z.strictObject({
  campaign_id: z.string().min(1).describe('The Aimfox campaign ID.'),
}).describe('Input for fetching an Aimfox campaign.')

export const getCampaignOutput = z.strictObject({
  status: z.string().describe('The status returned by Aimfox.').nullable().optional(),
  campaign: z.looseObject({}).describe('A raw object returned by Aimfox.').optional(),
}).describe('The campaign returned by Aimfox.')

export const getCampaignMetricsInput = z.strictObject({
  campaign_id: z.string().min(1).describe('The Aimfox campaign ID.'),
}).describe('Input for fetching Aimfox campaign metrics.')

export const getCampaignMetricsOutput = z.strictObject({
  status: z.string().describe('The status returned by Aimfox.').nullable().optional(),
  metrics: z.looseObject({}).describe('A raw object returned by Aimfox.').optional(),
}).describe('The campaign metrics returned by Aimfox.')

export const addProfileToCampaignInput = z.strictObject({
  campaign_id: z.string().min(1).describe('The Aimfox campaign ID.'),
  profile_url: z.url().describe('The LinkedIn profile URL to add to the campaign audience.'),
}).describe('Input for adding a profile to an Aimfox campaign.')

export const addProfileToCampaignOutput = z.strictObject({
  status: z.string().describe('The status returned by Aimfox.').nullable().optional(),
}).describe('The status returned after adding a profile to an Aimfox campaign.')

export const removeProfileFromCampaignInput = z.strictObject({
  campaign_id: z.string().min(1).describe('The Aimfox campaign ID.'),
  urn: z.string().min(1).describe('The LinkedIn profile URN or public identifier to remove.'),
}).describe('Input for removing a profile from an Aimfox campaign.')

export const removeProfileFromCampaignOutput = z.strictObject({
  status: z.string().describe('The status returned by Aimfox.').nullable().optional(),
}).describe('The status returned after removing a profile from an Aimfox campaign.')

export const getLeadInput = z.strictObject({
  lead_id: z.string().min(1).describe('The Aimfox lead ID.'),
}).describe('Input for fetching an Aimfox lead.')

export const getLeadOutput = z.strictObject({
  status: z.string().describe('The status returned by Aimfox.').nullable().optional(),
  lead: z.looseObject({}).describe('A raw object returned by Aimfox.').optional(),
}).describe('The lead returned by Aimfox.')

export const searchLeadsInput = z.strictObject({
  keywords: z.string().describe('Keywords to search for in Aimfox leads.').optional(),
  current_companies: z.array(z.string().min(1).describe('A filter value.')).describe('Filter values for an Aimfox lead search facet.').optional(),
  past_companies: z.array(z.string().min(1).describe('A filter value.')).describe('Filter values for an Aimfox lead search facet.').optional(),
  education: z.array(z.string().min(1).describe('A filter value.')).describe('Filter values for an Aimfox lead search facet.').optional(),
  interests: z.array(z.string().min(1).describe('A filter value.')).describe('Filter values for an Aimfox lead search facet.').optional(),
  labels: z.array(z.string().min(1).describe('A filter value.')).describe('Filter values for an Aimfox lead search facet.').optional(),
  languages: z.array(z.string().min(1).describe('A filter value.')).describe('Filter values for an Aimfox lead search facet.').optional(),
  locations: z.array(z.string().min(1).describe('A filter value.')).describe('Filter values for an Aimfox lead search facet.').optional(),
  origins: z.array(z.string().min(1).describe('A filter value.')).describe('Filter values for an Aimfox lead search facet.').optional(),
  skills: z.array(z.string().min(1).describe('A filter value.')).describe('Filter values for an Aimfox lead search facet.').optional(),
  lead_of: z.array(z.string().min(1).describe('A filter value.')).describe('Filter values for an Aimfox lead search facet.').optional(),
  optimize: z.boolean().describe('Whether Aimfox should optimize the lead search.').optional(),
  start: z.int().min(0).describe('The zero-based offset for the lead search results.').optional(),
  count: z.int().min(1).describe('The number of lead search results to return.').optional(),
}).describe('Input for searching Aimfox leads.')

export const searchLeadsOutput = z.strictObject({
  status: z.string().describe('The status returned by Aimfox.').nullable().optional(),
  leads: z.array(z.looseObject({}).describe('A raw object returned by Aimfox.')).describe('Raw objects returned by Aimfox.').optional(),
}).describe('The leads returned by Aimfox search.')

export const getTotalLeadsCountInput = z.strictObject({
  keywords: z.string().describe('Keywords to search for in Aimfox leads.').optional(),
  current_companies: z.array(z.string().min(1).describe('A filter value.')).describe('Filter values for an Aimfox lead search facet.').optional(),
  past_companies: z.array(z.string().min(1).describe('A filter value.')).describe('Filter values for an Aimfox lead search facet.').optional(),
  education: z.array(z.string().min(1).describe('A filter value.')).describe('Filter values for an Aimfox lead search facet.').optional(),
  interests: z.array(z.string().min(1).describe('A filter value.')).describe('Filter values for an Aimfox lead search facet.').optional(),
  labels: z.array(z.string().min(1).describe('A filter value.')).describe('Filter values for an Aimfox lead search facet.').optional(),
  languages: z.array(z.string().min(1).describe('A filter value.')).describe('Filter values for an Aimfox lead search facet.').optional(),
  locations: z.array(z.string().min(1).describe('A filter value.')).describe('Filter values for an Aimfox lead search facet.').optional(),
  origins: z.array(z.string().min(1).describe('A filter value.')).describe('Filter values for an Aimfox lead search facet.').optional(),
  skills: z.array(z.string().min(1).describe('A filter value.')).describe('Filter values for an Aimfox lead search facet.').optional(),
  lead_of: z.array(z.string().min(1).describe('A filter value.')).describe('Filter values for an Aimfox lead search facet.').optional(),
  optimize: z.boolean().describe('Whether Aimfox should optimize the lead search.').optional(),
}).describe('Input for counting Aimfox leads.')

export const getTotalLeadsCountOutput = z.strictObject({
  status: z.string().describe('The status returned by Aimfox.').nullable().optional(),
  total_leads: z.int().min(0).describe('The number of matching Aimfox leads.').optional(),
  sync: z.boolean().describe('Whether Aimfox reports the count as synchronized.').optional(),
  accounts_sync: z.looseObject({}).describe('Per-account synchronization flags returned by Aimfox.').optional(),
}).describe('The total lead count returned by Aimfox.')

export const listRecentLeadsInput = z.strictObject({}).describe('Input for listing Aimfox recent leads.')

export const listRecentLeadsOutput = z.strictObject({
  status: z.string().describe('The status returned by Aimfox.').nullable().optional(),
  leads: z.array(z.looseObject({}).describe('A raw object returned by Aimfox.')).describe('Raw objects returned by Aimfox.').optional(),
}).describe('The recent lead events returned by Aimfox.')

export const listInteractionsInput = z.strictObject({
  bucket: z.enum(['1 hour', '1 day']).describe('The interval used to group interaction metrics.'),
  from: z.int().min(0).describe('The range start timestamp in milliseconds.'),
  to: z.int().min(0).describe('The range end timestamp in milliseconds.'),
  account_ids: z.array(z.string().min(1).describe('An Aimfox account ID.')).describe('Aimfox account IDs to filter interactions by.').optional(),
  campaign_id: z.string().min(1).describe('The Aimfox campaign ID to filter interactions by.').optional(),
}).describe('Input for listing Aimfox interactions.')

export const listInteractionsOutput = z.strictObject({
  status: z.string().describe('The status returned by Aimfox.').nullable().optional(),
  count: z.int().min(0).describe('The number of interaction buckets returned by Aimfox.').optional(),
  buckets: z.array(z.looseObject({}).describe('A raw object returned by Aimfox.')).describe('Raw objects returned by Aimfox.').optional(),
}).describe('The interaction buckets returned by Aimfox.')

export const listWorkspaceLabelsInput = z.strictObject({}).describe('Input for listing Aimfox workspace labels.')

export const listWorkspaceLabelsOutput = z.strictObject({
  status: z.string().describe('The status returned by Aimfox.').nullable().optional(),
  labels: z.array(z.looseObject({}).describe('A raw object returned by Aimfox.')).describe('Raw objects returned by Aimfox.').optional(),
}).describe('The workspace labels returned by Aimfox.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const aimfoxActions = {
  list_campaigns: {
    description: 'List Aimfox campaigns, optionally filtering by outreach type or profile inserts.',
    effect: 'read',
    inputSchema: listCampaignsInput,
    outputSchema: z.toJSONSchema(listCampaignsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_campaign: {
    description: 'Fetch one Aimfox campaign by campaign ID.',
    effect: 'read',
    inputSchema: getCampaignInput,
    outputSchema: z.toJSONSchema(getCampaignOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_campaign_metrics: {
    description: 'Fetch interaction metrics for one Aimfox campaign.',
    effect: 'read',
    inputSchema: getCampaignMetricsInput,
    outputSchema: z.toJSONSchema(getCampaignMetricsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  add_profile_to_campaign: {
    description: 'Add one LinkedIn profile URL to an Aimfox campaign audience.',
    effect: 'write',
    inputSchema: addProfileToCampaignInput,
    outputSchema: z.toJSONSchema(addProfileToCampaignOutput, { io: 'output', unrepresentable: 'any' }),
  },
  remove_profile_from_campaign: {
    description: 'Remove one LinkedIn profile from an Aimfox campaign audience by URN or public ID.',
    effect: 'destructive',
    inputSchema: removeProfileFromCampaignInput,
    outputSchema: z.toJSONSchema(removeProfileFromCampaignOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_lead: {
    description: 'Fetch one Aimfox lead by lead ID.',
    effect: 'read',
    inputSchema: getLeadInput,
    outputSchema: z.toJSONSchema(getLeadOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_leads: {
    description: 'Search Aimfox leads with documented facet filters and offset pagination.',
    effect: 'read',
    inputSchema: searchLeadsInput,
    outputSchema: z.toJSONSchema(searchLeadsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_total_leads_count: {
    description: 'Count Aimfox leads that match the documented lead search filters.',
    effect: 'read',
    inputSchema: getTotalLeadsCountInput,
    outputSchema: z.toJSONSchema(getTotalLeadsCountOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_recent_leads: {
    description: 'List recent Aimfox lead transition events for the workspace.',
    effect: 'read',
    inputSchema: listRecentLeadsInput,
    outputSchema: z.toJSONSchema(listRecentLeadsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_interactions: {
    description: 'List Aimfox interaction buckets for a timestamp range.',
    effect: 'read',
    inputSchema: listInteractionsInput,
    outputSchema: z.toJSONSchema(listInteractionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_workspace_labels: {
    description: 'List labels configured in the Aimfox workspace.',
    effect: 'read',
    inputSchema: listWorkspaceLabelsInput,
    outputSchema: z.toJSONSchema(listWorkspaceLabelsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
