/**
 * CustomGPT.ai —— 从 open-connector 迁移的 provider(api_key,7 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  createConversation,
  getAgent,
  listAgents,
  listConversations,
  listDocuments,
  listMessages,
  sendMessage,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { customgptActions } from './schema'

export type { ProviderEnv as Env }

export function createCustomgptPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'CustomGPT.ai',
    actions: customgptActions,
    // 上游的 credentialValidators 打 /api/v1/user,但那不是一个 action;
    // list_agents 是唯一只读且无必填入参的 action(其余都要 projectId),拿它当探针。
    credentialProbe: 'list_agents',
    handlers: {
      list_agents: listAgents,
      get_agent: getAgent,
      list_conversations: listConversations,
      create_conversation: createConversation,
      send_message: sendMessage,
      list_messages: listMessages,
      list_documents: listDocuments,
    },
  })
}

export default createCustomgptPlugin()
