/**
 * Pivotal Tracker 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getCurrentUserInput = z.strictObject({}).describe('The input payload for getting the current Tracker user.')

export const getCurrentUserOutput = z.strictObject({
  user: z.looseObject({
    kind: z.string().describe('Resource kind returned by Tracker.').optional(),
    id: z.int().min(1).describe('The numeric Pivotal Tracker ID.').optional(),
    name: z.string().describe('User display name.').optional(),
    username: z.string().describe('Tracker username.').optional(),
    email: z.string().describe('User email address.').optional(),
    initials: z.string().describe('User initials.').optional(),
  }).describe('The Pivotal Tracker user returned by the API.').optional(),
}).describe('The response returned when getting the current Tracker user.')

export const listProjectsInput = z.strictObject({
  limit: z.int().min(1).describe('Maximum number of records to return.').optional(),
  offset: z.int().min(0).describe('Number of records to skip before returning results.').optional(),
  fields: z.string().min(1).regex(new RegExp('\\S')).describe('Optional Tracker fields selector.').optional(),
}).describe('The input payload for listing Tracker projects.')

export const listProjectsOutput = z.strictObject({
  projects: z.array(z.looseObject({
    kind: z.string().describe('Resource kind returned by Tracker.').optional(),
    id: z.int().min(1).describe('The numeric Pivotal Tracker ID.').optional(),
    name: z.string().describe('Project name.').optional(),
    version: z.int().describe('Project version returned by Tracker.').optional(),
    iteration_length: z.int().describe('Iteration length in weeks.').optional(),
    week_start_day: z.string().describe('Project week start day.').optional(),
    point_scale: z.string().describe('Project point scale.').optional(),
    account_id: z.int().min(1).describe('Account ID that owns the project.').optional(),
  }).describe('The Pivotal Tracker project returned by the API.')).describe('Projects returned by Tracker.').optional(),
}).describe('The response returned when listing Tracker projects.')

export const getProjectInput = z.strictObject({
  projectId: z.int().min(1).describe('The numeric Pivotal Tracker project ID.'),
  fields: z.string().min(1).regex(new RegExp('\\S')).describe('Optional Tracker fields selector.').optional(),
}).describe('The input payload for getting a Tracker project.')

export const getProjectOutput = z.strictObject({
  project: z.looseObject({
    kind: z.string().describe('Resource kind returned by Tracker.').optional(),
    id: z.int().min(1).describe('The numeric Pivotal Tracker ID.').optional(),
    name: z.string().describe('Project name.').optional(),
    version: z.int().describe('Project version returned by Tracker.').optional(),
    iteration_length: z.int().describe('Iteration length in weeks.').optional(),
    week_start_day: z.string().describe('Project week start day.').optional(),
    point_scale: z.string().describe('Project point scale.').optional(),
    account_id: z.int().min(1).describe('Account ID that owns the project.').optional(),
  }).describe('The Pivotal Tracker project returned by the API.').optional(),
}).describe('The response returned when getting a Tracker project.')

export const listProjectStoriesInput = z.strictObject({
  projectId: z.int().min(1).describe('The numeric Pivotal Tracker project ID.'),
  filter: z.string().min(1).regex(new RegExp('\\S')).describe('Tracker story filter query such as label:plans.').optional(),
  withState: z.enum(['unscheduled', 'unstarted', 'started', 'finished', 'delivered', 'accepted', 'rejected']).describe('Tracker story state.').optional(),
  withStoryType: z.enum(['feature', 'bug', 'chore', 'release']).describe('Tracker story type.').optional(),
  limit: z.int().min(1).describe('Maximum number of records to return.').optional(),
  offset: z.int().min(0).describe('Number of records to skip before returning results.').optional(),
  fields: z.string().min(1).regex(new RegExp('\\S')).describe('Optional Tracker fields selector.').optional(),
}).describe('The input payload for listing Tracker project stories.')

export const listProjectStoriesOutput = z.strictObject({
  stories: z.array(z.looseObject({
    kind: z.string().describe('Resource kind returned by Tracker.').optional(),
    id: z.int().min(1).describe('The numeric Pivotal Tracker ID.').optional(),
    project_id: z.int().min(1).describe('The numeric Pivotal Tracker project ID.').optional(),
    name: z.string().describe('Story name.').optional(),
    story_type: z.string().describe('Story type returned by Tracker.').optional(),
    current_state: z.string().describe('Current story state returned by Tracker.').optional(),
    url: z.string().describe('Browser URL for the story.').optional(),
    created_at: z.string().describe('Timestamp when the story was created.').optional(),
    updated_at: z.string().describe('Timestamp when the story was last updated.').optional(),
  }).describe('The Pivotal Tracker story returned by the API.')).describe('Stories returned by Tracker.').optional(),
}).describe('The response returned when listing Tracker stories.')

export const getStoryInput = z.strictObject({
  projectId: z.int().min(1).describe('The numeric Pivotal Tracker project ID.'),
  storyId: z.int().min(1).describe('The numeric Pivotal Tracker story ID.'),
  fields: z.string().min(1).regex(new RegExp('\\S')).describe('Optional Tracker fields selector.').optional(),
}).describe('The input payload for getting a Tracker story.')

export const getStoryOutput = z.strictObject({
  story: z.looseObject({
    kind: z.string().describe('Resource kind returned by Tracker.').optional(),
    id: z.int().min(1).describe('The numeric Pivotal Tracker ID.').optional(),
    project_id: z.int().min(1).describe('The numeric Pivotal Tracker project ID.').optional(),
    name: z.string().describe('Story name.').optional(),
    story_type: z.string().describe('Story type returned by Tracker.').optional(),
    current_state: z.string().describe('Current story state returned by Tracker.').optional(),
    url: z.string().describe('Browser URL for the story.').optional(),
    created_at: z.string().describe('Timestamp when the story was created.').optional(),
    updated_at: z.string().describe('Timestamp when the story was last updated.').optional(),
  }).describe('The Pivotal Tracker story returned by the API.').optional(),
}).describe('The response returned when getting a Tracker story.')

export const createStoryInput = z.strictObject({
  projectId: z.int().min(1).describe('The numeric Pivotal Tracker project ID.'),
  name: z.string().min(1).regex(new RegExp('\\S')).describe('Story name.'),
  storyType: z.enum(['feature', 'bug', 'chore', 'release']).describe('Tracker story type.').optional(),
  currentState: z.enum(['unscheduled', 'unstarted', 'started', 'finished', 'delivered', 'accepted', 'rejected']).describe('Tracker story state.').optional(),
  description: z.string().min(1).describe('Story description.').optional(),
  estimate: z.number().describe('Story estimate.').optional(),
  requestedById: z.int().min(1).describe('ID of the requester person.').optional(),
  ownerIds: z.array(z.int().min(1).describe('One numeric Tracker ID.')).min(1).describe('Numeric Tracker IDs.').optional(),
  labelNames: z.array(z.string().min(1).regex(new RegExp('\\S')).describe('One label name.')).min(1).describe('Label names to apply to the story.').optional(),
}).describe('The input payload for creating a Tracker story.')

export const createStoryOutput = z.strictObject({
  story: z.looseObject({
    kind: z.string().describe('Resource kind returned by Tracker.').optional(),
    id: z.int().min(1).describe('The numeric Pivotal Tracker ID.').optional(),
    project_id: z.int().min(1).describe('The numeric Pivotal Tracker project ID.').optional(),
    name: z.string().describe('Story name.').optional(),
    story_type: z.string().describe('Story type returned by Tracker.').optional(),
    current_state: z.string().describe('Current story state returned by Tracker.').optional(),
    url: z.string().describe('Browser URL for the story.').optional(),
    created_at: z.string().describe('Timestamp when the story was created.').optional(),
    updated_at: z.string().describe('Timestamp when the story was last updated.').optional(),
  }).describe('The Pivotal Tracker story returned by the API.').optional(),
}).describe('The response returned when creating a Tracker story.')

export const updateStoryStateInput = z.strictObject({
  projectId: z.int().min(1).describe('The numeric Pivotal Tracker project ID.').optional(),
  storyId: z.int().min(1).describe('The numeric Pivotal Tracker story ID.').optional(),
  currentState: z.enum(['unscheduled', 'unstarted', 'started', 'finished', 'delivered', 'accepted', 'rejected']).describe('Tracker story state.').optional(),
}).describe('The input payload for updating a Tracker story state.')

export const updateStoryStateOutput = z.strictObject({
  story: z.looseObject({
    kind: z.string().describe('Resource kind returned by Tracker.').optional(),
    id: z.int().min(1).describe('The numeric Pivotal Tracker ID.').optional(),
    project_id: z.int().min(1).describe('The numeric Pivotal Tracker project ID.').optional(),
    name: z.string().describe('Story name.').optional(),
    story_type: z.string().describe('Story type returned by Tracker.').optional(),
    current_state: z.string().describe('Current story state returned by Tracker.').optional(),
    url: z.string().describe('Browser URL for the story.').optional(),
    created_at: z.string().describe('Timestamp when the story was created.').optional(),
    updated_at: z.string().describe('Timestamp when the story was last updated.').optional(),
  }).describe('The Pivotal Tracker story returned by the API.').optional(),
}).describe('The response returned when updating a Tracker story state.')

export const listStoryCommentsInput = z.strictObject({
  projectId: z.int().min(1).describe('The numeric Pivotal Tracker project ID.'),
  storyId: z.int().min(1).describe('The numeric Pivotal Tracker story ID.'),
  limit: z.int().min(1).describe('Maximum number of records to return.').optional(),
  offset: z.int().min(0).describe('Number of records to skip before returning results.').optional(),
  fields: z.string().min(1).regex(new RegExp('\\S')).describe('Optional Tracker fields selector.').optional(),
}).describe('The input payload for listing Tracker story comments.')

export const listStoryCommentsOutput = z.strictObject({
  comments: z.array(z.looseObject({
    kind: z.string().describe('Resource kind returned by Tracker.').optional(),
    id: z.int().min(1).describe('The numeric Pivotal Tracker ID.').optional(),
    story_id: z.int().min(1).describe('The numeric Pivotal Tracker story ID.').optional(),
    person_id: z.int().min(1).describe('ID of the person who created the comment.').optional(),
    text: z.string().describe('Comment text.').optional(),
    created_at: z.string().describe('Timestamp when the comment was created.').optional(),
    updated_at: z.string().describe('Timestamp when the comment was last updated.').optional(),
  }).describe('The Pivotal Tracker story comment returned by the API.')).describe('Comments returned by Tracker.').optional(),
}).describe('The response returned when listing Tracker story comments.')

export const createStoryCommentInput = z.strictObject({
  projectId: z.int().min(1).describe('The numeric Pivotal Tracker project ID.').optional(),
  storyId: z.int().min(1).describe('The numeric Pivotal Tracker story ID.').optional(),
  text: z.string().min(1).regex(new RegExp('\\S')).describe('Comment text.').optional(),
}).describe('The input payload for creating a Tracker story comment.')

export const createStoryCommentOutput = z.strictObject({
  comment: z.looseObject({
    kind: z.string().describe('Resource kind returned by Tracker.').optional(),
    id: z.int().min(1).describe('The numeric Pivotal Tracker ID.').optional(),
    story_id: z.int().min(1).describe('The numeric Pivotal Tracker story ID.').optional(),
    person_id: z.int().min(1).describe('ID of the person who created the comment.').optional(),
    text: z.string().describe('Comment text.').optional(),
    created_at: z.string().describe('Timestamp when the comment was created.').optional(),
    updated_at: z.string().describe('Timestamp when the comment was last updated.').optional(),
  }).describe('The Pivotal Tracker story comment returned by the API.').optional(),
}).describe('The response returned when creating a Tracker story comment.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const pivotalTrackerActions = {
  get_current_user: {
    description: 'Get the Pivotal Tracker user associated with the API token.',
    effect: 'read',
    inputSchema: getCurrentUserInput,
    outputSchema: z.toJSONSchema(getCurrentUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_projects: {
    description: 'List Pivotal Tracker projects visible to the API token.',
    effect: 'read',
    inputSchema: listProjectsInput,
    outputSchema: z.toJSONSchema(listProjectsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_project: {
    description: 'Get one Pivotal Tracker project by ID.',
    effect: 'read',
    inputSchema: getProjectInput,
    outputSchema: z.toJSONSchema(getProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_project_stories: {
    description: 'List stories in a Pivotal Tracker project with optional filters.',
    effect: 'read',
    inputSchema: listProjectStoriesInput,
    outputSchema: z.toJSONSchema(listProjectStoriesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_story: {
    description: 'Get one Pivotal Tracker story by project ID and story ID.',
    effect: 'read',
    inputSchema: getStoryInput,
    outputSchema: z.toJSONSchema(getStoryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_story: {
    description: 'Create a Pivotal Tracker story in a project.',
    effect: 'write',
    inputSchema: createStoryInput,
    outputSchema: z.toJSONSchema(createStoryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_story_state: {
    description: 'Update the current state of a Pivotal Tracker story.',
    effect: 'write',
    inputSchema: updateStoryStateInput,
    outputSchema: z.toJSONSchema(updateStoryStateOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_story_comments: {
    description: 'List text comments on a Pivotal Tracker story.',
    effect: 'read',
    inputSchema: listStoryCommentsInput,
    outputSchema: z.toJSONSchema(listStoryCommentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_story_comment: {
    description: 'Create a text comment on a Pivotal Tracker story.',
    effect: 'write',
    inputSchema: createStoryCommentInput,
    outputSchema: z.toJSONSchema(createStoryCommentOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
