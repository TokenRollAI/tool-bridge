/**
 * Apify —— 从 open-connector 迁移的 provider(api_key,5 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { getActor, getCurrentUser, getDatasetItems, getRun, runActor } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { apifyActions } from './schema'

export type { ProviderEnv as Env }

export function createApifyPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Apify',
    actions: apifyActions,
    // 与上游 credentialValidators 打的是同一个端点(/v2/users/me):只读、无必填入参。
    credentialProbe: 'get_current_user',
    handlers: {
      get_current_user: getCurrentUser,
      get_actor: getActor,
      run_actor: runActor,
      get_run: getRun,
      get_dataset_items: getDatasetItems,
    },
  })
}

export default createApifyPlugin()
