/**
 * Chatwork —— 从 open-connector 迁移的 provider(api_key,15 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  createTask,
  deleteMessage,
  getContacts,
  getMe,
  getMessage,
  getRoom,
  getTask,
  listMyTasks,
  listRoomMembers,
  listRoomMessages,
  listRooms,
  listRoomTasks,
  postMessage,
  updateMessage,
  updateTaskStatus,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { chatworkActions } from './schema'

export type { ProviderEnv as Env }

export function createChatworkPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Chatwork',
    actions: chatworkActions,
    // 上游 credentialValidators 也是打 /me 验凭证:只读、无入参,直接沿用。
    credentialProbe: 'get_me',
    handlers: {
      get_me: getMe,
      get_contacts: getContacts,
      list_rooms: listRooms,
      get_room: getRoom,
      list_room_members: listRoomMembers,
      list_room_messages: listRoomMessages,
      get_message: getMessage,
      post_message: postMessage,
      update_message: updateMessage,
      delete_message: deleteMessage,
      list_my_tasks: listMyTasks,
      list_room_tasks: listRoomTasks,
      get_task: getTask,
      create_task: createTask,
      update_task_status: updateTaskStatus,
    },
  })
}

export default createChatworkPlugin()
