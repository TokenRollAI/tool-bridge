/**
 * Pipedrive 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listPersonsInput = z.looseObject({}).describe('Input for listing Pipedrive persons.')

export const listPersonsOutput = z.looseObject({}).describe('Pipedrive persons list response.')

export const getPersonInput = z.strictObject({
  personId: z.int().min(1).describe('The Pipedrive person ID to retrieve.').optional(),
}).describe('Input for The Pipedrive person ID to retrieve..')

export const getPersonOutput = z.looseObject({}).describe('Pipedrive person response.')

export const createPersonInput = z.looseObject({}).describe('Input for creating a Pipedrive person.')

export const createPersonOutput = z.looseObject({}).describe('Pipedrive create person response.')

export const updatePersonInput = z.looseObject({}).describe('Input for updating a Pipedrive person.')

export const updatePersonOutput = z.looseObject({}).describe('Pipedrive update person response.')

export const deletePersonInput = z.strictObject({
  personId: z.int().min(1).describe('The Pipedrive person ID to delete.').optional(),
}).describe('Input for The Pipedrive person ID to delete..')

export const deletePersonOutput = z.looseObject({}).describe('Pipedrive delete person response.')

export const searchPersonsInput = z.looseObject({}).describe('Input for searching Pipedrive persons.')

export const searchPersonsOutput = z.looseObject({}).describe('Pipedrive person search response.')

export const listOrganizationsInput = z.looseObject({}).describe('Input for listing Pipedrive organizations.')

export const listOrganizationsOutput = z.looseObject({}).describe('Pipedrive organizations list response.')

export const getOrganizationInput = z.strictObject({
  organizationId: z.int().min(1).describe('The Pipedrive organization ID to retrieve.').optional(),
}).describe('Input for The Pipedrive organization ID to retrieve..')

export const getOrganizationOutput = z.looseObject({}).describe('Pipedrive organization response.')

export const createOrganizationInput = z.looseObject({}).describe('Input for creating a Pipedrive organization.')

export const createOrganizationOutput = z.looseObject({}).describe('Pipedrive create organization response.')

export const updateOrganizationInput = z.looseObject({}).describe('Input for updating a Pipedrive organization.')

export const updateOrganizationOutput = z.looseObject({}).describe('Pipedrive update organization response.')

export const deleteOrganizationInput = z.strictObject({
  organizationId: z.int().min(1).describe('The Pipedrive organization ID to delete.').optional(),
}).describe('Input for The Pipedrive organization ID to delete..')

export const deleteOrganizationOutput = z.looseObject({}).describe('Pipedrive delete organization response.')

export const searchOrganizationsInput = z.looseObject({}).describe('Input for searching Pipedrive organizations.')

export const searchOrganizationsOutput = z.looseObject({}).describe('Pipedrive organization search response.')

export const listDealsInput = z.looseObject({}).describe('Input for listing Pipedrive deals.')

export const listDealsOutput = z.looseObject({}).describe('Pipedrive deals list response.')

export const getDealInput = z.strictObject({
  dealId: z.int().min(1).describe('The Pipedrive deal ID to retrieve.').optional(),
}).describe('Input for The Pipedrive deal ID to retrieve..')

export const getDealOutput = z.looseObject({}).describe('Pipedrive deal response.')

export const createDealInput = z.looseObject({}).describe('Input for creating a Pipedrive deal.')

export const createDealOutput = z.looseObject({}).describe('Pipedrive create deal response.')

export const updateDealInput = z.looseObject({}).describe('Input for updating a Pipedrive deal.')

export const updateDealOutput = z.looseObject({}).describe('Pipedrive update deal response.')

export const deleteDealInput = z.strictObject({
  dealId: z.int().min(1).describe('The Pipedrive deal ID to delete.').optional(),
}).describe('Input for The Pipedrive deal ID to delete..')

export const deleteDealOutput = z.looseObject({}).describe('Pipedrive delete deal response.')

export const searchDealsInput = z.looseObject({}).describe('Input for searching Pipedrive deals.')

export const searchDealsOutput = z.looseObject({}).describe('Pipedrive deal search response.')

export const listActivitiesInput = z.looseObject({}).describe('Input for listing Pipedrive activities.')

export const listActivitiesOutput = z.looseObject({}).describe('Pipedrive activities list response.')

export const getActivityInput = z.strictObject({
  activityId: z.int().min(1).describe('The Pipedrive activity ID to retrieve.').optional(),
}).describe('Input for The Pipedrive activity ID to retrieve..')

export const getActivityOutput = z.looseObject({}).describe('Pipedrive activity response.')

export const createActivityInput = z.looseObject({}).describe('Input for creating a Pipedrive activity.')

export const createActivityOutput = z.looseObject({}).describe('Pipedrive create activity response.')

export const updateActivityInput = z.looseObject({}).describe('Input for updating a Pipedrive activity.')

export const updateActivityOutput = z.looseObject({}).describe('Pipedrive update activity response.')

export const deleteActivityInput = z.strictObject({
  activityId: z.int().min(1).describe('The Pipedrive activity ID to delete.').optional(),
}).describe('Input for The Pipedrive activity ID to delete..')

export const deleteActivityOutput = z.looseObject({}).describe('Pipedrive delete activity response.')

export const listPipelinesInput = z.looseObject({}).describe('Input for listing Pipedrive pipelines.')

export const listPipelinesOutput = z.looseObject({}).describe('Pipedrive pipelines list response.')

export const getPipelineInput = z.strictObject({
  pipelineId: z.int().min(1).describe('The Pipedrive pipeline ID to retrieve.').optional(),
}).describe('Input for The Pipedrive pipeline ID to retrieve..')

export const getPipelineOutput = z.looseObject({}).describe('Pipedrive pipeline response.')

export const listStagesInput = z.looseObject({}).describe('Input for listing Pipedrive stages.')

export const listStagesOutput = z.looseObject({}).describe('Pipedrive stages list response.')

export const getStageInput = z.strictObject({
  stageId: z.int().min(1).describe('The Pipedrive stage ID to retrieve.').optional(),
}).describe('Input for The Pipedrive stage ID to retrieve..')

export const getStageOutput = z.looseObject({}).describe('Pipedrive stage response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const pipedriveActions = {
  list_persons: {
    description: 'List Pipedrive persons with optional owner, updated time, pagination, and custom field filters.',
    effect: 'read',
    inputSchema: listPersonsInput,
    outputSchema: z.toJSONSchema(listPersonsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_person: {
    description: 'Get one Pipedrive person by person ID.',
    effect: 'read',
    inputSchema: getPersonInput,
    outputSchema: z.toJSONSchema(getPersonOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_person: {
    description: 'Create a Pipedrive person with contact values, labels, ownership, visibility, and custom fields.',
    effect: 'write',
    inputSchema: createPersonInput,
    outputSchema: z.toJSONSchema(createPersonOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_person: {
    description: 'Update one Pipedrive person by person ID.',
    effect: 'write',
    inputSchema: updatePersonInput,
    outputSchema: z.toJSONSchema(updatePersonOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_person: {
    description: 'Delete one Pipedrive person by person ID.',
    effect: 'destructive',
    inputSchema: deletePersonInput,
    outputSchema: z.toJSONSchema(deletePersonOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_persons: {
    description: 'Search Pipedrive persons by name, email, phone, notes, or custom fields.',
    effect: 'read',
    inputSchema: searchPersonsInput,
    outputSchema: z.toJSONSchema(searchPersonsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_organizations: {
    description: 'List Pipedrive organizations with optional owner, updated time, pagination, and custom field filters.',
    effect: 'read',
    inputSchema: listOrganizationsInput,
    outputSchema: z.toJSONSchema(listOrganizationsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_organization: {
    description: 'Get one Pipedrive organization by organization ID.',
    effect: 'read',
    inputSchema: getOrganizationInput,
    outputSchema: z.toJSONSchema(getOrganizationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_organization: {
    description: 'Create a Pipedrive organization with address, labels, ownership, visibility, and custom fields.',
    effect: 'write',
    inputSchema: createOrganizationInput,
    outputSchema: z.toJSONSchema(createOrganizationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_organization: {
    description: 'Update one Pipedrive organization by organization ID.',
    effect: 'write',
    inputSchema: updateOrganizationInput,
    outputSchema: z.toJSONSchema(updateOrganizationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_organization: {
    description: 'Delete one Pipedrive organization by organization ID.',
    effect: 'destructive',
    inputSchema: deleteOrganizationInput,
    outputSchema: z.toJSONSchema(deleteOrganizationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_organizations: {
    description: 'Search Pipedrive organizations by name, address, notes, or custom fields.',
    effect: 'read',
    inputSchema: searchOrganizationsInput,
    outputSchema: z.toJSONSchema(searchOrganizationsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_deals: {
    description: 'List Pipedrive deals with optional owner, status, updated time, pagination, and custom field filters.',
    effect: 'read',
    inputSchema: listDealsInput,
    outputSchema: z.toJSONSchema(listDealsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_deal: {
    description: 'Get one Pipedrive deal by deal ID.',
    effect: 'read',
    inputSchema: getDealInput,
    outputSchema: z.toJSONSchema(getDealOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_deal: {
    description: 'Create a Pipedrive deal with title, linked person or organization, value, stage, labels, and custom fields.',
    effect: 'write',
    inputSchema: createDealInput,
    outputSchema: z.toJSONSchema(createDealOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_deal: {
    description: 'Update one Pipedrive deal by deal ID.',
    effect: 'write',
    inputSchema: updateDealInput,
    outputSchema: z.toJSONSchema(updateDealOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_deal: {
    description: 'Delete one Pipedrive deal by deal ID.',
    effect: 'destructive',
    inputSchema: deleteDealInput,
    outputSchema: z.toJSONSchema(deleteDealOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_deals: {
    description: 'Search Pipedrive deals by title, notes, or custom fields.',
    effect: 'read',
    inputSchema: searchDealsInput,
    outputSchema: z.toJSONSchema(searchDealsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_activities: {
    description: 'List Pipedrive activities with optional user, type, date, done state, and pagination filters.',
    effect: 'read',
    inputSchema: listActivitiesInput,
    outputSchema: z.toJSONSchema(listActivitiesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_activity: {
    description: 'Get one Pipedrive activity by activity ID.',
    effect: 'read',
    inputSchema: getActivityInput,
    outputSchema: z.toJSONSchema(getActivityOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_activity: {
    description: 'Create a Pipedrive activity with schedule, attendees, participants, linked entities, and notes.',
    effect: 'write',
    inputSchema: createActivityInput,
    outputSchema: z.toJSONSchema(createActivityOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_activity: {
    description: 'Update one Pipedrive activity by activity ID.',
    effect: 'write',
    inputSchema: updateActivityInput,
    outputSchema: z.toJSONSchema(updateActivityOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_activity: {
    description: 'Delete one Pipedrive activity by activity ID.',
    effect: 'destructive',
    inputSchema: deleteActivityInput,
    outputSchema: z.toJSONSchema(deleteActivityOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_pipelines: {
    description: 'List Pipedrive pipelines with optional sorting and pagination.',
    effect: 'read',
    inputSchema: listPipelinesInput,
    outputSchema: z.toJSONSchema(listPipelinesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_pipeline: {
    description: 'Get one Pipedrive pipeline by pipeline ID.',
    effect: 'read',
    inputSchema: getPipelineInput,
    outputSchema: z.toJSONSchema(getPipelineOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_stages: {
    description: 'List Pipedrive stages with optional pipeline, sorting, and pagination filters.',
    effect: 'read',
    inputSchema: listStagesInput,
    outputSchema: z.toJSONSchema(listStagesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_stage: {
    description: 'Get one Pipedrive stage by stage ID.',
    effect: 'read',
    inputSchema: getStageInput,
    outputSchema: z.toJSONSchema(getStageOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
