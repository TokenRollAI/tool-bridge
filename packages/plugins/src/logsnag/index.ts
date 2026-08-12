/**
 * LogSnag —— 从 open-connector 迁移的 provider(4 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { identifyUser, mutateInsight, publishEvent, publishInsight } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { logsnagActions } from './schema'

export type { ProviderEnv as Env }

export function createLogsnagPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'LogSnag',
    actions: logsnagActions,
    handlers: {
      publish_event: publishEvent,
      identify_user: identifyUser,
      publish_insight: publishInsight,
      mutate_insight: mutateInsight,
    },
  })
}

export default createLogsnagPlugin()
