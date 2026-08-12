/**
 * Meituan —— 从 open-connector 迁移的 provider(api_key,1 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { meituanActions } from './schema'
import { queryTravel } from './api'

export type { ProviderEnv as Env }

export function createMeituanPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Meituan',
    actions: meituanActions,
    handlers: {
      query_travel: queryTravel,
    },
  })
}

export default createMeituanPlugin()
