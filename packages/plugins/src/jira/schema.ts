/**
 * Jira 各 action 的入参/出参 Zod schema 与语义标注。
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
  limit: z.int().min(1).max(100).describe('Maximum items to return in one Jira page.').optional(),
  cursor: z.string().regex(new RegExp('^\\d+$')).describe('StartAt pagination cursor as a non-negative integer string.').optional(),
  expand: z.array(z.string().min(1).describe('Jira expand token.')).min(1).describe('Additional Jira expand tokens.').optional(),
}).describe('The input payload for this action.')

export const listProjectsOutput = z.strictObject({
  projects: z.array(z.looseObject({
    id: z.string().describe('Jira project ID.').optional(),
    key: z.string().describe('Jira project key.').optional(),
    name: z.string().describe('Jira project name.').optional(),
    raw: z.looseObject({}).describe('Jira API object.').optional(),
  }).describe('Jira project.')),
  pagination: z.strictObject({
    nextCursor: z.string().describe('Cursor for the next page.').nullable(),
  }).describe('Jira pagination metadata.'),
}).describe('Jira action output.')

export const getProjectInput = z.strictObject({
  projectIdOrKey: z.string().min(1).describe('Jira project ID or key.'),
  expand: z.array(z.string().min(1).describe('Jira expand token.')).min(1).describe('Additional Jira expand tokens.').optional(),
}).describe('The input payload for this action.')

export const getProjectOutput = z.strictObject({
  project: z.looseObject({
    id: z.string().describe('Jira project ID.').optional(),
    key: z.string().describe('Jira project key.').optional(),
    name: z.string().describe('Jira project name.').optional(),
    raw: z.looseObject({}).describe('Jira API object.').optional(),
  }).describe('Jira project.'),
}).describe('Jira action output.')

export const searchIssuesInput = z.strictObject({
  jql: z.string().min(1).describe('Jira Query Language string.'),
  limit: z.int().min(1).max(100).describe('Maximum items to return in one Jira page.').optional(),
  cursor: z.string().min(1).describe('Opaque pagination cursor returned by Jira.').optional(),
  includeFields: z.array(z.string().min(1).describe('Jira field ID or name.')).min(1).describe('Additional Jira issue fields.').optional(),
  expand: z.array(z.string().min(1).describe('Jira expand token.')).min(1).describe('Additional Jira expand tokens.').optional(),
}).describe('The input payload for this action.')

export const searchIssuesOutput = z.strictObject({
  issues: z.array(z.looseObject({
    id: z.string().describe('Jira issue ID.').optional(),
    key: z.string().describe('Jira issue key.').optional(),
    summary: z.string().describe('Jira issue summary.').optional(),
    fields: z.looseObject({}).describe('Jira API object.').optional(),
    raw: z.looseObject({}).describe('Jira API object.').optional(),
  }).describe('Jira issue.')),
  pagination: z.strictObject({
    nextCursor: z.string().describe('Cursor for the next page.').nullable(),
  }).describe('Jira pagination metadata.'),
}).describe('Jira action output.')

export const getIssueInput = z.strictObject({
  issueIdOrKey: z.string().min(1).describe('Jira issue ID or key.'),
  includeFields: z.array(z.string().min(1).describe('Jira field ID or name.')).min(1).describe('Additional Jira issue fields.').optional(),
  expand: z.array(z.string().min(1).describe('Jira expand token.')).min(1).describe('Additional Jira expand tokens.').optional(),
}).describe('The input payload for this action.')

export const getIssueOutput = z.strictObject({
  issue: z.looseObject({
    id: z.string().describe('Jira issue ID.').optional(),
    key: z.string().describe('Jira issue key.').optional(),
    summary: z.string().describe('Jira issue summary.').optional(),
    fields: z.looseObject({}).describe('Jira API object.').optional(),
    raw: z.looseObject({}).describe('Jira API object.').optional(),
  }).describe('Jira issue.'),
}).describe('Jira action output.')

export const createIssueInput = z.strictObject({
  projectKey: z.string().min(1).describe('Jira project key.').optional(),
  projectId: z.string().min(1).describe('Jira project ID.').optional(),
  issueTypeId: z.string().min(1).describe('Jira issue type ID.').optional(),
  issueTypeName: z.string().min(1).describe('Jira issue type name.').optional(),
  summary: z.string().min(1).describe('Jira issue summary.'),
  descriptionText: z.string().min(1).describe('Plain text description converted to the connected deployment\'s document format.').optional(),
  description: z.looseObject({
    type: z.literal('doc').describe('ADF root node type.'),
    version: z.int().describe('ADF document version.'),
    content: z.array(z.unknown().describe('ADF top-level node.')).describe('ADF content nodes.'),
  }).describe('Atlassian Document Format document.').optional(),
  labels: z.array(z.string().min(1)).min(1).describe('Jira labels.').optional(),
  assigneeAccountId: z.string().min(1).describe('Assignee account ID for Jira Cloud or username for Jira Data Center/Server.').optional(),
  priorityId: z.string().min(1).describe('Jira priority ID.').optional(),
  dueDate: z.iso.date().describe('Jira due date in YYYY-MM-DD format.').optional(),
  parentIssueKey: z.string().min(1).describe('Parent issue key for subtasks.').optional(),
  extraFields: z.looseObject({}).describe('Jira API object.').optional(),
}).describe('The input payload for this action.')

export const createIssueOutput = z.strictObject({
  issue: z.looseObject({
    id: z.string().describe('Jira issue ID.').optional(),
    key: z.string().describe('Jira issue key.').optional(),
    summary: z.string().describe('Jira issue summary.').optional(),
    fields: z.looseObject({}).describe('Jira API object.').optional(),
    raw: z.looseObject({}).describe('Jira API object.').optional(),
  }).describe('Jira issue.'),
}).describe('Jira action output.')

export const listIssueCommentsInput = z.strictObject({
  issueIdOrKey: z.string().min(1).describe('Jira issue ID or key.'),
  limit: z.int().min(1).max(100).describe('Maximum items to return in one Jira page.').optional(),
  cursor: z.string().regex(new RegExp('^\\d+$')).describe('StartAt pagination cursor as a non-negative integer string.').optional(),
  expand: z.array(z.string().min(1).describe('Jira expand token.')).min(1).describe('Additional Jira expand tokens.').optional(),
}).describe('The input payload for this action.')

export const listIssueCommentsOutput = z.strictObject({
  comments: z.array(z.looseObject({
    id: z.string().describe('Jira comment ID.').optional(),
    body: z.union([z.looseObject({
      type: z.literal('doc').describe('ADF root node type.'),
      version: z.int().describe('ADF document version.'),
      content: z.array(z.unknown().describe('ADF top-level node.')).describe('ADF content nodes.'),
    }).describe('Atlassian Document Format document.'), z.string().describe('Plain text comment body (Jira Server/Data Center).')]).describe('Jira comment body: an ADF document (Cloud) or plain text (Server/Data Center).').optional(),
    raw: z.looseObject({}).describe('Jira API object.').optional(),
  }).describe('Jira comment.')),
  pagination: z.strictObject({
    nextCursor: z.string().describe('Cursor for the next page.').nullable(),
  }).describe('Jira pagination metadata.'),
}).describe('Jira action output.')

export const addCommentInput = z.strictObject({
  issueIdOrKey: z.string().min(1).describe('Jira issue ID or key.'),
  bodyText: z.string().min(1).describe('Plain text comment body converted to the connected deployment\'s document format.').optional(),
  body: z.looseObject({
    type: z.literal('doc').describe('ADF root node type.'),
    version: z.int().describe('ADF document version.'),
    content: z.array(z.unknown().describe('ADF top-level node.')).describe('ADF content nodes.'),
  }).describe('Atlassian Document Format document.').optional(),
}).describe('The input payload for this action.')

export const addCommentOutput = z.strictObject({
  comment: z.looseObject({
    id: z.string().describe('Jira comment ID.').optional(),
    body: z.union([z.looseObject({
      type: z.literal('doc').describe('ADF root node type.'),
      version: z.int().describe('ADF document version.'),
      content: z.array(z.unknown().describe('ADF top-level node.')).describe('ADF content nodes.'),
    }).describe('Atlassian Document Format document.'), z.string().describe('Plain text comment body (Jira Server/Data Center).')]).describe('Jira comment body: an ADF document (Cloud) or plain text (Server/Data Center).').optional(),
    raw: z.looseObject({}).describe('Jira API object.').optional(),
  }).describe('Jira comment.'),
}).describe('Jira action output.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const jiraActions = {
  list_projects: {
    description: 'List Jira projects available to the connected Jira site.',
    effect: 'read',
    inputSchema: listProjectsInput,
    outputSchema: z.toJSONSchema(listProjectsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_project: {
    description: 'Get one Jira project by project ID or key.',
    effect: 'read',
    inputSchema: getProjectInput,
    outputSchema: z.toJSONSchema(getProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_issues: {
    description: 'Search Jira issues with JQL on the connected Jira site.',
    effect: 'read',
    inputSchema: searchIssuesInput,
    outputSchema: z.toJSONSchema(searchIssuesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_issue: {
    description: 'Get one Jira issue by issue ID or key.',
    effect: 'read',
    inputSchema: getIssueInput,
    outputSchema: z.toJSONSchema(getIssueOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_issue: {
    description: 'Create a Jira issue and return the normalized issue detail.',
    effect: 'write',
    inputSchema: createIssueInput,
    outputSchema: z.toJSONSchema(createIssueOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_issue_comments: {
    description: 'List comments for one Jira issue.',
    effect: 'read',
    inputSchema: listIssueCommentsInput,
    outputSchema: z.toJSONSchema(listIssueCommentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  add_comment: {
    description: 'Add a comment to one Jira issue.',
    effect: 'write',
    inputSchema: addCommentInput,
    outputSchema: z.toJSONSchema(addCommentOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
