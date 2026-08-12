/**
 * Todoist 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getCurrentUserInput = z.strictObject({}).describe('The input payload for this action.')

export const getCurrentUserOutput = z.strictObject({
  user: z.looseObject({}).describe('The raw Todoist object returned by the API.').optional(),
})

export const listProjectsInput = z.strictObject({
  folderId: z.union([z.int().describe('Optional Todoist folder ID to filter projects by.'), z.string().min(1).describe('Optional Todoist folder ID to filter projects by.')]).describe('Optional Todoist folder ID to filter projects by.').optional(),
  workspaceId: z.union([z.int().describe('Optional Todoist workspace ID to filter projects by.'), z.string().min(1).describe('Optional Todoist workspace ID to filter projects by.')]).describe('Optional Todoist workspace ID to filter projects by.').optional(),
  cursor: z.string().min(1).describe('Opaque pagination cursor returned by a previous Todoist response.').optional(),
  limit: z.int().min(1).max(200).describe('Maximum number of Todoist results to return in one page.').optional(),
}).describe('The input payload for this action.')

export const listProjectsOutput = z.strictObject({
  projects: z.array(z.looseObject({}).describe('A Todoist project.')).describe('The Todoist projects returned for the page.').optional(),
  nextCursor: z.string().describe('Cursor for the next page, or null when no further page exists.').nullable().optional(),
})

export const getProjectInput = z.strictObject({
  projectId: z.string().min(1).describe('Todoist project ID.').optional(),
}).describe('The input payload for this action.')

export const getProjectOutput = z.strictObject({
  project: z.looseObject({}).describe('The raw Todoist object returned by the API.').optional(),
})

export const createProjectInput = z.strictObject({
  name: z.string().min(1).describe('Todoist project name.'),
  description: z.string().describe('Todoist project description.').optional(),
  parentId: z.string().describe('Parent project ID, or null where the API supports clearing it.').nullable().optional(),
  color: z.union([z.enum(['berry_red', 'red', 'orange', 'yellow', 'olive_green', 'lime_green', 'green', 'mint_green', 'teal', 'sky_blue', 'light_blue', 'blue', 'grape', 'violet', 'lavender', 'magenta', 'salmon', 'charcoal', 'grey', 'taupe']).describe('Todoist color name.'), z.int().min(30).max(49).describe('Todoist legacy numeric color code.')]).describe('Todoist color value as a named palette entry or legacy numeric code.').optional(),
  isFavorite: z.boolean().describe('Whether the project is a favorite.').optional(),
  viewStyle: z.enum(['list', 'board', 'calendar']).describe('Todoist project view style.').optional(),
  workspaceId: z.union([z.int().describe('Todoist workspace ID for creating a workspace-scoped project.'), z.string().min(1).describe('Todoist workspace ID for creating a workspace-scoped project.')]).describe('Todoist workspace ID for creating a workspace-scoped project.').optional(),
}).describe('The input payload for this action.')

export const createProjectOutput = z.strictObject({
  project: z.looseObject({}).describe('The raw Todoist object returned by the API.').optional(),
})

export const updateProjectInput = z.strictObject({
  projectId: z.string().min(1).describe('Todoist project ID.'),
  name: z.string().describe('Updated project name.').nullable().optional(),
  description: z.string().describe('Updated project description.').nullable().optional(),
  color: z.union([z.enum(['berry_red', 'red', 'orange', 'yellow', 'olive_green', 'lime_green', 'green', 'mint_green', 'teal', 'sky_blue', 'light_blue', 'blue', 'grape', 'violet', 'lavender', 'magenta', 'salmon', 'charcoal', 'grey', 'taupe']).describe('Todoist color name.'), z.int().min(30).max(49).describe('Todoist legacy numeric color code.')]).describe('Todoist color value as a named palette entry or legacy numeric code.').nullable().optional(),
  isFavorite: z.boolean().describe('Updated favorite flag.').nullable().optional(),
  viewStyle: z.enum(['list', 'board', 'calendar']).describe('Todoist project view style.').nullable().optional(),
  childOrder: z.int().describe('Updated project order among sibling projects.').nullable().optional(),
  isCollapsed: z.boolean().describe('Updated collapsed state of the project.').nullable().optional(),
  folderId: z.int().describe('Updated folder ID for a workspace project.').nullable().optional(),
}).describe('The input payload for this action.')

export const updateProjectOutput = z.strictObject({
  project: z.looseObject({}).describe('The raw Todoist object returned by the API.').optional(),
})

export const listSectionsInput = z.strictObject({
  projectId: z.string().min(1).describe('Optional Todoist project ID.').optional(),
  cursor: z.string().min(1).describe('Opaque pagination cursor returned by a previous Todoist response.').optional(),
  limit: z.int().min(1).max(200).describe('Maximum number of Todoist results to return in one page.').optional(),
}).describe('The input payload for this action.')

export const listSectionsOutput = z.strictObject({
  sections: z.array(z.looseObject({}).describe('A Todoist section.')).describe('The Todoist sections returned for the page.').optional(),
  nextCursor: z.string().describe('Cursor for the next page, or null when no further page exists.').nullable().optional(),
})

export const getSectionInput = z.strictObject({
  sectionId: z.string().min(1).describe('Todoist section ID.').optional(),
}).describe('The input payload for this action.')

export const getSectionOutput = z.strictObject({
  section: z.looseObject({}).describe('The raw Todoist object returned by the API.').optional(),
})

export const createSectionInput = z.strictObject({
  projectId: z.string().min(1).describe('Todoist project ID that will own the section.'),
  name: z.string().min(1).describe('Todoist section name.'),
  order: z.int().describe('Optional section order within the project.').optional(),
}).describe('The input payload for this action.')

export const createSectionOutput = z.strictObject({
  section: z.looseObject({}).describe('The raw Todoist object returned by the API.').optional(),
})

export const updateSectionInput = z.strictObject({
  sectionId: z.string().min(1).describe('Todoist section ID.'),
  name: z.string().describe('Updated section name.').nullable().optional(),
  sectionOrder: z.int().describe('Updated section order.').nullable().optional(),
  isCollapsed: z.boolean().describe('Updated collapsed state of the section.').nullable().optional(),
}).describe('The input payload for this action.')

export const updateSectionOutput = z.strictObject({
  section: z.looseObject({}).describe('The raw Todoist object returned by the API.').optional(),
})

export const listTasksInput = z.strictObject({
  projectId: z.string().min(1).describe('Optional Todoist project ID filter.').optional(),
  sectionId: z.string().min(1).describe('Optional Todoist section ID filter.').optional(),
  parentId: z.string().min(1).describe('Optional Todoist parent task ID filter.').optional(),
  label: z.string().min(1).describe('Optional Todoist label name filter.').optional(),
  ids: z.array(z.string().min(1)).min(1).describe('Explicit Todoist task IDs to fetch.').optional(),
  goalId: z.string().min(1).describe('Optional Todoist goal ID filter.').optional(),
  cursor: z.string().min(1).describe('Opaque pagination cursor returned by a previous Todoist response.').optional(),
  limit: z.int().min(1).max(200).describe('Maximum number of Todoist results to return in one page.').optional(),
}).describe('The input payload for this action.')

export const listTasksOutput = z.strictObject({
  tasks: z.array(z.looseObject({}).describe('A Todoist task.')).describe('The Todoist tasks returned for the page.').optional(),
  nextCursor: z.string().describe('Cursor for the next page, or null when no further page exists.').nullable().optional(),
})

export const getTaskInput = z.strictObject({
  taskId: z.string().min(1).describe('Todoist task ID.').optional(),
}).describe('The input payload for this action.')

export const getTaskOutput = z.strictObject({
  task: z.looseObject({}).describe('The raw Todoist object returned by the API.').optional(),
})

export const createTaskInput = z.strictObject({
  content: z.string().min(1).describe('Todoist task title.'),
  description: z.string().describe('Todoist task description.').optional(),
  projectId: z.string().min(1).describe('Project ID that will own the task.').optional(),
  sectionId: z.string().min(1).describe('Section ID that will own the task.').optional(),
  parentId: z.string().min(1).describe('Parent task ID.').optional(),
  order: z.int().describe('Task order.').optional(),
  labels: z.array(z.string().min(1)).min(1).describe('Todoist label names to attach.').optional(),
  priority: z.int().min(1).max(4).describe('Todoist priority from 1 to 4.').optional(),
  assigneeId: z.int().describe('Todoist user ID to assign, or null where supported.').nullable().optional(),
  dueString: z.string().min(1).describe('Natural language due date string.').optional(),
  dueDate: z.iso.date().describe('Due date in YYYY-MM-DD format.').optional(),
  dueDatetime: z.iso.datetime({ offset: true }).describe('Due date-time in RFC 3339 form.').optional(),
  dueLang: z.string().min(1).describe('Language code used to parse the due string.').optional(),
  duration: z.int().describe('Duration amount.').optional(),
  durationUnit: z.enum(['minute', 'day']).describe('Todoist duration unit.').optional(),
  deadlineDate: z.iso.date().describe('Deadline date in YYYY-MM-DD format.').optional(),
  childOrder: z.int().describe('Task order among siblings.').optional(),
  isCollapsed: z.boolean().describe('Whether subtasks are collapsed.').optional(),
  dayOrder: z.int().describe('Task order in Today and Upcoming.').optional(),
}).describe('The input payload for this action.')

export const createTaskOutput = z.strictObject({
  task: z.looseObject({}).describe('The raw Todoist object returned by the API.').optional(),
})

export const updateTaskInput = z.strictObject({
  taskId: z.string().min(1).describe('Todoist task ID.'),
  content: z.string().min(1).describe('Todoist task title.').optional(),
  description: z.string().describe('Todoist task description.').optional(),
  projectId: z.string().min(1).describe('Project ID that will own the task.').optional(),
  sectionId: z.string().min(1).describe('Section ID that will own the task.').optional(),
  parentId: z.string().min(1).describe('Parent task ID.').optional(),
  order: z.int().describe('Task order.').optional(),
  labels: z.array(z.string().min(1)).min(1).describe('Todoist label names to attach.').optional(),
  priority: z.int().min(1).max(4).describe('Todoist priority from 1 to 4.').optional(),
  assigneeId: z.int().describe('Todoist user ID to assign, or null where supported.').nullable().optional(),
  dueString: z.string().min(1).describe('Natural language due date string.').optional(),
  dueDate: z.iso.date().describe('Due date in YYYY-MM-DD format.').optional(),
  dueDatetime: z.iso.datetime({ offset: true }).describe('Due date-time in RFC 3339 form.').optional(),
  dueLang: z.string().min(1).describe('Language code used to parse the due string.').optional(),
  duration: z.int().describe('Duration amount.').optional(),
  durationUnit: z.enum(['minute', 'day']).describe('Todoist duration unit.').optional(),
  deadlineDate: z.iso.date().describe('Deadline date in YYYY-MM-DD format.').optional(),
  childOrder: z.int().describe('Task order among siblings.').optional(),
  isCollapsed: z.boolean().describe('Whether subtasks are collapsed.').optional(),
  dayOrder: z.int().describe('Task order in Today and Upcoming.').optional(),
}).describe('The input payload for this action.')

export const updateTaskOutput = z.strictObject({
  task: z.looseObject({}).describe('The raw Todoist object returned by the API.').optional(),
})

export const closeTaskInput = z.strictObject({
  taskId: z.string().min(1).describe('Todoist task ID.').optional(),
}).describe('The input payload for this action.')

export const closeTaskOutput = z.strictObject({
  success: z.literal(true).optional(),
})

export const listCommentsInput = z.strictObject({
  taskId: z.string().min(1).describe('Optional task ID filter.').optional(),
  projectId: z.string().min(1).describe('Optional project ID filter.').optional(),
  cursor: z.string().min(1).describe('Opaque pagination cursor returned by a previous Todoist response.').optional(),
  limit: z.int().min(1).max(200).describe('Maximum number of Todoist results to return in one page.').optional(),
}).describe('The input payload for this action.')

export const listCommentsOutput = z.strictObject({
  comments: z.array(z.looseObject({}).describe('A Todoist comment.')).describe('The Todoist comments returned for the page.').optional(),
  nextCursor: z.string().describe('Cursor for the next page, or null when no further page exists.').nullable().optional(),
})

export const getCommentInput = z.strictObject({
  commentId: z.string().min(1).describe('Todoist comment ID.').optional(),
}).describe('The input payload for this action.')

export const getCommentOutput = z.strictObject({
  comment: z.looseObject({}).describe('The raw Todoist object returned by the API.').optional(),
})

export const createCommentInput = z.strictObject({
  content: z.string().min(1).describe('Todoist comment content.'),
  taskId: z.string().min(1).describe('Task ID that owns the comment.').optional(),
  projectId: z.string().min(1).describe('Project ID that owns the comment.').optional(),
  attachment: z.strictObject({
    fileUrl: z.url().describe('Attachment download URL.').optional(),
    fileName: z.string().describe('Attachment file name.').optional(),
    fileType: z.string().describe('Attachment MIME type.').optional(),
    resourceType: z.string().describe('Attachment resource type.').optional(),
  }).describe('Todoist comment attachment metadata.').optional(),
  uidsToNotify: z.array(z.int().describe('A Todoist user ID.')).min(1).describe('Todoist user IDs to notify.').optional(),
}).describe('The input payload for this action.')

export const createCommentOutput = z.strictObject({
  comment: z.looseObject({}).describe('The raw Todoist object returned by the API.').optional(),
})

export const updateCommentInput = z.strictObject({
  commentId: z.string().min(1).describe('Todoist comment ID.').optional(),
  content: z.string().min(1).describe('Updated Todoist comment content.').optional(),
}).describe('The input payload for this action.')

export const updateCommentOutput = z.strictObject({
  comment: z.looseObject({}).describe('The raw Todoist object returned by the API.').optional(),
})

export const listLabelsInput = z.strictObject({
  cursor: z.string().min(1).describe('Opaque pagination cursor returned by a previous Todoist response.').optional(),
  limit: z.int().min(1).max(200).describe('Maximum number of Todoist results to return in one page.').optional(),
}).describe('The input payload for this action.')

export const listLabelsOutput = z.strictObject({
  labels: z.array(z.looseObject({}).describe('A Todoist label.')).describe('The Todoist labels returned for the page.').optional(),
  nextCursor: z.string().describe('Cursor for the next page, or null when no further page exists.').nullable().optional(),
})

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const todoistActions = {
  get_current_user: {
    description: 'Get the current Todoist user profile.',
    effect: 'read',
    inputSchema: getCurrentUserInput,
    outputSchema: z.toJSONSchema(getCurrentUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_projects: {
    description: 'List Todoist projects visible to the connected account.',
    effect: 'read',
    inputSchema: listProjectsInput,
    outputSchema: z.toJSONSchema(listProjectsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_project: {
    description: 'Get one Todoist project by ID.',
    effect: 'read',
    inputSchema: getProjectInput,
    outputSchema: z.toJSONSchema(getProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_project: {
    description: 'Create a Todoist project.',
    effect: 'write',
    inputSchema: createProjectInput,
    outputSchema: z.toJSONSchema(createProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_project: {
    description: 'Update a Todoist project.',
    effect: 'write',
    inputSchema: updateProjectInput,
    outputSchema: z.toJSONSchema(updateProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_sections: {
    description: 'List Todoist sections, optionally scoped to a project.',
    effect: 'read',
    inputSchema: listSectionsInput,
    outputSchema: z.toJSONSchema(listSectionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_section: {
    description: 'Get one Todoist section by ID.',
    effect: 'read',
    inputSchema: getSectionInput,
    outputSchema: z.toJSONSchema(getSectionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_section: {
    description: 'Create a Todoist section.',
    effect: 'write',
    inputSchema: createSectionInput,
    outputSchema: z.toJSONSchema(createSectionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_section: {
    description: 'Update a Todoist section.',
    effect: 'write',
    inputSchema: updateSectionInput,
    outputSchema: z.toJSONSchema(updateSectionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_tasks: {
    description: 'List Todoist tasks using the API v1 filters.',
    effect: 'read',
    inputSchema: listTasksInput,
    outputSchema: z.toJSONSchema(listTasksOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_task: {
    description: 'Get one Todoist task by ID.',
    effect: 'read',
    inputSchema: getTaskInput,
    outputSchema: z.toJSONSchema(getTaskOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_task: {
    description: 'Create a Todoist task.',
    effect: 'write',
    inputSchema: createTaskInput,
    outputSchema: z.toJSONSchema(createTaskOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_task: {
    description: 'Update a Todoist task.',
    effect: 'write',
    inputSchema: updateTaskInput,
    outputSchema: z.toJSONSchema(updateTaskOutput, { io: 'output', unrepresentable: 'any' }),
  },
  close_task: {
    description: 'Close a Todoist task.',
    effect: 'write',
    inputSchema: closeTaskInput,
    outputSchema: z.toJSONSchema(closeTaskOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_comments: {
    description: 'List Todoist comments by task or project.',
    effect: 'read',
    inputSchema: listCommentsInput,
    outputSchema: z.toJSONSchema(listCommentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_comment: {
    description: 'Get one Todoist comment by ID.',
    effect: 'read',
    inputSchema: getCommentInput,
    outputSchema: z.toJSONSchema(getCommentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_comment: {
    description: 'Create a Todoist comment on a task or project.',
    effect: 'write',
    inputSchema: createCommentInput,
    outputSchema: z.toJSONSchema(createCommentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_comment: {
    description: 'Update a Todoist comment.',
    effect: 'write',
    inputSchema: updateCommentInput,
    outputSchema: z.toJSONSchema(updateCommentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_labels: {
    description: 'List Todoist labels visible to the connected account.',
    effect: 'read',
    inputSchema: listLabelsInput,
    outputSchema: z.toJSONSchema(listLabelsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
