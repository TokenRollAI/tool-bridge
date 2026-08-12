/**
 * DeepSeek —— 从 open-connector 迁移的 provider(4 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * credentialProbe 选 `list_models`:上游 credentialValidators 打的正是 `/models`,
 * 且它 effect 为 read、无必填入参 —— 三个条件都满足。
 */

import { createAnthropicMessage, createChatCompletion, getUserBalance, listModels } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { deepseekActions } from './schema'

export type { ProviderEnv as Env }

export function createDeepseekPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'DeepSeek',
    credentialProbe: 'list_models',
    actions: deepseekActions,
    handlers: {
      list_models: listModels,
      get_user_balance: getUserBalance,
      create_chat_completion: createChatCompletion,
      create_anthropic_message: createAnthropicMessage,
    },
  })
}

export default createDeepseekPlugin()
