/**
 * Mem0 —— 从 open-connector 迁移的 provider(api_key,10 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  addMemories,
  deleteMemory,
  getEvent,
  getEvents,
  getMemories,
  getMemory,
  getMemoryHistory,
  getUsers,
  searchMemories,
  updateMemory,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { mem0Actions } from './schema'

export type { ProviderEnv as Env }

export function createMem0Plugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Mem0',
    actions: mem0Actions,
    // 上游的 credentialValidators 打的就是 /v1/events/;它只读、无必填入参,平台空参调
    // 一次即可判定 key 是否可用(空参时不带分页,比上游的 page_size=1 多取一页,可接受)。
    credentialProbe: 'get_events',
    handlers: {
      add_memories: addMemories,
      get_memories: getMemories,
      search_memories: searchMemories,
      get_memory: getMemory,
      update_memory: updateMemory,
      delete_memory: deleteMemory,
      get_memory_history: getMemoryHistory,
      get_events: getEvents,
      get_event: getEvent,
      get_users: getUsers,
    },
  })
}

export default createMem0Plugin()
