/**
 * LiveSession —— 从 open-connector 迁移的 provider(api_key,1 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { livesessionActions } from './schema'
import { listSessions } from './api'

export type { ProviderEnv as Env }

export function createLivesessionPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'LiveSession',
    actions: livesessionActions,
    // 上游 credentialValidators 就是打 /sessions?size=1 试凭证;这里只有这一个 action,
    // 且只读、无必填入参,拿它当探针。
    credentialProbe: 'list_sessions',
    handlers: {
      list_sessions: listSessions,
    },
  })
}

export default createLivesessionPlugin()
