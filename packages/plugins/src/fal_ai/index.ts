/**
 * fal.ai —— 从 open-connector 迁移的 provider(8 个 action:平台面 4 + 队列面 4)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * credentialProbe 选 `get_models`:上游 `credentialValidators` 打的正是 `/v1/models?limit=1`,
 * 而它 effect 为 read、无必填入参,三个条件都满足 —— 配错的 FAL_KEY 在挂载时就被拒,
 * 不用等第一次业务调用。
 */

import {
  cancelQueueRequest,
  estimatePricing,
  getJwks,
  getModels,
  getPricing,
  getQueueRequestResult,
  queueGetStatus,
  queueGetStatusStream,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { falAiActions } from './schema'

export type { ProviderEnv as Env }

export function createFalAiPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'fal.ai',
    actions: falAiActions,
    credentialProbe: 'get_models',
    handlers: {
      get_models: getModels,
      get_pricing: getPricing,
      estimate_pricing: estimatePricing,
      get_jwks: getJwks,
      queue_get_status: queueGetStatus,
      queue_get_status_stream: queueGetStatusStream,
      get_queue_request_result: getQueueRequestResult,
      cancel_queue_request: cancelQueueRequest,
    },
  })
}

export default createFalAiPlugin()
