/**
 * OpenRouter —— 从 open-connector 迁移的 provider(13 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明(`create_coinbase_charge` 的入参手写在
 * `schema.handwritten.ts`,已在 `handwritten.json` 登记),`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * credentialProbe 选 `get_current_key`:上游 credentialValidators 打的正是 `/key`,
 * 且它 effect 为 read、无必填入参(两个入参都是归因用的请求头)—— 三个条件都满足。
 */

import {
  createChatCompletion,
  createCoinbaseCharge,
  createMessage,
  getCredits,
  getCurrentKey,
  getGeneration,
  getModelsCount,
  listAvailableModels,
  listEmbeddingModels,
  listModelEndpoints,
  listProviders,
  listUserModels,
  listZdrEndpoints,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { openrouterActions } from './schema'

export type { ProviderEnv as Env }

export function createOpenrouterPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'OpenRouter',
    actions: openrouterActions,
    credentialProbe: 'get_current_key',
    handlers: {
      create_chat_completion: createChatCompletion,
      create_coinbase_charge: createCoinbaseCharge,
      create_message: createMessage,
      get_credits: getCredits,
      get_current_key: getCurrentKey,
      get_generation: getGeneration,
      get_models_count: getModelsCount,
      list_available_models: listAvailableModels,
      list_embedding_models: listEmbeddingModels,
      list_model_endpoints: listModelEndpoints,
      list_providers: listProviders,
      list_user_models: listUserModels,
      list_zdr_endpoints: listZdrEndpoints,
    },
  })
}

export default createOpenrouterPlugin()
