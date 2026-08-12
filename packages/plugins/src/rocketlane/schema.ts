/**
 * Rocketlane 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listProjectsInput = z.strictObject({
  pageSize: z.int().min(1).max(100).describe('The maximum number of records to return per page.').optional(),
  pageToken: z.string().min(1).describe('The pagination token returned by the previous Rocketlane list response.').optional(),
  includeAllFields: z.boolean().describe('Whether Rocketlane should return all available fields.').optional(),
  sortOrder: z.enum(['ASC', 'DESC']).describe('The sort order for the Rocketlane list response.').optional(),
  match: z.enum(['all', 'any']).describe('Whether Rocketlane should match all filters or any filter.').optional(),
  includeFields: z.array(z.enum(['annualizedRecurringRevenue', 'projectFee', 'allocatedHours', 'allocatedMinutes', 'budgetedHours', 'percentageBudgetedHoursConsumed', 'percentageBudgetConsumed', 'billableHours', 'billableMinutes', 'nonBillableHours', 'nonBillableMinutes', 'trackedHours', 'trackedMinutes', 'progressPercentage', 'startDateActual', 'dueDateActual', 'currentPhase', 'autoAllocation', 'sources', 'inferredProgress', 'plannedDuration', 'projectAgeInDays', 'customersInvited', 'customersJoined', 'externalReferenceId', 'metrics', 'remainingMinutes', 'remainingHours']).describe('One Rocketlane project field to include in the response.')).min(1).describe('The Rocketlane project fields to include in the response.').optional(),
  sortBy: z.enum(['projectName', 'startDate', 'dueDate', 'startDateActual', 'dueDateActual', 'annualizedRecurringRevenue', 'projectFee']).describe('The Rocketlane project field used for sorting.').optional(),
  projectNameEq: z.string().min(1).describe('Return only Rocketlane projects with this exact project name.').optional(),
  projectNameContains: z.string().min(1).describe('Return only Rocketlane projects whose project name contains this value.').optional(),
  statusEq: z.string().min(1).describe('The Rocketlane status or external identifier.').optional(),
  statusOneOf: z.array(z.string().min(1).describe('The Rocketlane status or external identifier.')).min(1).describe('Return Rocketlane projects whose status matches one of these identifiers.').optional(),
  startDateGt: z.iso.date().describe('A Rocketlane date in YYYY-MM-DD format.').optional(),
  startDateGe: z.iso.date().describe('A Rocketlane date in YYYY-MM-DD format.').optional(),
  dueDateLt: z.iso.date().describe('A Rocketlane date in YYYY-MM-DD format.').optional(),
  customerIdEq: z.int().min(1).describe('Return only Rocketlane projects for this customer company ID.').optional(),
}).describe('The input payload for listing Rocketlane projects.')

export const listProjectsOutput = z.strictObject({
  projects: z.array(z.looseObject({}).describe('A Rocketlane project.')).describe('The Rocketlane projects returned for the current page.').optional(),
  pagination: z.looseObject({}).describe('Pagination metadata returned by Rocketlane list endpoints.').optional(),
}).describe('The response returned when listing Rocketlane projects.')

export const getProjectInput = z.strictObject({
  projectId: z.int().min(1).describe('The Rocketlane project ID to fetch.'),
  includeFields: z.array(z.enum(['annualizedRecurringRevenue', 'projectFee', 'allocatedHours', 'allocatedMinutes', 'budgetedHours', 'percentageBudgetedHoursConsumed', 'percentageBudgetConsumed', 'billableHours', 'billableMinutes', 'nonBillableHours', 'nonBillableMinutes', 'trackedHours', 'trackedMinutes', 'progressPercentage', 'startDateActual', 'dueDateActual', 'currentPhase', 'autoAllocation', 'sources', 'inferredProgress', 'plannedDuration', 'projectAgeInDays', 'customersInvited', 'customersJoined', 'externalReferenceId', 'metrics', 'remainingMinutes', 'remainingHours']).describe('One Rocketlane project field to include in the response.')).min(1).describe('The Rocketlane project fields to include in the response.').optional(),
  includeAllFields: z.boolean().describe('Whether Rocketlane should return all available project fields.').optional(),
}).describe('The input payload for getting one Rocketlane project.')

export const getProjectOutput = z.strictObject({
  project: z.looseObject({}).describe('A Rocketlane project.').optional(),
}).describe('The response returned for one Rocketlane project.')

export const listTasksInput = z.strictObject({
  pageSize: z.int().min(1).max(100).describe('The maximum number of records to return per page.').optional(),
  pageToken: z.string().min(1).describe('The pagination token returned by the previous Rocketlane list response.').optional(),
  includeAllFields: z.boolean().describe('Whether Rocketlane should return all available fields.').optional(),
  sortOrder: z.enum(['ASC', 'DESC']).describe('The sort order for the Rocketlane list response.').optional(),
  match: z.enum(['all', 'any']).describe('Whether Rocketlane should match all filters or any filter.').optional(),
  includeFields: z.array(z.enum(['startDateActual', 'dueDateActual', 'type', 'phase', 'assignees', 'followers', 'dependencies', 'billable', 'csatEnabled', 'priority', 'timeEntryCategory', 'financialsBudget', 'taskPrivateNote', 'parent', 'externalReferenceId']).describe('One Rocketlane task field to include in the response.')).min(1).describe('The Rocketlane task fields to include in the response.').optional(),
  sortBy: z.enum(['taskName', 'startDate', 'dueDate', 'startDateActual', 'dueDateActual']).describe('The Rocketlane task field used for sorting.').optional(),
  taskNameEq: z.string().min(1).describe('Return only Rocketlane tasks with this exact task name.').optional(),
  taskNameContains: z.string().min(1).describe('Return only Rocketlane tasks whose task name contains this value.').optional(),
  taskStatusEq: z.string().min(1).describe('The Rocketlane status or external identifier.').optional(),
  taskStatusOneOf: z.array(z.string().min(1).describe('The Rocketlane status or external identifier.')).min(1).describe('Return Rocketlane tasks whose status matches one of these identifiers.').optional(),
  projectIdEq: z.int().min(1).describe('Return only Rocketlane tasks for this project ID.').optional(),
  startDateGt: z.iso.date().describe('A Rocketlane date in YYYY-MM-DD format.').optional(),
  dueDateLt: z.iso.date().describe('A Rocketlane date in YYYY-MM-DD format.').optional(),
  atRiskEq: z.boolean().describe('Return only Rocketlane tasks that match this at-risk flag.').optional(),
}).describe('The input payload for listing Rocketlane tasks.')

export const listTasksOutput = z.strictObject({
  tasks: z.array(z.looseObject({}).describe('A Rocketlane task.')).describe('The Rocketlane tasks returned for the current page.').optional(),
  pagination: z.looseObject({}).describe('Pagination metadata returned by Rocketlane list endpoints.').optional(),
}).describe('The response returned when listing Rocketlane tasks.')

export const getTaskInput = z.strictObject({
  taskId: z.int().min(1).describe('The Rocketlane task ID to fetch.'),
  includeFields: z.array(z.enum(['startDateActual', 'dueDateActual', 'type', 'phase', 'assignees', 'followers', 'dependencies', 'billable', 'csatEnabled', 'priority', 'timeEntryCategory', 'financialsBudget', 'taskPrivateNote', 'parent', 'externalReferenceId']).describe('One Rocketlane task field to include in the response.')).min(1).describe('The Rocketlane task fields to include in the response.').optional(),
  includeAllFields: z.boolean().describe('Whether Rocketlane should return all available task fields.').optional(),
}).describe('The input payload for getting one Rocketlane task.')

export const getTaskOutput = z.strictObject({
  task: z.looseObject({}).describe('A Rocketlane task.').optional(),
}).describe('The response returned for one Rocketlane task.')

export const listUsersInput = z.strictObject({
  pageSize: z.int().min(1).max(100).describe('The maximum number of records to return per page.').optional(),
  pageToken: z.string().min(1).describe('The pagination token returned by the previous Rocketlane list response.').optional(),
  includeAllFields: z.boolean().describe('Whether Rocketlane should return all available fields.').optional(),
  sortOrder: z.enum(['ASC', 'DESC']).describe('The sort order for the Rocketlane list response.').optional(),
  match: z.enum(['all', 'any']).describe('Whether Rocketlane should match all filters or any filter.').optional(),
  includeFields: z.array(z.enum(['role', 'company', 'permission', 'holidayCalendar', 'capacityInMinutes', 'profilePictureUrl']).describe('One Rocketlane user field to include in the response.')).min(1).describe('The Rocketlane user fields to include in the response.').optional(),
  sortBy: z.enum(['email', 'firstName', 'lastName', 'type', 'status', 'capacityInMinutes']).describe('The Rocketlane user field used for sorting.').optional(),
  firstNameEq: z.string().min(1).describe('Return only Rocketlane users with this exact first name.').optional(),
  firstNameContains: z.string().min(1).describe('Return only Rocketlane users whose first name contains this value.').optional(),
  emailEq: z.string().min(1).describe('Return only Rocketlane users with this exact email address.').optional(),
  emailContains: z.string().min(1).describe('Return only Rocketlane users whose email address contains this value.').optional(),
  statusEq: z.array(z.enum(['INACTIVE', 'INVITED', 'ACTIVE', 'PASSIVE']).describe('One Rocketlane user status value.')).min(1).max(1).describe('Return only Rocketlane users with this exact status.').optional(),
  statusOneOf: z.array(z.enum(['INACTIVE', 'INVITED', 'ACTIVE', 'PASSIVE']).describe('One Rocketlane user status value.')).min(1).max(3).describe('Return Rocketlane users whose status matches any of these values.').optional(),
  typeEq: z.array(z.enum(['TEAM_MEMBER', 'PARTNER', 'CUSTOMER', 'EXTERNAL_PARTNER']).describe('One Rocketlane user type value.')).min(1).max(1).describe('Return only Rocketlane users with this exact user type.').optional(),
  permissionIdEq: z.int().min(1).describe('Return only Rocketlane users with this permission ID.').optional(),
}).describe('The input payload for listing Rocketlane users.')

export const listUsersOutput = z.strictObject({
  users: z.array(z.looseObject({}).describe('A Rocketlane user.')).describe('The Rocketlane users returned for the current page.').optional(),
  pagination: z.looseObject({}).describe('Pagination metadata returned by Rocketlane list endpoints.').optional(),
}).describe('The response returned when listing Rocketlane users.')

export const getUserInput = z.strictObject({
  userId: z.int().min(1).describe('The Rocketlane user ID to fetch.'),
  includeFields: z.array(z.enum(['role', 'company', 'permission', 'holidayCalendar', 'capacityInMinutes', 'profilePictureUrl']).describe('One Rocketlane user field to include in the response.')).min(1).describe('The Rocketlane user fields to include in the response.').optional(),
  includeAllFields: z.boolean().describe('Whether Rocketlane should return all available user fields.').optional(),
}).describe('The input payload for getting one Rocketlane user.')

export const getUserOutput = z.strictObject({
  user: z.looseObject({}).describe('A Rocketlane user.').optional(),
}).describe('The response returned for one Rocketlane user.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const rocketlaneActions = {
  list_projects: {
    description: 'List Rocketlane projects with pagination, sorting, and first-pass project filters.',
    effect: 'read',
    inputSchema: listProjectsInput,
    outputSchema: z.toJSONSchema(listProjectsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_project: {
    description: 'Get one Rocketlane project by numeric project ID.',
    effect: 'read',
    inputSchema: getProjectInput,
    outputSchema: z.toJSONSchema(getProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_tasks: {
    description: 'List Rocketlane tasks with pagination, sorting, and first-pass task filters.',
    effect: 'read',
    inputSchema: listTasksInput,
    outputSchema: z.toJSONSchema(listTasksOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_task: {
    description: 'Get one Rocketlane task by numeric task ID.',
    effect: 'read',
    inputSchema: getTaskInput,
    outputSchema: z.toJSONSchema(getTaskOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_users: {
    description: 'List Rocketlane users with pagination, sorting, and first-pass user filters.',
    effect: 'read',
    inputSchema: listUsersInput,
    outputSchema: z.toJSONSchema(listUsersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_user: {
    description: 'Get one Rocketlane user by numeric user ID.',
    effect: 'read',
    inputSchema: getUserInput,
    outputSchema: z.toJSONSchema(getUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
