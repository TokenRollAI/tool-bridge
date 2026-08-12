/**
 * Scrapfly —— 从 open-connector 迁移的 provider(api_key,2 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { getMonitoringMetrics, scrape } from './api'
import { scrapflyActions } from './schema'

export type { ProviderEnv as Env }

export function createScrapflyPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Scrapfly',
    actions: scrapflyActions,
    // 不设 credentialProbe:唯一的 read action(get_monitoring_metrics)对**非企业版**
    // 账号返回 402,而上游的 credentialValidators 明确把 402 视作"凭证有效、只是没这个
    // 套餐"。挂载期探针拿不到这个区分,会把合法的非企业版 key 当场拒掉。
    handlers: {
      scrape,
      get_monitoring_metrics: getMonitoringMetrics,
    },
  })
}

export default createScrapflyPlugin()
