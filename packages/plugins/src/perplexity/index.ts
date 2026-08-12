/**
 * Perplexity —— 从 open-connector 迁移的 provider(api_key,4 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { createChatCompletion, createEmbeddings, listModels, search } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { perplexityActions } from './schema'

export type { ProviderEnv as Env }

export function createPerplexityPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Perplexity',
    actions: perplexityActions,
    // 上游 credentialValidators 也打 /v1/models —— 只读、无必填入参,正好当挂载时的凭证探针。
    credentialProbe: 'list_models',
    handlers: {
      list_models: listModels,
      search,
      create_chat_completion: createChatCompletion,
      create_embeddings: createEmbeddings,
    },
  })
}

export default createPerplexityPlugin()
