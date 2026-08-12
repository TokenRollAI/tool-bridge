/**
 * Linear 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const createAttachmentInput = z.strictObject({
  issue_id: z.string().min(1).describe('Linear resource ID.'),
  title: z.string().min(1).describe('Attachment title.'),
  url: z.string().min(1).describe('Attachment URL.'),
  subtitle: z.string().describe('Attachment subtitle.').optional(),
}).describe('The input payload for this action.')

export const createAttachmentOutput = z.looseObject({
  id: z.string().min(1).describe('Linear resource ID.').optional(),
  issue_id: z.string().min(1).describe('Linear resource ID.').optional(),
  title: z.string().describe('Attachment title.').optional(),
  url: z.string().describe('Attachment URL.').optional(),
  subtitle: z.string().describe('Attachment subtitle.').nullable().optional(),
}).describe('Linear action output.')

export const createCommentReactionInput = z.strictObject({
  comment_id: z.string().min(1).describe('Linear resource ID.'),
  emoji: z.string().min(1).describe('Emoji to add.'),
}).describe('The input payload for this action.')

export const createCommentReactionOutput = z.looseObject({
  reaction_id: z.string().min(1).describe('Linear resource ID.').optional(),
  comment_id: z.string().min(1).describe('Linear resource ID.').optional(),
  emoji: z.string().optional(),
}).describe('Linear action output.')

export const createLinearCommentInput = z.strictObject({
  issueId: z.string().min(1).describe('Linear resource ID.'),
  body: z.string().min(1).describe('Comment text in Markdown.'),
}).describe('The input payload for this action.')

export const createLinearCommentOutput = z.looseObject({
  comment_id: z.string().min(1).describe('Linear resource ID.').optional(),
  issue_id: z.string().min(1).describe('Linear resource ID.').optional(),
  body: z.string().optional(),
}).describe('Linear action output.')

export const createLinearIssueInput = z.strictObject({
  title: z.string().min(1).describe('Issue title.'),
  team_id: z.string().min(1).describe('Linear resource ID.'),
  cycle_id: z.string().min(1).describe('Linear resource ID.').optional(),
  due_date: z.string().describe('Issue due date.').optional(),
  estimate: z.number().describe('Issue estimate.').optional(),
  priority: z.number().describe('Issue priority.').optional(),
  state_id: z.string().min(1).describe('Linear resource ID.').optional(),
  label_ids: z.array(z.string().min(1).describe('Linear resource ID.')).describe('Label IDs.').optional(),
  parent_id: z.string().min(1).describe('Linear resource ID.').optional(),
  project_id: z.string().min(1).describe('Linear resource ID.').optional(),
  assignee_id: z.string().min(1).describe('Linear resource ID.').optional(),
  description: z.string().describe('Issue description in Markdown.').optional(),
}).describe('The input payload for this action.')

export const createLinearIssueOutput = z.looseObject({
  id: z.string().min(1).describe('Linear resource ID.').optional(),
  identifier: z.string().describe('Issue identifier.').optional(),
  issue_title: z.string().describe('Issue title.').optional(),
  issue_description: z.string().describe('Issue description.').nullable().optional(),
  ticket_url: z.string().describe('Issue URL.').optional(),
}).describe('Linear action output.')

export const createLinearIssueRelationInput = z.strictObject({
  issue_id: z.string().min(1).describe('Linear resource ID.'),
  related_issue_id: z.string().min(1).describe('Linear resource ID.'),
  relation_type: z.enum(['blocks', 'duplicate', 'related', 'similar']).describe('Relationship type.'),
}).describe('The input payload for this action.')

export const createLinearIssueRelationOutput = z.looseObject({
  id: z.string().min(1).describe('Linear resource ID.').optional(),
  issue_id: z.string().min(1).describe('Linear resource ID.').optional(),
  related_issue_id: z.string().min(1).describe('Linear resource ID.').optional(),
  relation_type: z.string().optional(),
}).describe('Linear action output.')

export const createLinearLabelInput = z.strictObject({
  team_id: z.string().min(1).describe('Linear resource ID.'),
  name: z.string().min(1).describe('Label name.'),
  color: z.string().min(1).describe('Label color.'),
  description: z.string().describe('Label description.').optional(),
}).describe('The input payload for this action.')

export const createLinearLabelOutput = z.looseObject({
  id: z.string().min(1).describe('Linear resource ID.').optional(),
  team_id: z.string().min(1).describe('Linear resource ID.').optional(),
  name: z.string().optional(),
  color: z.string().optional(),
  description: z.string().nullable().optional(),
}).describe('Linear action output.')

export const createLinearProjectInput = z.strictObject({
  icon: z.string().describe('Project icon.').optional(),
  name: z.string().min(1).describe('Project name.'),
  color: z.string().describe('Project color.').optional(),
  lead_id: z.string().min(1).describe('Linear resource ID.').optional(),
  priority: z.number().describe('Project priority.').optional(),
  status_id: z.string().min(1).describe('Linear resource ID.').optional(),
  state: z.string().describe('Project state type.').optional(),
  start_date: z.string().describe('Project start date.').optional(),
  description: z.string().describe('Project description.').optional(),
  target_date: z.string().describe('Project target date.').optional(),
  team_ids: z.array(z.string().min(1).describe('Linear resource ID.')).min(1).describe('Team IDs associated with the project.'),
}).describe('The input payload for this action.')

export const createLinearProjectOutput = z.looseObject({
  id: z.string().min(1).describe('Linear resource ID.').optional(),
  name: z.string().optional(),
  url: z.string().optional(),
  state: z.string().optional(),
}).describe('Linear action output.')

export const createProjectMilestoneInput = z.strictObject({
  name: z.string().min(1).describe('Milestone name.'),
  project_id: z.string().min(1).describe('Linear resource ID.'),
  sort_order: z.number().describe('Milestone sort order.').optional(),
  description: z.string().describe('Milestone description.').optional(),
  target_date: z.string().describe('Target date.').optional(),
}).describe('The input payload for this action.')

export const createProjectMilestoneOutput = z.looseObject({
  id: z.string().min(1).describe('Linear resource ID.').optional(),
  project_id: z.string().min(1).describe('Linear resource ID.').optional(),
  name: z.string().optional(),
  target_date: z.string().nullable().optional(),
}).describe('Linear action output.')

export const createProjectUpdateInput = z.strictObject({
  body: z.string().min(1).describe('Project update body.'),
  health: z.enum(['onTrack', 'atRisk', 'offTrack']).describe('Project health.').optional(),
  project_id: z.string().min(1).describe('Linear resource ID.'),
  is_diff_hidden: z.boolean().describe('Whether to hide diff.').optional(),
}).describe('The input payload for this action.')

export const createProjectUpdateOutput = z.looseObject({
  id: z.string().min(1).describe('Linear resource ID.').optional(),
  project_id: z.string().min(1).describe('Linear resource ID.').optional(),
  body: z.string().nullable().optional(),
  health: z.string().nullable().optional(),
  is_diff_hidden: z.boolean().optional(),
}).describe('Linear action output.')

export const deleteLinearIssueInput = z.strictObject({
  issue_id: z.string().min(1).describe('Linear resource ID.'),
}).describe('The input payload for this action.')

export const deleteLinearIssueOutput = z.looseObject({
  id: z.string().min(1).describe('Linear resource ID.').optional(),
  deleted: z.boolean().optional(),
}).describe('Linear action output.')

export const getAllLinearTeamsInput = z.strictObject({}).describe('The input payload for this action.')

export const getAllLinearTeamsOutput = z.looseObject({
  teams: z.array(z.looseObject({}).describe('Linear API object.')).describe('teams returned by Linear.').optional(),
}).describe('Linear action output.')

export const getAttachmentInput = z.strictObject({
  issue_id: z.string().min(1).describe('Linear resource ID.'),
  attachment_id: z.string().min(1).describe('Linear resource ID.').optional(),
  file_name: z.string().min(1).describe('Attachment file name or title.').optional(),
}).describe('The input payload for this action.')

export const getAttachmentOutput = z.looseObject({
  attachment: z.looseObject({}).describe('Linear API object.').optional(),
}).describe('Linear action output.')

export const getCurrentUserInput = z.strictObject({}).describe('The input payload for this action.')

export const getCurrentUserOutput = z.looseObject({
  viewer: z.looseObject({}).describe('Linear API object.').optional(),
}).describe('Linear action output.')

export const getCyclesByTeamIdInput = z.strictObject({
  team_id: z.string().min(1).describe('Linear resource ID.'),
}).describe('The input payload for this action.')

export const getCyclesByTeamIdOutput = z.looseObject({
  cycles: z.array(z.looseObject({}).describe('Linear API object.')).describe('cycles returned by Linear.').optional(),
}).describe('Linear action output.')

export const getIssueDefaultsInput = z.strictObject({
  team_id: z.string().min(1).describe('Linear resource ID.'),
}).describe('The input payload for this action.')

export const getIssueDefaultsOutput = z.looseObject({
  team: z.looseObject({}).describe('Linear API object.').optional(),
}).describe('Linear action output.')

export const getLinearIssueInput = z.strictObject({
  issue_id: z.string().min(1).describe('Linear resource ID.'),
}).describe('The input payload for this action.')

export const getLinearIssueOutput = z.looseObject({
  issue: z.looseObject({}).describe('Linear API object.').optional(),
}).describe('Linear action output.')

export const getLinearProjectInput = z.strictObject({
  project_id: z.string().min(1).describe('Linear resource ID.'),
  include_teams: z.boolean().describe('Include project teams.').optional(),
  include_members: z.boolean().describe('Include project members.').optional(),
  include_initiatives: z.boolean().describe('Include project initiatives.').optional(),
}).describe('The input payload for this action.')

export const getLinearProjectOutput = z.looseObject({
  project: z.looseObject({}).describe('Linear API object.').optional(),
}).describe('Linear action output.')

export const listIssuesByTeamIdInput = z.strictObject({
  after: z.string().describe('Pagination cursor.').optional(),
  first: z.int().min(1).describe('Number of records to return.').optional(),
  team_id: z.string().min(1).describe('Linear resource ID.'),
  include_archived: z.boolean().describe('Include archived issues.').optional(),
}).describe('The input payload for this action.')

export const listIssuesByTeamIdOutput = z.looseObject({
  team: z.looseObject({}).describe('Linear API object.').optional(),
  issues: z.array(z.looseObject({}).describe('Linear API object.')).optional(),
  page_info: z.looseObject({
    startCursor: z.string().describe('Previous-page start cursor.').nullable().optional(),
    endCursor: z.string().describe('Next-page end cursor.').nullable().optional(),
    hasPreviousPage: z.boolean().describe('Whether a previous page exists.').optional(),
    hasNextPage: z.boolean().describe('Whether a next page exists.').optional(),
    end_cursor: z.string().describe('Next-page end cursor.').nullable().optional(),
    has_next_page: z.boolean().describe('Whether a next page exists.').optional(),
  }).describe('Pagination information.').optional(),
}).describe('Linear action output.')

export const listIssueDraftsInput = z.strictObject({
  after: z.string().describe('Pagination cursor.').optional(),
  first: z.int().min(1).describe('Number of records to return.').optional(),
}).describe('The input payload for this action.')

export const listIssueDraftsOutput = z.looseObject({
  drafts: z.array(z.looseObject({}).describe('Linear API object.')).optional(),
  page_info: z.looseObject({
    startCursor: z.string().describe('Previous-page start cursor.').nullable().optional(),
    endCursor: z.string().describe('Next-page end cursor.').nullable().optional(),
    hasPreviousPage: z.boolean().describe('Whether a previous page exists.').optional(),
    hasNextPage: z.boolean().describe('Whether a next page exists.').optional(),
    end_cursor: z.string().describe('Next-page end cursor.').nullable().optional(),
    has_next_page: z.boolean().describe('Whether a next page exists.').optional(),
  }).describe('Pagination information.').optional(),
}).describe('Linear action output.')

export const listLinearCyclesInput = z.strictObject({}).describe('The input payload for this action.')

export const listLinearCyclesOutput = z.looseObject({
  cycles: z.array(z.looseObject({}).describe('Linear API object.')).describe('cycles returned by Linear.').optional(),
}).describe('Linear action output.')

export const listLinearIssuesInput = z.strictObject({
  after: z.string().describe('Pagination cursor.').optional(),
  first: z.int().min(1).describe('Number of records to return.').optional(),
  project_id: z.string().min(1).describe('Linear resource ID.').optional(),
  assignee_id: z.string().min(1).describe('Linear resource ID.').optional(),
}).describe('The input payload for this action.')

export const listLinearIssuesOutput = z.looseObject({
  issues: z.array(z.looseObject({}).describe('Linear API object.')).optional(),
  page_info: z.looseObject({
    startCursor: z.string().describe('Previous-page start cursor.').nullable().optional(),
    endCursor: z.string().describe('Next-page end cursor.').nullable().optional(),
    hasPreviousPage: z.boolean().describe('Whether a previous page exists.').optional(),
    hasNextPage: z.boolean().describe('Whether a next page exists.').optional(),
    end_cursor: z.string().describe('Next-page end cursor.').nullable().optional(),
    has_next_page: z.boolean().describe('Whether a next page exists.').optional(),
  }).describe('Pagination information.').optional(),
}).describe('Linear action output.')

export const listLinearLabelsInput = z.strictObject({
  team_id: z.string().min(1).describe('Linear resource ID.').optional(),
}).describe('The input payload for this action.')

export const listLinearLabelsOutput = z.looseObject({
  labels: z.array(z.looseObject({}).describe('Linear API object.')).describe('labels returned by Linear.').optional(),
}).describe('Linear action output.')

export const listLinearProjectsInput = z.strictObject({}).describe('The input payload for this action.')

export const listLinearProjectsOutput = z.looseObject({
  projects: z.array(z.looseObject({}).describe('Linear API object.')).describe('projects returned by Linear.').optional(),
}).describe('Linear action output.')

export const listLinearStatesInput = z.strictObject({
  team_id: z.string().min(1).describe('Linear resource ID.'),
}).describe('The input payload for this action.')

export const listLinearStatesOutput = z.looseObject({
  states: z.array(z.looseObject({}).describe('Linear API object.')).describe('states returned by Linear.').optional(),
}).describe('Linear action output.')

export const listLinearTeamsInput = z.strictObject({
  project_id: z.string().min(1).describe('Linear resource ID.').optional(),
}).describe('The input payload for this action.')

export const listLinearTeamsOutput = z.looseObject({
  teams: z.array(z.looseObject({}).describe('Linear API object.')).describe('teams returned by Linear.').optional(),
}).describe('Linear action output.')

export const listLinearUsersInput = z.strictObject({
  after: z.string().describe('Pagination cursor.').optional(),
  first: z.int().min(1).describe('Number of records to return.').optional(),
}).describe('The input payload for this action.')

export const listLinearUsersOutput = z.looseObject({
  users: z.array(z.looseObject({}).describe('Linear API object.')).optional(),
  page_info: z.looseObject({
    startCursor: z.string().describe('Previous-page start cursor.').nullable().optional(),
    endCursor: z.string().describe('Next-page end cursor.').nullable().optional(),
    hasPreviousPage: z.boolean().describe('Whether a previous page exists.').optional(),
    hasNextPage: z.boolean().describe('Whether a next page exists.').optional(),
    end_cursor: z.string().describe('Next-page end cursor.').nullable().optional(),
    has_next_page: z.boolean().describe('Whether a next page exists.').optional(),
  }).describe('Pagination information.').optional(),
}).describe('Linear action output.')

export const removeIssueLabelInput = z.strictObject({
  issue_id: z.string().min(1).describe('Linear resource ID.'),
  label_id: z.string().min(1).describe('Linear resource ID.'),
}).describe('The input payload for this action.')

export const removeIssueLabelOutput = z.looseObject({
  issue_id: z.string().min(1).describe('Linear resource ID.').optional(),
  label_id: z.string().min(1).describe('Linear resource ID.').optional(),
  removed: z.boolean().optional(),
}).describe('Linear action output.')

export const removeReactionInput = z.strictObject({
  reaction_id: z.string().min(1).describe('Linear resource ID.'),
}).describe('The input payload for this action.')

export const removeReactionOutput = z.looseObject({
  reaction_id: z.string().min(1).describe('Linear resource ID.').optional(),
  removed: z.boolean().optional(),
}).describe('Linear action output.')

export const runQueryInput = z.strictObject({
  query: z.string().min(1),
  variables: z.looseObject({}).describe('Linear API object.').optional(),
}).describe('The input payload for this action.')

export const runQueryOutput = z.looseObject({
  data: z.looseObject({}).describe('Linear API object.').nullable().optional(),
  errors: z.array(z.looseObject({}).describe('Linear API object.')).describe('GraphQL errors.').optional(),
  extensions: z.looseObject({}).describe('Linear API object.').optional(),
  message: z.string().describe('Summarized execution status.').optional(),
}).describe('Raw GraphQL response.')

export const runMutationInput = z.strictObject({
  mutation: z.string().min(1),
  variables: z.looseObject({}).describe('Linear API object.').optional(),
}).describe('The input payload for this action.')

export const runMutationOutput = z.looseObject({
  data: z.looseObject({}).describe('Linear API object.').nullable().optional(),
  errors: z.array(z.looseObject({}).describe('Linear API object.')).describe('GraphQL errors.').optional(),
  extensions: z.looseObject({}).describe('Linear API object.').optional(),
  message: z.string().describe('Summarized execution status.').optional(),
}).describe('Raw GraphQL response.')

export const searchIssuesInput = z.strictObject({
  query: z.string().min(1).describe('Search query.'),
  after: z.string().describe('Pagination cursor.').optional(),
  first: z.int().min(1).describe('Number of records to return.').optional(),
  include_archived: z.boolean().describe('Include archived issues.').optional(),
}).describe('The input payload for this action.')

export const searchIssuesOutput = z.looseObject({
  issues: z.array(z.looseObject({}).describe('Linear API object.')).optional(),
  page_info: z.looseObject({
    startCursor: z.string().describe('Previous-page start cursor.').nullable().optional(),
    endCursor: z.string().describe('Next-page end cursor.').nullable().optional(),
    hasPreviousPage: z.boolean().describe('Whether a previous page exists.').optional(),
    hasNextPage: z.boolean().describe('Whether a next page exists.').optional(),
    end_cursor: z.string().describe('Next-page end cursor.').nullable().optional(),
    has_next_page: z.boolean().describe('Whether a next page exists.').optional(),
  }).describe('Pagination information.').optional(),
  total_count: z.int().optional(),
}).describe('Linear action output.')

export const updateIssueInput = z.strictObject({
  issueId: z.string().min(1).describe('Linear resource ID.'),
  title: z.string().describe('Issue title.').optional(),
  teamId: z.string().min(1).describe('Linear resource ID.').optional(),
  cycleId: z.string().min(1).describe('Linear resource ID.').optional(),
  dueDate: z.string().describe('Issue due date.').optional(),
  stateId: z.string().min(1).describe('Linear resource ID.').optional(),
  estimate: z.number().describe('Issue estimate.').optional(),
  labelIds: z.array(z.string().min(1).describe('Linear resource ID.')).describe('Label IDs.').optional(),
  parentId: z.string().min(1).describe('Linear resource ID.').optional(),
  priority: z.number().describe('Issue priority.').optional(),
  projectId: z.string().min(1).describe('Linear resource ID.').optional(),
  assigneeId: z.string().min(1).describe('Linear resource ID.').optional(),
  description: z.string().describe('Issue description in Markdown.').optional(),
}).describe('The input payload for this action.')

export const updateIssueOutput = z.looseObject({
  issue: z.looseObject({}).describe('Linear API object.').optional(),
}).describe('Linear action output.')

export const updateLinearCommentInput = z.strictObject({
  comment_id: z.string().min(1).describe('Linear resource ID.'),
  body: z.string().min(1),
}).describe('The input payload for this action.')

export const updateLinearCommentOutput = z.looseObject({
  comment: z.looseObject({}).describe('Linear API object.').optional(),
}).describe('Linear action output.')

export const updateLinearProjectInput = z.strictObject({
  project_id: z.string().min(1).describe('Linear resource ID.'),
  icon: z.string().describe('Project icon.').optional(),
  name: z.string().min(1).describe('Project name.').optional(),
  color: z.string().describe('Project color.').optional(),
  lead_id: z.string().min(1).describe('Linear resource ID.').optional(),
  priority: z.number().describe('Project priority.').optional(),
  status_id: z.string().min(1).describe('Linear resource ID.').optional(),
  state: z.string().describe('Project state type.').optional(),
  start_date: z.string().describe('Project start date.').optional(),
  description: z.string().describe('Project description.').optional(),
  target_date: z.string().describe('Project target date.').optional(),
}).describe('The input payload for this action.')

export const updateLinearProjectOutput = z.looseObject({
  project: z.looseObject({}).describe('Linear API object.').optional(),
}).describe('Linear action output.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const linearActions = {
  create_attachment: {
    description: 'Create or update an attachment for the specified Linear issue.',
    effect: 'write',
    inputSchema: createAttachmentInput,
    outputSchema: z.toJSONSchema(createAttachmentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_comment_reaction: {
    description: 'Creates an emoji reaction for the specified Linear comment.',
    effect: 'write',
    inputSchema: createCommentReactionInput,
    outputSchema: z.toJSONSchema(createCommentReactionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_linear_comment: {
    description: 'Creates a comment for the specified Linear issue.',
    effect: 'write',
    inputSchema: createLinearCommentInput,
    outputSchema: z.toJSONSchema(createLinearCommentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_linear_issue: {
    description: 'Create a new Linear issue in the specified team and support fields such as project, person in charge, status, label, etc.',
    effect: 'write',
    inputSchema: createLinearIssueInput,
    outputSchema: z.toJSONSchema(createLinearIssueOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_linear_issue_relation: {
    description: 'Create a relationship between two Linear issues, such as blocks, related, or duplicate.',
    effect: 'write',
    inputSchema: createLinearIssueRelationInput,
    outputSchema: z.toJSONSchema(createLinearIssueRelationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_linear_label: {
    description: 'Creates a new Linear issue label in the specified team.',
    effect: 'write',
    inputSchema: createLinearLabelInput,
    outputSchema: z.toJSONSchema(createLinearLabelOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_linear_project: {
    description: 'Create a new Linear project and associate one or more teams.',
    effect: 'write',
    inputSchema: createLinearProjectInput,
    outputSchema: z.toJSONSchema(createLinearProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_project_milestone: {
    description: 'Creates a project milestone for the specified Linear project.',
    effect: 'write',
    inputSchema: createProjectMilestoneInput,
    outputSchema: z.toJSONSchema(createProjectMilestoneOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_project_update: {
    description: 'Creates a project progress update for the specified Linear project.',
    effect: 'write',
    inputSchema: createProjectUpdateInput,
    outputSchema: z.toJSONSchema(createProjectUpdateOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_linear_issue: {
    description: 'Delete the specified Linear issue.',
    effect: 'destructive',
    inputSchema: deleteLinearIssueInput,
    outputSchema: z.toJSONSchema(deleteLinearIssueOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_all_linear_teams: {
    description: 'Lists all Linear team basic information accessible with the current credentials.',
    effect: 'read',
    inputSchema: getAllLinearTeamsInput,
    outputSchema: z.toJSONSchema(getAllLinearTeamsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_attachment: {
    description: 'Retrieve a Linear attachment based on the issue and attachment ID or file name.',
    effect: 'read',
    inputSchema: getAttachmentInput,
    outputSchema: z.toJSONSchema(getAttachmentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_current_user: {
    description: 'Get the currently authenticated Linear user profile.',
    effect: 'read',
    inputSchema: getCurrentUserInput,
    outputSchema: z.toJSONSchema(getCurrentUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_cycles_by_team_id: {
    description: 'Get all cycle information under the specified team.',
    effect: 'read',
    inputSchema: getCyclesByTeamIdInput,
    outputSchema: z.toJSONSchema(getCyclesByTeamIdOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_issue_defaults: {
    description: 'Gets the default status and default estimate used when the specified team creates an issue.',
    effect: 'read',
    inputSchema: getIssueDefaultsInput,
    outputSchema: z.toJSONSchema(getIssueDefaultsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_linear_issue: {
    description: 'Get details of a Linear issue, including comments, attachments, subscribers, and underlying relationship fields.',
    effect: 'read',
    inputSchema: getLinearIssueInput,
    outputSchema: z.toJSONSchema(getLinearIssueOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_linear_project: {
    description: 'Get the details of a Linear project, complete with team, members, and initiatives on demand.',
    effect: 'read',
    inputSchema: getLinearProjectInput,
    outputSchema: z.toJSONSchema(getLinearProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_issues_by_team_id: {
    description: 'List Linear issues by team, and support cursor paging and whether to include archived issues.',
    effect: 'read',
    inputSchema: listIssuesByTeamIdInput,
    outputSchema: z.toJSONSchema(listIssuesByTeamIdOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_issue_drafts: {
    description: 'Lists issue drafts visible to the current user in Linear.',
    effect: 'read',
    inputSchema: listIssueDraftsInput,
    outputSchema: z.toJSONSchema(listIssueDraftsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_linear_cycles: {
    description: 'Lists the Linear periods accessible by the current credential.',
    effect: 'read',
    inputSchema: listLinearCyclesInput,
    outputSchema: z.toJSONSchema(listLinearCyclesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_linear_issues: {
    description: 'Lists Linear issues accessible with current credentials, and supports filtering by project and person in charge.',
    effect: 'read',
    inputSchema: listLinearIssuesInput,
    outputSchema: z.toJSONSchema(listLinearIssuesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_linear_labels: {
    description: 'Lists Linear labels for a specified team or entire workspace.',
    effect: 'read',
    inputSchema: listLinearLabelsInput,
    outputSchema: z.toJSONSchema(listLinearLabelsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_linear_projects: {
    description: 'Lists Linear projects accessible with the current credentials.',
    effect: 'read',
    inputSchema: listLinearProjectsInput,
    outputSchema: z.toJSONSchema(listLinearProjectsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_linear_states: {
    description: 'Lists all workflow statuses for the specified team.',
    effect: 'read',
    inputSchema: listLinearStatesInput,
    outputSchema: z.toJSONSchema(listLinearStatesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_linear_teams: {
    description: 'Lists Linear teams accessible with current credentials, along with a list of members and projects.',
    effect: 'read',
    inputSchema: listLinearTeamsInput,
    outputSchema: z.toJSONSchema(listLinearTeamsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_linear_users: {
    description: 'List Linear users in the current workspace and support cursor paging.',
    effect: 'read',
    inputSchema: listLinearUsersInput,
    outputSchema: z.toJSONSchema(listLinearUsersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  remove_issue_label: {
    description: 'Removes a label from the specified Linear issue.',
    effect: 'destructive',
    inputSchema: removeIssueLabelInput,
    outputSchema: z.toJSONSchema(removeIssueLabelOutput, { io: 'output', unrepresentable: 'any' }),
  },
  remove_reaction: {
    description: 'Delete an existing Linear reaction.',
    effect: 'destructive',
    inputSchema: removeReactionInput,
    outputSchema: z.toJSONSchema(removeReactionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  run_query: {
    description: 'Execute a read-only query directly against the Linear GraphQL API.',
    effect: 'write',
    inputSchema: runQueryInput,
    outputSchema: z.toJSONSchema(runQueryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  run_mutation: {
    description: 'Perform a mutation directly on the Linear GraphQL API.',
    effect: 'write',
    inputSchema: runMutationInput,
    outputSchema: z.toJSONSchema(runMutationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_issues: {
    description: 'Retrieve issues through Linear\'s full-text search capabilities.',
    effect: 'read',
    inputSchema: searchIssuesInput,
    outputSchema: z.toJSONSchema(searchIssuesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_issue: {
    description: 'Update an existing Linear issue and support fields such as title, description, status, project, label, etc.',
    effect: 'write',
    inputSchema: updateIssueInput,
    outputSchema: z.toJSONSchema(updateIssueOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_linear_comment: {
    description: 'Update the text of an existing Linear comment.',
    effect: 'write',
    inputSchema: updateLinearCommentInput,
    outputSchema: z.toJSONSchema(updateLinearCommentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_linear_project: {
    description: 'Update an existing Linear project.',
    effect: 'write',
    inputSchema: updateLinearProjectInput,
    outputSchema: z.toJSONSchema(updateLinearProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
