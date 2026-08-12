/**
 * Fixer —— 从 open-connector 迁移的 provider(api_key,3 个 action,全部只读)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 注意:Fixer 的凭证走 URL query(`?access_key=`),部署侧的日志策略需知情。
 */

import { getHistoricalRates, getLatestRates, getSupportedSymbols } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { fixerActions } from './schema'

export type { ProviderEnv as Env }

export function createFixerPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Fixer',
    actions: fixerActions,
    // 上游 credentialValidators 打的就是 /symbols —— 只读、无必填入参。
    credentialProbe: 'get_supported_symbols',
    handlers: {
      get_supported_symbols: getSupportedSymbols,
      get_latest_rates: getLatestRates,
      get_historical_rates: getHistoricalRates,
    },
  })
}

export default createFixerPlugin()
