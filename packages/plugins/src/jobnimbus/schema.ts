/**
 * JobNimbus 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listContactsInput = z.strictObject({
  actor: z.string().min(1).describe('The optional JobNimbus actor email used to execute the request as a specific team member.').optional(),
  size: z.int().min(1).max(1000).describe('The maximum number of contacts to return.').optional(),
  from: z.int().min(0).describe('The zero-based starting offset for pagination.').optional(),
  sortField: z.string().min(1).describe('The JobNimbus field name used for sorting.').optional(),
  sortDirection: z.enum(['asc', 'desc']).describe('The JobNimbus sort direction.').optional(),
  fields: z.array(z.string().min(1).describe('One JobNimbus field name.')).min(1).describe('The JobNimbus field names to include in the response.').optional(),
  filter: z.looseObject({}).describe('A JobNimbus Elasticsearch-style filter object that will be JSON-encoded for the filter query parameter.').optional(),
}).describe('Input parameters for listing JobNimbus contacts.')

export const listContactsOutput = z.strictObject({
  count: z.int().min(0).describe('The total number of contacts returned by the API response.').optional(),
  contacts: z.array(z.looseObject({}).describe('The raw JobNimbus contact record returned by the API.')).describe('The JobNimbus contacts returned for this request.').optional(),
}).describe('The normalized JobNimbus contact list response.')

export const getContactInput = z.strictObject({
  contactId: z.string().min(1).describe('The JobNimbus record identifier.'),
  actor: z.string().min(1).describe('The optional JobNimbus actor email used to execute the request as a specific team member.').optional(),
  fields: z.array(z.string().min(1).describe('One JobNimbus field name.')).min(1).describe('The JobNimbus field names to include in the response.').optional(),
}).describe('Input parameters for reading one JobNimbus contact.')

export const getContactOutput = z.strictObject({
  contact: z.looseObject({}).describe('The raw JobNimbus contact record returned by the API.').optional(),
}).describe('The JobNimbus contact detail response.')

export const createContactInput = z.strictObject({
  actor: z.string().min(1).describe('The optional JobNimbus actor email used to execute the request as a specific team member.').optional(),
  bulk: z.boolean().describe('Whether to ask JobNimbus for optimistic bulk persistence on this write request.').optional(),
  skip: z.array(z.string().min(1).describe('One JobNimbus skip flag.')).min(1).describe('The JobNimbus automated steps to bypass, such as automation or notification.').optional(),
  data: z.looseObject({}).describe('The raw JobNimbus contact payload to send to the API, including standard and custom fields.'),
}).describe('Input parameters for creating one JobNimbus contact.')

export const createContactOutput = z.strictObject({
  contact: z.looseObject({}).describe('The raw JobNimbus contact record returned by the API.').optional(),
}).describe('The JobNimbus contact create response.')

export const updateContactInput = z.strictObject({
  contactId: z.string().min(1).describe('The JobNimbus record identifier.'),
  actor: z.string().min(1).describe('The optional JobNimbus actor email used to execute the request as a specific team member.').optional(),
  bulk: z.boolean().describe('Whether to ask JobNimbus for optimistic bulk persistence on this write request.').optional(),
  skip: z.array(z.string().min(1).describe('One JobNimbus skip flag.')).min(1).describe('The JobNimbus automated steps to bypass, such as automation or notification.').optional(),
  data: z.looseObject({}).describe('The raw JobNimbus contact payload to send to the API, including standard and custom fields.'),
}).describe('Input parameters for updating one JobNimbus contact.')

export const updateContactOutput = z.strictObject({
  contact: z.looseObject({}).describe('The raw JobNimbus contact record returned by the API.').optional(),
}).describe('The JobNimbus contact update response.')

export const listJobsInput = z.strictObject({
  actor: z.string().min(1).describe('The optional JobNimbus actor email used to execute the request as a specific team member.').optional(),
  size: z.int().min(1).max(1000).describe('The maximum number of jobs to return.').optional(),
  from: z.int().min(0).describe('The zero-based starting offset for pagination.').optional(),
  sortField: z.string().min(1).describe('The JobNimbus field name used for sorting.').optional(),
  sortDirection: z.enum(['asc', 'desc']).describe('The JobNimbus sort direction.').optional(),
  fields: z.array(z.string().min(1).describe('One JobNimbus field name.')).min(1).describe('The JobNimbus field names to include in the response.').optional(),
  filter: z.looseObject({}).describe('A JobNimbus Elasticsearch-style filter object that will be JSON-encoded for the filter query parameter.').optional(),
}).describe('Input parameters for listing JobNimbus jobs.')

export const listJobsOutput = z.strictObject({
  count: z.int().min(0).describe('The total number of jobs returned by the API response.').optional(),
  jobs: z.array(z.looseObject({}).describe('The raw JobNimbus job record returned by the API.')).describe('The JobNimbus jobs returned for this request.').optional(),
}).describe('The normalized JobNimbus job list response.')

export const getJobInput = z.strictObject({
  jobId: z.string().min(1).describe('The JobNimbus record identifier.'),
  actor: z.string().min(1).describe('The optional JobNimbus actor email used to execute the request as a specific team member.').optional(),
  fields: z.array(z.string().min(1).describe('One JobNimbus field name.')).min(1).describe('The JobNimbus field names to include in the response.').optional(),
}).describe('Input parameters for reading one JobNimbus job.')

export const getJobOutput = z.strictObject({
  job: z.looseObject({}).describe('The raw JobNimbus job record returned by the API.').optional(),
}).describe('The JobNimbus job detail response.')

export const createJobInput = z.strictObject({
  actor: z.string().min(1).describe('The optional JobNimbus actor email used to execute the request as a specific team member.').optional(),
  bulk: z.boolean().describe('Whether to ask JobNimbus for optimistic bulk persistence on this write request.').optional(),
  skip: z.array(z.string().min(1).describe('One JobNimbus skip flag.')).min(1).describe('The JobNimbus automated steps to bypass, such as automation or notification.').optional(),
  data: z.looseObject({}).describe('The raw JobNimbus job payload to send to the API, including standard and custom fields.'),
}).describe('Input parameters for creating one JobNimbus job.')

export const createJobOutput = z.strictObject({
  job: z.looseObject({}).describe('The raw JobNimbus job record returned by the API.').optional(),
}).describe('The JobNimbus job create response.')

export const updateJobInput = z.strictObject({
  jobId: z.string().min(1).describe('The JobNimbus record identifier.'),
  actor: z.string().min(1).describe('The optional JobNimbus actor email used to execute the request as a specific team member.').optional(),
  bulk: z.boolean().describe('Whether to ask JobNimbus for optimistic bulk persistence on this write request.').optional(),
  skip: z.array(z.string().min(1).describe('One JobNimbus skip flag.')).min(1).describe('The JobNimbus automated steps to bypass, such as automation or notification.').optional(),
  data: z.looseObject({}).describe('The raw JobNimbus job payload to send to the API, including standard and custom fields.'),
}).describe('Input parameters for updating one JobNimbus job.')

export const updateJobOutput = z.strictObject({
  job: z.looseObject({}).describe('The raw JobNimbus job record returned by the API.').optional(),
}).describe('The JobNimbus job update response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const jobnimbusActions = {
  list_contacts: {
    description: 'List JobNimbus contacts with the standard pagination, sorting, field selection, actor, and Elasticsearch-style filter options.',
    effect: 'read',
    inputSchema: listContactsInput,
    outputSchema: z.toJSONSchema(listContactsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_contact: {
    description: 'Get one JobNimbus contact by ID.',
    effect: 'read',
    inputSchema: getContactInput,
    outputSchema: z.toJSONSchema(getContactOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_contact: {
    description: 'Create one JobNimbus contact from a raw contact payload, with optional actor, bulk, and skip controls.',
    effect: 'write',
    inputSchema: createContactInput,
    outputSchema: z.toJSONSchema(createContactOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_contact: {
    description: 'Update one JobNimbus contact by ID from a raw contact payload, with optional actor, bulk, and skip controls.',
    effect: 'write',
    inputSchema: updateContactInput,
    outputSchema: z.toJSONSchema(updateContactOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_jobs: {
    description: 'List JobNimbus jobs with the standard pagination, sorting, field selection, actor, and Elasticsearch-style filter options.',
    effect: 'read',
    inputSchema: listJobsInput,
    outputSchema: z.toJSONSchema(listJobsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_job: {
    description: 'Get one JobNimbus job by ID.',
    effect: 'read',
    inputSchema: getJobInput,
    outputSchema: z.toJSONSchema(getJobOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_job: {
    description: 'Create one JobNimbus job from a raw job payload, with optional actor, bulk, and skip controls.',
    effect: 'write',
    inputSchema: createJobInput,
    outputSchema: z.toJSONSchema(createJobOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_job: {
    description: 'Update one JobNimbus job by ID from a raw job payload, with optional actor, bulk, and skip controls.',
    effect: 'write',
    inputSchema: updateJobInput,
    outputSchema: z.toJSONSchema(updateJobOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
