/**
 * ScrapingBee —— 从 open-connector 迁移的 provider(api_key,3 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { extractData, fetchHtml, getUsageStats } from './api'
import { scrapingbeeActions } from './schema'

export type { ProviderEnv as Env }

export function createScrapingbeePlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'ScrapingBee',
    actions: scrapingbeeActions,
    // 上游的 credentialValidators 打的就是 /usage,它只读、无必填入参且不消耗信用点。
    credentialProbe: 'get_usage_stats',
    handlers: {
      fetch_html: fetchHtml,
      extract_data: extractData,
      get_usage_stats: getUsageStats,
    },
  })
}

export default createScrapingbeePlugin()
