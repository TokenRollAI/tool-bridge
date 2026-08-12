/**
 * Mattermost 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getCurrentUserInput = z.strictObject({}).describe('No input parameters are required.')

export const getCurrentUserOutput = z.strictObject({
  user: z.looseObject({}).describe('A Mattermost API entity object.').optional(),
  raw: z.unknown().describe('The raw Mattermost API JSON response.').optional(),
}).describe('Output payload for the current Mattermost user.')

export const listUserTeamsInput = z.strictObject({}).describe('No input parameters are required.')

export const listUserTeamsOutput = z.strictObject({
  teams: z.array(z.looseObject({}).describe('A Mattermost API entity object.')).describe('Mattermost teams returned by the API.').optional(),
  raw: z.unknown().describe('The raw Mattermost API JSON response.').optional(),
}).describe('Output payload for Mattermost teams.')

export const getTeamInput = z.strictObject({
  teamId: z.string().min(1).describe('A Mattermost object ID.').optional(),
}).describe('Input parameters for retrieving one Mattermost team.')

export const getTeamOutput = z.strictObject({
  team: z.looseObject({}).describe('A Mattermost API entity object.').optional(),
  raw: z.unknown().describe('The raw Mattermost API JSON response.').optional(),
}).describe('Output payload for one Mattermost team.')

export const listTeamChannelsInput = z.strictObject({
  teamId: z.string().min(1).describe('A Mattermost object ID.'),
  page: z.int().min(0).describe('The zero-based page number to request.').optional(),
  perPage: z.int().min(1).describe('The number of records to request per page.').optional(),
}).describe('Query parameters for listing Mattermost channels in a team.')

export const listTeamChannelsOutput = z.strictObject({
  channels: z.array(z.looseObject({}).describe('A Mattermost API entity object.')).describe('Mattermost channels returned by the API.').optional(),
  raw: z.unknown().describe('The raw Mattermost API JSON response.').optional(),
}).describe('Output payload for Mattermost channels.')

export const getChannelInput = z.strictObject({
  channelId: z.string().min(1).describe('A Mattermost object ID.').optional(),
}).describe('Input parameters for retrieving one Mattermost channel.')

export const getChannelOutput = z.strictObject({
  channel: z.looseObject({}).describe('A Mattermost API entity object.').optional(),
  raw: z.unknown().describe('The raw Mattermost API JSON response.').optional(),
}).describe('Output payload for one Mattermost channel.')

export const listChannelPostsInput = z.strictObject({
  channelId: z.string().min(1).describe('A Mattermost object ID.'),
  page: z.int().min(0).describe('The zero-based page number to request.').optional(),
  perPage: z.int().min(1).describe('The number of records to request per page.').optional(),
  since: z.int().min(0).describe('Only return posts created after this Unix timestamp in milliseconds.').optional(),
  beforePostId: z.string().min(1).describe('Return posts before this Mattermost post ID.').optional(),
  afterPostId: z.string().min(1).describe('Return posts after this Mattermost post ID.').optional(),
}).describe('Query parameters for listing posts in a Mattermost channel. since cannot be used with page, perPage, beforePostId, or afterPostId.')

export const listChannelPostsOutput = z.strictObject({
  posts: z.array(z.looseObject({}).describe('A Mattermost post object.')).describe('Mattermost posts returned by the API in response order.').optional(),
  order: z.array(z.string().min(1).describe('A Mattermost object ID.')).describe('Mattermost post IDs in response order.').optional(),
  raw: z.unknown().describe('The raw Mattermost API JSON response.').optional(),
}).describe('Output payload for Mattermost channel posts.')

export const createPostInput = z.strictObject({
  channelId: z.string().min(1).describe('A Mattermost object ID.'),
  message: z.string().min(1).describe('The Markdown message body to post.'),
  rootId: z.string().min(1).describe('Optional root post ID for replying in a thread.').optional(),
  props: z.looseObject({}).describe('Optional Mattermost post props object.').optional(),
}).describe('Input parameters for creating a Mattermost channel post.')

export const createPostOutput = z.strictObject({
  post: z.looseObject({}).describe('A Mattermost post object.').optional(),
  raw: z.unknown().describe('The raw Mattermost API JSON response.').optional(),
}).describe('Output payload for a created Mattermost post.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const mattermostActions = {
  get_current_user: {
    description: 'Get the Mattermost user associated with the Personal Access Token.',
    effect: 'read',
    inputSchema: getCurrentUserInput,
    outputSchema: z.toJSONSchema(getCurrentUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_user_teams: {
    description: 'List Mattermost teams visible to the current user.',
    effect: 'read',
    inputSchema: listUserTeamsInput,
    outputSchema: z.toJSONSchema(listUserTeamsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_team: {
    description: 'Retrieve one Mattermost team by ID.',
    effect: 'read',
    inputSchema: getTeamInput,
    outputSchema: z.toJSONSchema(getTeamOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_team_channels: {
    description: 'List public Mattermost channels in a team.',
    effect: 'read',
    inputSchema: listTeamChannelsInput,
    outputSchema: z.toJSONSchema(listTeamChannelsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_channel: {
    description: 'Retrieve one Mattermost channel by ID.',
    effect: 'read',
    inputSchema: getChannelInput,
    outputSchema: z.toJSONSchema(getChannelOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_channel_posts: {
    description: 'List Mattermost posts in a channel.',
    effect: 'read',
    inputSchema: listChannelPostsInput,
    outputSchema: z.toJSONSchema(listChannelPostsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_post: {
    description: 'Create a Mattermost post in a channel.',
    effect: 'write',
    inputSchema: createPostInput,
    outputSchema: z.toJSONSchema(createPostOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
