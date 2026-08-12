/**
 * Sling 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getCurrentSessionInput = z.strictObject({}).describe('No input is required.')

export const getCurrentSessionOutput = z.strictObject({
  session: z.looseObject({}).describe('The Sling session record returned by the API.').optional(),
}).describe('The current Sling session returned by the connector.')

export const listUsersInput = z.strictObject({
  query: z.string().min(1).describe('Only return users with a matching prefix in name, lastname, or email.').optional(),
  ids: z.array(z.int().min(1).describe('One Sling numeric identifier.')).min(1).describe('Only return Sling users whose ids are in this list.').optional(),
  includeDeleted: z.boolean().describe('Whether deleted users should be included.').optional(),
}).describe('Input parameters for listing Sling users in the current organization.')

export const listUsersOutput = z.strictObject({
  users: z.array(z.looseObject({}).describe('One Sling user record.')).describe('The Sling user records returned by the API.').optional(),
}).describe('The Sling users returned by the connector.')

export const getUserInput = z.strictObject({
  userId: z.int().min(1).describe('The Sling user identifier.').optional(),
}).describe('Input parameters for retrieving one Sling user.')

export const getUserOutput = z.strictObject({
  user: z.looseObject({}).describe('The Sling user record returned by the API.').optional(),
}).describe('The Sling user returned by the connector.')

export const listGroupsInput = z.strictObject({
  ids: z.array(z.int().min(1).describe('One Sling numeric identifier.')).min(1).describe('Only return Sling groups whose ids are in this list.').optional(),
  type: z.string().min(1).describe('Only return groups with this Sling group type.').optional(),
}).describe('Input parameters for listing Sling groups in the current organization.')

export const listGroupsOutput = z.strictObject({
  groups: z.array(z.looseObject({}).describe('One Sling group record.')).describe('The Sling group records returned by the API.').optional(),
}).describe('The Sling groups returned by the connector.')

export const getGroupInput = z.strictObject({
  groupId: z.int().min(1).describe('The Sling group identifier.').optional(),
}).describe('Input parameters for retrieving one Sling group.')

export const getGroupOutput = z.strictObject({
  group: z.looseObject({}).describe('The Sling group record returned by the API.').optional(),
}).describe('The Sling group returned by the connector.')

export const listCalendarEventsInput = z.strictObject({
  orgId: z.int().min(1).describe('The Sling organization identifier.'),
  userId: z.int().min(1).describe('The Sling user identifier.'),
  dates: z.string().min(1).describe('The ISO 8601 interval to fetch, such as 2026-06-24/2026-06-30.'),
  locationIds: z.array(z.int().min(1).describe('One Sling numeric identifier.')).min(1).describe('Sling location ids used to filter calendar events.').optional(),
  positionIds: z.array(z.int().min(1).describe('One Sling numeric identifier.')).min(1).describe('Sling position ids used to filter calendar events.').optional(),
  tagIds: z.array(z.int().min(1).describe('One Sling numeric identifier.')).min(1).describe('Sling tag ids used to include calendar events.').optional(),
  excludeTagIds: z.array(z.int().min(1).describe('One Sling numeric identifier.')).min(1).describe('Sling tag ids used to exclude calendar events.').optional(),
  userIds: z.array(z.int().min(1).describe('One Sling numeric identifier.')).min(1).describe('Sling user ids used to filter calendar events.').optional(),
  groupIds: z.array(z.int().min(1).describe('One Sling numeric identifier.')).min(1).describe('Sling group ids used to include calendar events.').optional(),
  excludeGroupIds: z.array(z.int().min(1).describe('One Sling numeric identifier.')).min(1).describe('Sling group ids used to exclude calendar events.').optional(),
  dayPartIds: z.array(z.int().min(1).describe('One Sling numeric identifier.')).min(1).describe('Sling day part ids used to include calendar events.').optional(),
  excludeDayPartIds: z.array(z.int().min(1).describe('One Sling numeric identifier.')).min(1).describe('Sling day part ids used to exclude calendar events.').optional(),
  eventTypes: z.array(z.string().min(1).describe('One Sling filter value.')).min(1).describe('Sling event types to include.').optional(),
  groupBy: z.string().min(1).describe('The Sling calendar grouping mode.').optional(),
  pageSize: z.int().min(1).describe('The number of calendar results to return.').optional(),
  page: z.int().min(0).describe('The zero-based calendar result page to return.').optional(),
  skipUnscheduled: z.boolean().describe('Whether unscheduled shifts should be skipped.').optional(),
  showPlanningEvents: z.boolean().describe('Whether planning status events should be included.').optional(),
}).describe('Input parameters for listing Sling calendar events for one user.')

export const listCalendarEventsOutput = z.strictObject({
  events: z.array(z.looseObject({}).describe('One Sling calendar event record.')).describe('The Sling calendar event records returned by the API.').optional(),
}).describe('The Sling calendar events returned by the connector.')

export const getShiftInput = z.strictObject({
  shiftId: z.string().min(1).describe('The Sling shift or event identifier.'),
  includeTimesheets: z.enum(['true', 'full']).describe('How much timesheet data Sling should include.').optional(),
}).describe('Input parameters for retrieving one Sling shift.')

export const getShiftOutput = z.strictObject({
  shift: z.looseObject({}).describe('The Sling shift record returned by the API.').optional(),
}).describe('The Sling shift returned by the connector.')

export const getDetailedShiftInput = z.strictObject({
  shiftId: z.union([z.int().min(1).describe('A numeric Sling shift identifier.'), z.string().min(1).describe('A string Sling shift identifier.')]).describe('The Sling shift identifier.').optional(),
}).describe('Input parameters for a Sling shift-scoped request.')

export const getDetailedShiftOutput = z.strictObject({
  shift: z.looseObject({}).describe('The Sling shift record returned by the API.').optional(),
}).describe('The Sling shift returned by the connector.')

export const listShiftCoworkersInput = z.strictObject({
  shiftId: z.union([z.int().min(1).describe('A numeric Sling shift identifier.'), z.string().min(1).describe('A string Sling shift identifier.')]).describe('The Sling shift identifier.').optional(),
}).describe('Input parameters for a Sling shift-scoped request.')

export const listShiftCoworkersOutput = z.strictObject({
  coworkers: z.array(z.looseObject({}).describe('One Sling coworker record.')).describe('The Sling coworker records returned by the API.').optional(),
}).describe('The Sling shift coworkers returned by the connector.')

export const getCurrentShiftInput = z.strictObject({}).describe('No input is required.')

export const getCurrentShiftOutput = z.strictObject({
  shift: z.looseObject({}).describe('The Sling shift record returned by the API.').optional(),
}).describe('The Sling shift returned by the connector.')

export const getNextShiftInput = z.strictObject({
  referenceDate: z.string().min(1).describe('Only return the first shift after this ISO timestamp.').optional(),
}).describe('Input parameters for retrieving the next Sling shift for the current user.')

export const getNextShiftOutput = z.strictObject({
  shift: z.looseObject({}).describe('The Sling shift record returned by the API.').optional(),
}).describe('The Sling shift returned by the connector.')

export const listWorkingUsersInput = z.strictObject({
  date: z.string().min(1).describe('The ISO date for the working-users query.').optional(),
}).describe('Input parameters for listing users working on a day.')

export const listWorkingUsersOutput = z.strictObject({
  users: z.array(z.looseObject({}).describe('One Sling user record.')).describe('The Sling user records returned by the API.').optional(),
}).describe('The Sling users returned by the connector.')

export const listTasksInput = z.strictObject({
  filter: z.string().min(1).describe('Only return tasks that belong to this Sling task type.').optional(),
  since: z.int().min(1).describe('Only return tasks with an id greater than this value.').optional(),
  before: z.int().min(1).describe('Only return tasks with an id less than this value.').optional(),
  pageSize: z.int().min(1).describe('The number of task results to return.').optional(),
}).describe('Input parameters for listing Sling tasks.')

export const listTasksOutput = z.strictObject({
  tasks: z.array(z.looseObject({}).describe('One Sling task record.')).describe('The Sling task records returned by the API.').optional(),
}).describe('The Sling tasks returned by the connector.')

export const getTaskInput = z.strictObject({
  taskId: z.int().min(1).describe('The Sling task identifier.').optional(),
}).describe('Input parameters for retrieving one Sling task.')

export const getTaskOutput = z.strictObject({
  task: z.looseObject({}).describe('The Sling task record returned by the API.').optional(),
}).describe('The Sling task returned by the connector.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const slingActions = {
  get_current_session: {
    description: 'Retrieve the current Sling API session, including user and organization details.',
    effect: 'read',
    inputSchema: getCurrentSessionInput,
    outputSchema: z.toJSONSchema(getCurrentSessionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_users: {
    description: 'List Sling users in the current organization with optional filters.',
    effect: 'read',
    inputSchema: listUsersInput,
    outputSchema: z.toJSONSchema(listUsersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_user: {
    description: 'Retrieve one Sling user by id.',
    effect: 'read',
    inputSchema: getUserInput,
    outputSchema: z.toJSONSchema(getUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_groups: {
    description: 'List Sling groups in the current organization with optional filters.',
    effect: 'read',
    inputSchema: listGroupsInput,
    outputSchema: z.toJSONSchema(listGroupsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_group: {
    description: 'Retrieve one Sling group by id.',
    effect: 'read',
    inputSchema: getGroupInput,
    outputSchema: z.toJSONSchema(getGroupOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_calendar_events: {
    description: 'List Sling calendar events for one user and organization within an ISO interval.',
    effect: 'read',
    inputSchema: listCalendarEventsInput,
    outputSchema: z.toJSONSchema(listCalendarEventsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_shift: {
    description: 'Retrieve one Sling shift by id.',
    effect: 'read',
    inputSchema: getShiftInput,
    outputSchema: z.toJSONSchema(getShiftOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_detailed_shift: {
    description: 'Retrieve supplementary details for one Sling shift.',
    effect: 'read',
    inputSchema: getDetailedShiftInput,
    outputSchema: z.toJSONSchema(getDetailedShiftOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_shift_coworkers: {
    description: 'List coworkers for one Sling shift.',
    effect: 'read',
    inputSchema: listShiftCoworkersInput,
    outputSchema: z.toJSONSchema(listShiftCoworkersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_current_shift: {
    description: 'Retrieve the current shift for the connected Sling user.',
    effect: 'read',
    inputSchema: getCurrentShiftInput,
    outputSchema: z.toJSONSchema(getCurrentShiftOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_next_shift: {
    description: 'Retrieve the next shift for the connected Sling user.',
    effect: 'read',
    inputSchema: getNextShiftInput,
    outputSchema: z.toJSONSchema(getNextShiftOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_working_users: {
    description: 'List Sling users working on a specific date.',
    effect: 'read',
    inputSchema: listWorkingUsersInput,
    outputSchema: z.toJSONSchema(listWorkingUsersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_tasks: {
    description: 'List Sling tasks with optional type and cursor-like id filters.',
    effect: 'read',
    inputSchema: listTasksInput,
    outputSchema: z.toJSONSchema(listTasksOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_task: {
    description: 'Retrieve one Sling task by id.',
    effect: 'read',
    inputSchema: getTaskInput,
    outputSchema: z.toJSONSchema(getTaskOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
