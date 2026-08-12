/**
 * Tavily —— 从 open-connector 迁移的 provider(7 个 action:搜索/抽取/建站图/爬取/研究任务/用量)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * `credentialProbe: 'get_usage'` —— 上游 `credentialValidators.apiKey` 打的正是 `/usage`,
 * 而它 `effect: 'read'`、零必填入参,三个条件都满足:配错的 key 在挂载时就被拒。
 */

import { crawl, createResearch, extract, getResearch, getUsage, map, search } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { tavilyActions } from './schema'

export type { ProviderEnv as Env }

export function createTavilyPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Tavily',
    actions: tavilyActions,
    credentialProbe: 'get_usage',
    handlers: {
      search,
      extract,
      map,
      crawl,
      create_research: createResearch,
      get_research: getResearch,
      get_usage: getUsage,
    },
  })
}

export default createTavilyPlugin()
