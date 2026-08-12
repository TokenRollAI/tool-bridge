/**
 * Userflow 各 action 的入参/出参 Zod schema 与语义标注。
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
  limit: z.int().min(1).max(100).describe('Maximum number of items to return.').optional(),
  starting_after: z.string().min(1).describe('Object ID after which the page should start.').optional(),
  ending_before: z.string().min(1).describe('Object ID before which the page should end.').optional(),
  email: z.string().describe('Filter users by email address.').optional(),
  user_id: z.string().min(1).describe('Filter users by external user ID.').optional(),
  expand: z.array(z.string().min(1).describe('One expandable Userflow field name.')).describe('Expandable Userflow fields to include in the response.').optional(),
  order_by: z.string().min(1).describe('Sort order accepted by Userflow.').optional(),
}).describe('Optional filters for listing Userflow users.')

export const listUsersOutput = z.looseObject({
  object: z.string().describe('The Userflow list object type.'),
  data: z.array(z.looseObject({
    id: z.string().describe('The Userflow user ID.').optional(),
    object: z.string().describe('The Userflow object type.').optional(),
    name: z.string().describe('The user\'s display name.').nullable().optional(),
    email: z.string().describe('The user\'s email address.').nullable().optional(),
    attributes: z.record(z.string(), z.unknown().describe('One Userflow custom attribute value.')).describe('Userflow custom attributes keyed by attribute name.').optional(),
    signed_up_at: z.string().describe('Timestamp when the user signed up.').nullable().optional(),
  }).describe('A Userflow user object.')).describe('Users returned by Userflow.'),
  has_more: z.boolean().describe('Whether another page is available.'),
  url: z.string().describe('The API path represented by the list.'),
}).describe('A paginated Userflow user list.')

export const getUserInput = z.strictObject({
  user_id: z.string().min(1).describe('The Userflow user ID to retrieve.'),
  expand: z.array(z.string().min(1).describe('One expandable Userflow field name.')).describe('Expandable Userflow fields to include in the response.').optional(),
}).describe('Path and query parameters for reading one Userflow user.')

export const getUserOutput = z.strictObject({
  user: z.looseObject({
    id: z.string().describe('The Userflow user ID.').optional(),
    object: z.string().describe('The Userflow object type.').optional(),
    name: z.string().describe('The user\'s display name.').nullable().optional(),
    email: z.string().describe('The user\'s email address.').nullable().optional(),
    attributes: z.record(z.string(), z.unknown().describe('One Userflow custom attribute value.')).describe('Userflow custom attributes keyed by attribute name.').optional(),
    signed_up_at: z.string().describe('Timestamp when the user signed up.').nullable().optional(),
  }).describe('A Userflow user object.').optional(),
}).describe('The Userflow user lookup result.')

export const upsertUserInput = z.strictObject({
  user_id: z.string().min(1).describe('The external user ID to create or update in Userflow.'),
  name: z.string().describe('The user\'s display name.').optional(),
  email: z.email().describe('The user\'s email address.').optional(),
  signed_up_at: z.iso.datetime({ offset: true }).describe('Timestamp when the user signed up.').optional(),
  attributes: z.record(z.string(), z.unknown().describe('One Userflow custom attribute value.')).describe('Userflow custom attributes keyed by attribute name.').optional(),
  groups: z.array(z.string().min(1).describe('One group ID.')).describe('Group IDs the user belongs to.').optional(),
}).describe('Payload for creating or updating one Userflow user.')

export const upsertUserOutput = z.strictObject({
  user: z.looseObject({
    id: z.string().describe('The Userflow user ID.').optional(),
    object: z.string().describe('The Userflow object type.').optional(),
    name: z.string().describe('The user\'s display name.').nullable().optional(),
    email: z.string().describe('The user\'s email address.').nullable().optional(),
    attributes: z.record(z.string(), z.unknown().describe('One Userflow custom attribute value.')).describe('Userflow custom attributes keyed by attribute name.').optional(),
    signed_up_at: z.string().describe('Timestamp when the user signed up.').nullable().optional(),
  }).describe('A Userflow user object.').optional(),
}).describe('The created or updated Userflow user.')

export const deleteUserInput = z.strictObject({
  user_id: z.string().min(1).describe('The Userflow user ID to delete.').optional(),
}).describe('Path parameters for deleting one Userflow user.')

export const deleteUserOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the Userflow user was deleted.').optional(),
  user_id: z.string().describe('The deleted Userflow user ID.').optional(),
  raw: z.looseObject({}).describe('A raw object returned by Userflow.').optional(),
}).describe('The Userflow user deletion acknowledgement.')

export const upsertGroupInput = z.strictObject({
  group_id: z.string().min(1).describe('The external group ID to create or update in Userflow.'),
  name: z.string().describe('The group\'s display name.').optional(),
  attributes: z.record(z.string(), z.unknown().describe('One Userflow custom attribute value.')).describe('Userflow custom attributes keyed by attribute name.').optional(),
}).describe('Payload for creating or updating one Userflow group.')

export const upsertGroupOutput = z.strictObject({
  group: z.looseObject({
    id: z.string().describe('The Userflow group ID.').optional(),
    object: z.string().describe('The Userflow object type.').optional(),
    name: z.string().describe('The group\'s display name.').nullable().optional(),
    attributes: z.record(z.string(), z.unknown().describe('One Userflow custom attribute value.')).describe('Userflow custom attributes keyed by attribute name.').optional(),
  }).describe('A Userflow group object.').optional(),
}).describe('The created or updated Userflow group.')

export const getGroupInput = z.strictObject({
  group_id: z.string().min(1).describe('The Userflow group ID to retrieve.'),
  expand: z.array(z.string().min(1).describe('One expandable Userflow field name.')).describe('Expandable Userflow fields to include in the response.').optional(),
}).describe('Path and query parameters for reading one Userflow group.')

export const getGroupOutput = z.strictObject({
  group: z.looseObject({
    id: z.string().describe('The Userflow group ID.').optional(),
    object: z.string().describe('The Userflow object type.').optional(),
    name: z.string().describe('The group\'s display name.').nullable().optional(),
    attributes: z.record(z.string(), z.unknown().describe('One Userflow custom attribute value.')).describe('Userflow custom attributes keyed by attribute name.').optional(),
  }).describe('A Userflow group object.').optional(),
}).describe('The Userflow group lookup result.')

export const deleteGroupInput = z.strictObject({
  group_id: z.string().min(1).describe('The Userflow group ID to delete.').optional(),
}).describe('Path parameters for deleting one Userflow group.')

export const deleteGroupOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the Userflow group was deleted.').optional(),
  group_id: z.string().describe('The deleted Userflow group ID.').optional(),
  raw: z.looseObject({}).describe('A raw object returned by Userflow.').optional(),
}).describe('The Userflow group deletion acknowledgement.')

export const trackEventInput = z.strictObject({
  name: z.string().min(1).describe('The event name to track.'),
  user_id: z.string().min(1).describe('The Userflow user ID associated with the event.'),
  group_id: z.string().min(1).describe('The Userflow group ID associated with the event.').optional(),
  occurred_at: z.iso.datetime({ offset: true }).describe('Timestamp when the event occurred.').optional(),
  attributes: z.record(z.string(), z.unknown().describe('One Userflow custom attribute value.')).describe('Userflow custom attributes keyed by attribute name.').optional(),
}).describe('Payload for tracking a Userflow event.')

export const trackEventOutput = z.strictObject({
  event: z.looseObject({
    id: z.string().describe('The Userflow object ID.').optional(),
    object: z.string().describe('The Userflow object type.').optional(),
    created_at: z.string().describe('Timestamp when the object was created.').nullable().optional(),
    updated_at: z.string().describe('Timestamp when the object was last updated.').nullable().optional(),
  }).describe('A Userflow API object.').optional(),
}).describe('The Userflow event tracking result.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const userflowActions = {
  list_users: {
    description: 'List Userflow users with optional cursor pagination and filters.',
    effect: 'read',
    inputSchema: listUsersInput,
    outputSchema: z.toJSONSchema(listUsersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_user: {
    description: 'Fetch one Userflow user by ID.',
    effect: 'read',
    inputSchema: getUserInput,
    outputSchema: z.toJSONSchema(getUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  upsert_user: {
    description: 'Create or update one Userflow user.',
    effect: 'write',
    inputSchema: upsertUserInput,
    outputSchema: z.toJSONSchema(upsertUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_user: {
    description: 'Delete one Userflow user by ID.',
    effect: 'destructive',
    inputSchema: deleteUserInput,
    outputSchema: z.toJSONSchema(deleteUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  upsert_group: {
    description: 'Create or update one Userflow group.',
    effect: 'write',
    inputSchema: upsertGroupInput,
    outputSchema: z.toJSONSchema(upsertGroupOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_group: {
    description: 'Fetch one Userflow group by ID.',
    effect: 'read',
    inputSchema: getGroupInput,
    outputSchema: z.toJSONSchema(getGroupOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_group: {
    description: 'Delete one Userflow group by ID.',
    effect: 'destructive',
    inputSchema: deleteGroupInput,
    outputSchema: z.toJSONSchema(deleteGroupOutput, { io: 'output', unrepresentable: 'any' }),
  },
  track_event: {
    description: 'Track one Userflow event for a user.',
    effect: 'write',
    inputSchema: trackEventInput,
    outputSchema: z.toJSONSchema(trackEventOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
