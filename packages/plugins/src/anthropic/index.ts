/**
 * Anthropic —— 从 open-connector 迁移的 provider(api_key,4 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { countMessageTokens, createMessage, getModel, listModels } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { anthropicActions } from './schema'

export type { ProviderEnv as Env }

export function createAnthropicPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Anthropic',
    actions: anthropicActions,
    // 上游 credentialValidators 也打 /v1/models —— 只读、无必填入参,正好当挂载时的凭证探针。
    credentialProbe: 'list_models',
    handlers: {
      list_models: listModels,
      get_model: getModel,
      create_message: createMessage,
      count_message_tokens: countMessageTokens,
    },
  })
}

export default createAnthropicPlugin()
