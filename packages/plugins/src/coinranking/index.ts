/**
 * Coinranking —— 从 open-connector 迁移的 provider(6 个只读 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  getCoinDetails,
  getCoinPriceHistory,
  getGlobalStats,
  getReferenceCurrencies,
  listCoins,
  searchSuggestions,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { coinrankingActions } from './schema'

export type { ProviderEnv as Env }

export function createCoinrankingPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Coinranking',
    actions: coinrankingActions,
    handlers: {
      search_suggestions: searchSuggestions,
      list_coins: listCoins,
      get_coin_details: getCoinDetails,
      get_coin_price_history: getCoinPriceHistory,
      get_reference_currencies: getReferenceCurrencies,
      get_global_stats: getGlobalStats,
    },
  })
}

export default createCoinrankingPlugin()
