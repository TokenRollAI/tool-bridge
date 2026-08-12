/**
 * Replicate —— 从 open-connector 迁移的 provider(11 个 action:账户、模型/版本、集合、预测)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * credentialProbe 选 `get_account`:上游 `credentialValidators` 打的正是 `/v1/account`,
 * 而它 effect 为 read、零入参,三个条件都满足 —— 配错的 `r8_` token 在挂载时就被拒。
 */

import {
  cancelPrediction,
  createPrediction,
  getAccount,
  getCollection,
  getModel,
  getModelVersion,
  getPrediction,
  listCollections,
  listModels,
  listModelVersions,
  listPredictions,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { replicateActions } from './schema'

export type { ProviderEnv as Env }

export function createReplicatePlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Replicate',
    actions: replicateActions,
    credentialProbe: 'get_account',
    handlers: {
      get_account: getAccount,
      list_models: listModels,
      get_model: getModel,
      list_model_versions: listModelVersions,
      get_model_version: getModelVersion,
      list_collections: listCollections,
      get_collection: getCollection,
      create_prediction: createPrediction,
      get_prediction: getPrediction,
      list_predictions: listPredictions,
      cancel_prediction: cancelPrediction,
    },
  })
}

export default createReplicatePlugin()
