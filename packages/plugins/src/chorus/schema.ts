/**
 * Chorus 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getCurrentUserInput = z.strictObject({}).describe('No input is required for this Chorus action.')

export const getCurrentUserOutput = z.strictObject({
  user: z.looseObject({
    id: z.string().describe('The Chorus resource ID.').optional(),
    type: z.string().describe('The Chorus resource type.').optional(),
    attributes: z.looseObject({}).describe('The Chorus resource attributes.').optional(),
  }).describe('A Chorus JSON:API resource.').optional(),
}).describe('The current Chorus user response.')

export const listTeamsInput = z.strictObject({}).describe('No input is required for this Chorus action.')

export const listTeamsOutput = z.strictObject({
  teams: z.array(z.looseObject({
    id: z.string().describe('The Chorus resource ID.').optional(),
    type: z.string().describe('The Chorus resource type.').optional(),
    attributes: z.looseObject({}).describe('The Chorus resource attributes.').optional(),
  }).describe('A Chorus JSON:API resource.')).describe('The Chorus teams returned by the API.').optional(),
}).describe('The Chorus teams response.')

export const getTeamInput = z.strictObject({
  id: z.string().min(1).describe('The Chorus team ID.').optional(),
}).describe('Input for getting a Chorus team.')

export const getTeamOutput = z.strictObject({
  team: z.looseObject({
    id: z.string().describe('The Chorus resource ID.').optional(),
    type: z.string().describe('The Chorus resource type.').optional(),
    attributes: z.looseObject({}).describe('The Chorus resource attributes.').optional(),
  }).describe('A Chorus JSON:API resource.').optional(),
}).describe('The Chorus team response.')

export const listEngagementsInput = z.strictObject({
  compliance: z.string().min(1).describe('Filter by Chorus call recording compliance flag.').optional(),
  continuationKey: z.string().min(1).describe('The Chorus continuation_key returned by the previous page.').optional(),
  dispositionConnected: z.boolean().describe('Filter by Chorus connected disposition.').optional(),
  dispositionGatekeeper: z.boolean().describe('Filter by Chorus gatekeeper disposition.').optional(),
  dispositionTree: z.boolean().describe('Filter by Chorus phone tree disposition.').optional(),
  dispositionVoicemail: z.boolean().describe('Filter by Chorus voicemail disposition.').optional(),
  engagementIds: z.array(z.string().min(1).describe('A Chorus string value.')).min(1).describe('One or more Chorus engagement IDs to retrieve.').optional(),
  engagementType: z.string().min(1).describe('Filter by Chorus engagement type.').optional(),
  contentType: z.string().min(1).describe('Filter by Chorus engagement content type.').optional(),
  maxDate: z.iso.datetime({ offset: true }).describe('Only include engagements on or before this datetime.').optional(),
  maxDuration: z.number().describe('Only include engagements with duration at or below this number of seconds.').optional(),
  minDate: z.iso.datetime({ offset: true }).describe('Only include engagements on or after this datetime.').optional(),
  minDuration: z.number().describe('Only include engagements with duration at or above this number of seconds.').optional(),
  participantsEmail: z.email().describe('Filter by a participant email address.').optional(),
  teamIds: z.array(z.int().describe('A Chorus numeric ID.')).min(1).describe('One or more Chorus team IDs for engagement owners.').optional(),
  userIds: z.array(z.int().describe('A Chorus numeric ID.')).min(1).describe('One or more Chorus user IDs for engagement owners.').optional(),
  withTrackers: z.boolean().describe('Whether to return tracker information with engagements.').optional(),
}).describe('Query parameters for listing Chorus engagements.')

export const listEngagementsOutput = z.strictObject({
  engagements: z.array(z.looseObject({
    engagement_id: z.string().describe('The Chorus engagement ID.').optional(),
    subject: z.string().describe('The engagement subject.').optional(),
    user_id: z.int().describe('The Chorus user ID of the engagement owner.').optional(),
    user_email: z.string().describe('The email address of the engagement owner.').optional(),
    user_name: z.string().describe('The name of the engagement owner.').optional(),
    date_time: z.number().describe('The engagement start time as returned by Chorus.').optional(),
    duration: z.number().describe('The engagement duration in seconds.').optional(),
    participants: z.array(z.looseObject({}).describe('A Chorus engagement participant.')).describe('Participants included in the engagement.').optional(),
  }).describe('A Chorus engagement returned by the v3 engagements API.')).describe('The Chorus engagements returned by the API.').optional(),
  continuationKey: z.string().describe('The continuation key for the next page, if present.').nullable().optional(),
}).describe('The Chorus engagements response.')

export const getConversationInput = z.strictObject({
  id: z.string().min(1).describe('The Chorus conversation ID to retrieve.'),
  fields: z.array(z.enum(['account', 'company_name', '_created_at', '_modified_at', 'deal', 'disposition', 'language', 'metrics', 'meeting.id', 'name', 'owner', 'owner.email', 'participants', 'private', 'recording', 'recording.audio_only', 'recording.autojoin', 'recording.autojoin_reason', 'recording.clusters', 'recording.duration', 'recording.end_reason', 'recording.recordable', 'recording.schedule_end_time', 'recording.schedule_start_time', 'recording.start_time', 'recording.thumbnails', 'recording.trackers', 'recording.utterances', 'source', 'status', 'user_company_name']).describe('A Chorus conversation field to populate.')).min(1).describe('Chorus conversation fields to populate.').optional(),
  forceRegeneration: z.boolean().describe('Whether Chorus should regenerate the conversation from latest data.').optional(),
  skipSummaryGeneration: z.boolean().describe('Whether Chorus should skip summary generation.').optional(),
  includeMeetingMetadata: z.boolean().describe('Whether Chorus should include meeting metadata such as provider calendar ID and meeting URL.').optional(),
}).describe('Input for getting a Chorus conversation.')

export const getConversationOutput = z.strictObject({
  conversation: z.looseObject({
    id: z.string().describe('The Chorus resource ID.').optional(),
    type: z.string().describe('The Chorus resource type.').optional(),
    attributes: z.looseObject({}).describe('The Chorus resource attributes.').optional(),
  }).describe('A Chorus JSON:API resource.').optional(),
}).describe('The Chorus conversation response.')

export const listScorecardsInput = z.strictObject({
  recipientIds: z.array(z.int().describe('A Chorus numeric ID.')).min(1).describe('IDs of Chorus users who were scored.').optional(),
  reviewerIds: z.array(z.int().describe('A Chorus numeric ID.')).min(1).describe('IDs of Chorus users who completed scorecards.').optional(),
  initiativeId: z.int().describe('The Chorus initiative ID that scorecards were completed against.').optional(),
  submittedRange: z.string().min(1).describe('The submitted datetime range in Chorus format, such as 2021-01-01T00:00:00Z:2021-01-31T00:00:00Z.').optional(),
  pageSize: z.int().min(1).max(100).describe('The number of scorecards to return per page. Chorus allows 1 to 100.').optional(),
  pageNumber: z.int().min(1).describe('The one-indexed page of scorecards to return.').optional(),
}).describe('Query parameters for listing Chorus scorecards.')

export const listScorecardsOutput = z.strictObject({
  scorecards: z.array(z.looseObject({
    id: z.string().describe('The Chorus resource ID.').optional(),
    type: z.string().describe('The Chorus resource type.').optional(),
    attributes: z.looseObject({}).describe('The Chorus resource attributes.').optional(),
  }).describe('A Chorus JSON:API resource.')).describe('The Chorus scorecards returned by the API.').optional(),
}).describe('The Chorus scorecards response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const chorusActions = {
  get_current_user: {
    description: 'Get details about the current Chorus API token user.',
    effect: 'read',
    inputSchema: getCurrentUserInput,
    outputSchema: z.toJSONSchema(getCurrentUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_teams: {
    description: 'List Chorus teams visible to the connected API token user.',
    effect: 'read',
    inputSchema: listTeamsInput,
    outputSchema: z.toJSONSchema(listTeamsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_team: {
    description: 'Get a specific Chorus team by ID.',
    effect: 'read',
    inputSchema: getTeamInput,
    outputSchema: z.toJSONSchema(getTeamOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_engagements: {
    description: 'List Chorus engagements with documented v3 filters and continuation pagination.',
    effect: 'read',
    inputSchema: listEngagementsInput,
    outputSchema: z.toJSONSchema(listEngagementsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_conversation: {
    description: 'Get a specific Chorus conversation with optional populated fields.',
    effect: 'read',
    inputSchema: getConversationInput,
    outputSchema: z.toJSONSchema(getConversationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_scorecards: {
    description: 'List Chorus scorecards with documented filters and page pagination.',
    effect: 'read',
    inputSchema: listScorecardsInput,
    outputSchema: z.toJSONSchema(listScorecardsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
