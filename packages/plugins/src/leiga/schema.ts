/**
 * Leiga 各 action 的入参/出参 Zod schema 与语义标注。
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
  id: z.int().min(1).describe('Filter projects by one project ID.').optional(),
  pname: z.string().min(1).describe('Filter projects by project name.').optional(),
  pkey: z.string().min(1).describe('Filter projects by project key.').optional(),
  archived: z.int().min(0).max(1).describe('Filter by archived status where 1 means archived and 0 means active.').optional(),
}).describe('The input payload for listing Leiga projects.')

export const listProjectsOutput = z.strictObject({
  projects: z.array(z.strictObject({
    id: z.int().min(1).describe('The Leiga project ID.').optional(),
    pname: z.string().describe('The Leiga project name.').nullable().optional(),
    pkey: z.string().describe('The Leiga project key.').nullable().optional(),
    archived: z.int().describe('Whether the project is archived, where 1 means yes and 0 means no.').nullable().optional(),
    owner: z.looseObject({}).describe('The owner object returned by Leiga when available.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw project object returned by Leiga.').optional(),
  }).describe('A normalized Leiga project record.')).describe('The normalized Leiga projects that matched the filters.').optional(),
  total: z.int().describe('The total number of returned projects.').optional(),
  raw: z.looseObject({}).describe('The raw project list response returned by Leiga.').optional(),
}).describe('The response returned when listing Leiga projects.')

export const getProjectInput = z.strictObject({
  projectId: z.int().min(1).describe('The official Leiga project ID.').optional(),
}).describe('The input payload for fetching one Leiga project by ID.')

export const getProjectOutput = z.strictObject({
  project: z.strictObject({
    id: z.int().min(1).describe('The Leiga project ID.').optional(),
    pname: z.string().describe('The Leiga project name.').nullable().optional(),
    pkey: z.string().describe('The Leiga project key.').nullable().optional(),
    archived: z.int().describe('Whether the project is archived, where 1 means yes and 0 means no.').nullable().optional(),
    owner: z.looseObject({}).describe('The owner object returned by Leiga when available.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw project object returned by Leiga.').optional(),
  }).describe('A normalized Leiga project record.').optional(),
}).describe('The response returned when fetching one Leiga project by ID.')

export const getProjectByKeyInput = z.strictObject({
  projectKey: z.string().min(1).describe('The official Leiga project key.').optional(),
}).describe('The input payload for fetching one Leiga project by key.')

export const getProjectByKeyOutput = z.strictObject({
  project: z.strictObject({
    id: z.int().min(1).describe('The Leiga project ID.').optional(),
    pname: z.string().describe('The Leiga project name.').nullable().optional(),
    pkey: z.string().describe('The Leiga project key.').nullable().optional(),
    archived: z.int().describe('Whether the project is archived, where 1 means yes and 0 means no.').nullable().optional(),
    owner: z.looseObject({}).describe('The owner object returned by Leiga when available.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw project object returned by Leiga.').optional(),
  }).describe('A normalized Leiga project record.').optional(),
}).describe('The response returned when fetching one Leiga project by key.')

export const listIssuesInput = z.strictObject({
  projectId: z.int().min(1).describe('The official Leiga project ID.'),
  pageNumber: z.int().min(1).describe('The page number to request from Leiga.'),
  pageSize: z.int().min(1).describe('The number of issues to request from Leiga.'),
  summary: z.string().min(1).describe('An optional summary keyword filter.').optional(),
  orderBy: z.string().min(1).describe('The field name used for sorting.').optional(),
  sort: z.enum(['ASC', 'DESC']).describe('The sort direction returned by Leiga.').optional(),
  statusTypes: z.array(z.int().min(1).describe('One issue status type ID.')).min(1).describe('The optional list of issue status type IDs to filter by.').optional(),
  showedCustomFieldCodes: z.array(z.string().min(1).describe('One custom field code.')).min(1).describe('The optional custom field codes that should be included in the response.').optional(),
}).describe('The input payload for listing Leiga issues.')

export const listIssuesOutput = z.strictObject({
  total: z.int().describe('The total number of issues returned by Leiga for this query.').optional(),
  issues: z.array(z.strictObject({
    id: z.int().describe('The internal Leiga issue ID when available.').nullable().optional(),
    issueId: z.int().describe('The internal Leiga issue ID from detail endpoints when available.').nullable().optional(),
    issueNo: z.string().describe('The issue number returned by Leiga.').nullable().optional(),
    summary: z.string().describe('The issue summary returned by Leiga.').nullable().optional(),
    description: z.string().describe('The issue description returned by Leiga.').nullable().optional(),
    statusName: z.string().describe('The issue status name returned by Leiga.').nullable().optional(),
    projectId: z.int().describe('The project ID associated with the issue when available.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw issue object returned by Leiga.').optional(),
  }).describe('A normalized Leiga issue record.')).describe('The normalized Leiga issues in the current page.').optional(),
  raw: z.looseObject({}).describe('The raw issue list response returned by Leiga.').optional(),
}).describe('The response returned when listing Leiga issues.')

export const getIssueByNumberInput = z.strictObject({
  issueNo: z.string().min(1).describe('The official Leiga issue number such as CORE-1.').optional(),
}).describe('The input payload for fetching one Leiga issue by issue number.')

export const getIssueByNumberOutput = z.strictObject({
  issue: z.strictObject({
    id: z.int().describe('The internal Leiga issue ID when available.').nullable().optional(),
    issueId: z.int().describe('The internal Leiga issue ID from detail endpoints when available.').nullable().optional(),
    issueNo: z.string().describe('The issue number returned by Leiga.').nullable().optional(),
    summary: z.string().describe('The issue summary returned by Leiga.').nullable().optional(),
    description: z.string().describe('The issue description returned by Leiga.').nullable().optional(),
    statusName: z.string().describe('The issue status name returned by Leiga.').nullable().optional(),
    projectId: z.int().describe('The project ID associated with the issue when available.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw issue object returned by Leiga.').optional(),
  }).describe('A normalized Leiga issue record.').optional(),
}).describe('The response returned when fetching one Leiga issue by issue number.')

export const getIssueSchemaInput = z.strictObject({
  projectId: z.int().min(1).describe('The official Leiga project ID.').optional(),
}).describe('The input payload for fetching the Leiga issue schema.')

export const getIssueSchemaOutput = z.strictObject({
  schema: z.strictObject({
    id: z.int().describe('The issue schema ID when Leiga returns it as a number.').nullable().optional(),
    name: z.string().describe('The issue schema name.').nullable().optional(),
    fields: z.array(z.strictObject({
      fieldId: z.string().min(1).describe('The field identifier.').optional(),
      fieldName: z.string().min(1).describe('The field display name.').optional(),
      fieldType: z.string().min(1).describe('The field type returned by Leiga.').optional(),
      required: z.boolean().describe('Whether Leiga marks the field as required.').optional(),
      options: z.array(z.unknown().describe('One raw option entry.')).describe('The optional field choices returned by Leiga.').nullable().optional(),
    }).describe('One field definition from a Leiga issue schema.')).describe('The issue field definitions returned by Leiga.').optional(),
    raw: z.looseObject({}).describe('The raw issue schema object returned by Leiga.').optional(),
  }).describe('The normalized Leiga issue schema object.').optional(),
}).describe('The response returned when fetching the Leiga issue schema.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const leigaActions = {
  list_projects: {
    description: 'List Leiga projects using the official project list filters.',
    effect: 'read',
    inputSchema: listProjectsInput,
    outputSchema: z.toJSONSchema(listProjectsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_project: {
    description: 'Fetch one Leiga project by its official numeric projectId.',
    effect: 'read',
    inputSchema: getProjectInput,
    outputSchema: z.toJSONSchema(getProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_project_by_key: {
    description: 'Fetch one Leiga project by its official project key.',
    effect: 'read',
    inputSchema: getProjectByKeyInput,
    outputSchema: z.toJSONSchema(getProjectByKeyOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_issues: {
    description: 'List Leiga issues for one project using the official issue query body.',
    effect: 'read',
    inputSchema: listIssuesInput,
    outputSchema: z.toJSONSchema(listIssuesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_issue_by_number: {
    description: 'Fetch one Leiga issue by its official issueNo identifier.',
    effect: 'read',
    inputSchema: getIssueByNumberInput,
    outputSchema: z.toJSONSchema(getIssueByNumberOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_issue_schema: {
    description: 'Fetch the Leiga issue field schema for one project.',
    effect: 'read',
    inputSchema: getIssueSchemaInput,
    outputSchema: z.toJSONSchema(getIssueSchemaOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
