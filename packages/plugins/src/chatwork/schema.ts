/**
 * Chatwork 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getMeInput = z.strictObject({}).describe('This action does not require additional input.')

export const getMeOutput = z.strictObject({
  profile: z.looseObject({}).describe('Chatwork object returned by the API.').optional(),
})

export const getContactsInput = z.strictObject({}).describe('This action does not require additional input.')

export const getContactsOutput = z.strictObject({
  contacts: z.array(z.looseObject({}).describe('Chatwork object returned by the API.')).describe('The Chatwork contacts.').optional(),
})

export const listRoomsInput = z.strictObject({}).describe('This action does not require additional input.')

export const listRoomsOutput = z.strictObject({
  rooms: z.array(z.looseObject({}).describe('Chatwork object returned by the API.')).describe('The Chatwork rooms.').optional(),
})

export const getRoomInput = z.strictObject({
  roomId: z.int().min(1).describe('The Chatwork room ID.'),
})

export const getRoomOutput = z.strictObject({
  room: z.looseObject({}).describe('Chatwork object returned by the API.').optional(),
})

export const listRoomMembersInput = z.strictObject({
  roomId: z.int().min(1).describe('The Chatwork room ID.'),
})

export const listRoomMembersOutput = z.strictObject({
  members: z.array(z.looseObject({}).describe('Chatwork object returned by the API.')).describe('The Chatwork room members.').optional(),
})

export const listRoomMessagesInput = z.strictObject({
  roomId: z.int().min(1).describe('The Chatwork room ID.'),
  force: z.boolean().describe('Whether to force returning the latest 100 messages.').optional(),
})

export const listRoomMessagesOutput = z.strictObject({
  messages: z.array(z.looseObject({}).describe('Chatwork object returned by the API.')).describe('The Chatwork room messages.').optional(),
})

export const getMessageInput = z.strictObject({
  roomId: z.int().min(1).describe('The Chatwork room ID.'),
  messageId: z.string().min(1).describe('The Chatwork message ID.'),
})

export const getMessageOutput = z.strictObject({
  message: z.looseObject({}).describe('Chatwork object returned by the API.').optional(),
})

export const postMessageInput = z.strictObject({
  roomId: z.int().min(1).describe('The Chatwork room ID.'),
  body: z.string().min(1).describe('The message body.'),
  selfUnread: z.boolean().describe('Whether the posted message should remain unread for the sender.').optional(),
})

export const postMessageOutput = z.strictObject({
  messageId: z.string().min(1).describe('The Chatwork message ID.').optional(),
})

export const updateMessageInput = z.strictObject({
  roomId: z.int().min(1).describe('The Chatwork room ID.'),
  messageId: z.string().min(1).describe('The Chatwork message ID.'),
  body: z.string().min(1).describe('The updated message body.'),
})

export const updateMessageOutput = z.strictObject({
  messageId: z.string().min(1).describe('The Chatwork message ID.').optional(),
})

export const deleteMessageInput = z.strictObject({
  roomId: z.int().min(1).describe('The Chatwork room ID.'),
  messageId: z.string().min(1).describe('The Chatwork message ID.'),
})

export const deleteMessageOutput = z.strictObject({
  messageId: z.string().min(1).describe('The Chatwork message ID.').optional(),
})

export const listMyTasksInput = z.strictObject({
  assignedByAccountId: z.int().min(1).describe('The Chatwork account ID.').optional(),
  status: z.enum(['open', 'done']).describe('The task completion status.').optional(),
})

export const listMyTasksOutput = z.strictObject({
  tasks: z.array(z.looseObject({}).describe('Chatwork object returned by the API.')).describe('The Chatwork tasks.').optional(),
})

export const listRoomTasksInput = z.strictObject({
  roomId: z.int().min(1).describe('The Chatwork room ID.'),
  accountId: z.int().min(1).describe('The Chatwork account ID.').optional(),
  assignedByAccountId: z.int().min(1).describe('The Chatwork account ID.').optional(),
  status: z.enum(['open', 'done']).describe('The task completion status.').optional(),
})

export const listRoomTasksOutput = z.strictObject({
  tasks: z.array(z.looseObject({}).describe('Chatwork object returned by the API.')).describe('The Chatwork room tasks.').optional(),
})

export const getTaskInput = z.strictObject({
  roomId: z.int().min(1).describe('The Chatwork room ID.'),
  taskId: z.int().min(1).describe('The Chatwork task ID.'),
})

export const getTaskOutput = z.strictObject({
  task: z.looseObject({}).describe('Chatwork object returned by the API.').optional(),
})

export const createTaskInput = z.strictObject({
  roomId: z.int().min(1).describe('The Chatwork room ID.'),
  body: z.string().min(1).describe('The task body.'),
  assigneeAccountIds: z.array(z.int().min(1).describe('The Chatwork account ID.')).min(1).describe('The assignee Chatwork account IDs.'),
  limitTime: z.int().min(1).describe('The Unix timestamp deadline.').optional(),
  limitType: z.enum(['none', 'date', 'time']).describe('The deadline type.').optional(),
})

export const createTaskOutput = z.strictObject({
  taskIds: z.array(z.int().min(1).describe('The Chatwork task ID.')).describe('The created Chatwork task IDs.').optional(),
})

export const updateTaskStatusInput = z.strictObject({
  roomId: z.int().min(1).describe('The Chatwork room ID.'),
  taskId: z.int().min(1).describe('The Chatwork task ID.'),
  status: z.enum(['open', 'done']).describe('The task completion status.'),
})

export const updateTaskStatusOutput = z.strictObject({
  taskId: z.int().min(1).describe('The Chatwork task ID.').optional(),
})

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const chatworkActions = {
  get_me: {
    description: 'Get the authenticated Chatwork profile.',
    effect: 'read',
    inputSchema: getMeInput,
    outputSchema: z.toJSONSchema(getMeOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_contacts: {
    description: 'List Chatwork contacts visible to the authenticated account.',
    effect: 'read',
    inputSchema: getContactsInput,
    outputSchema: z.toJSONSchema(getContactsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_rooms: {
    description: 'List Chatwork rooms visible to the authenticated account.',
    effect: 'read',
    inputSchema: listRoomsInput,
    outputSchema: z.toJSONSchema(listRoomsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_room: {
    description: 'Get metadata for one Chatwork room.',
    effect: 'read',
    inputSchema: getRoomInput,
    outputSchema: z.toJSONSchema(getRoomOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_room_members: {
    description: 'List all members in one Chatwork room.',
    effect: 'read',
    inputSchema: listRoomMembersInput,
    outputSchema: z.toJSONSchema(listRoomMembersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_room_messages: {
    description: 'List messages in one Chatwork room.',
    effect: 'read',
    inputSchema: listRoomMessagesInput,
    outputSchema: z.toJSONSchema(listRoomMessagesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_message: {
    description: 'Get one message from a Chatwork room.',
    effect: 'read',
    inputSchema: getMessageInput,
    outputSchema: z.toJSONSchema(getMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  post_message: {
    description: 'Post a message to a Chatwork room.',
    effect: 'write',
    inputSchema: postMessageInput,
    outputSchema: z.toJSONSchema(postMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_message: {
    description: 'Update one message in a Chatwork room.',
    effect: 'write',
    inputSchema: updateMessageInput,
    outputSchema: z.toJSONSchema(updateMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_message: {
    description: 'Delete one message in a Chatwork room.',
    effect: 'destructive',
    inputSchema: deleteMessageInput,
    outputSchema: z.toJSONSchema(deleteMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_my_tasks: {
    description: 'List Chatwork tasks assigned to the authenticated account.',
    effect: 'read',
    inputSchema: listMyTasksInput,
    outputSchema: z.toJSONSchema(listMyTasksOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_room_tasks: {
    description: 'List tasks in one Chatwork room.',
    effect: 'read',
    inputSchema: listRoomTasksInput,
    outputSchema: z.toJSONSchema(listRoomTasksOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_task: {
    description: 'Get one task from a Chatwork room.',
    effect: 'read',
    inputSchema: getTaskInput,
    outputSchema: z.toJSONSchema(getTaskOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_task: {
    description: 'Create a task in a Chatwork room.',
    effect: 'write',
    inputSchema: createTaskInput,
    outputSchema: z.toJSONSchema(createTaskOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_task_status: {
    description: 'Update the completion status of one Chatwork task.',
    effect: 'write',
    inputSchema: updateTaskStatusInput,
    outputSchema: z.toJSONSchema(updateTaskStatusOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
