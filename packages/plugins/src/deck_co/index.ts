/**
 * Deck.co —— 从 open-connector 迁移的 provider(api_key,6 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { createSource, getAgent, getSource, listAgents, listSources, testApiKey } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { deckCoActions } from './schema'

export type { ProviderEnv as Env }

export function createDeckCoPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Deck.co',
    actions: deckCoActions,
    // 上游 credentialValidators 打的是 /test,但对应的 test_api_key 被播种成 effect:write,
    // 不满足探针必须只读的约束;list_agents 同样只读、无必填入参,拿它当探针。
    credentialProbe: 'list_agents',
    handlers: {
      test_api_key: testApiKey,
      list_agents: listAgents,
      get_agent: getAgent,
      list_sources: listSources,
      get_source: getSource,
      create_source: createSource,
    },
  })
}

export default createDeckCoPlugin()
