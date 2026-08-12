/**
 * Langbase —— 从 open-connector 迁移的 provider(Memory API,4 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { createMemory, deleteMemory, listMemories, retrieveMemory } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { langbaseActions } from './schema'

export type { ProviderEnv as Env }

export function createLangbasePlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Langbase',
    actions: langbaseActions,
    handlers: {
      list_memories: listMemories,
      create_memory: createMemory,
      delete_memory: deleteMemory,
      retrieve_memory: retrieveMemory,
    },
  })
}

export default createLangbasePlugin()
