/**
 * EODHD APIs —— 从 open-connector 迁移的 provider(api_key 走 query,8 个只读 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  getEod,
  getIdMapping,
  getMacroIndicators,
  getRealTimeQuote,
  getUserInfo,
  getUstYieldRates,
  listExchanges,
  searchInstruments,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { eodhdApisActions } from './schema'

export type { ProviderEnv as Env }

export function createEodhdApisPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'EODHD APIs',
    actions: eodhdApisActions,
    // 与上游 credentialValidators 打的是同一个端点(/user):只读、无必填入参,
    // 且不消耗行情额度。
    credentialProbe: 'get_user_info',
    handlers: {
      search_instruments: searchInstruments,
      list_exchanges: listExchanges,
      get_real_time_quote: getRealTimeQuote,
      get_eod: getEod,
      get_id_mapping: getIdMapping,
      get_macro_indicators: getMacroIndicators,
      get_ust_yield_rates: getUstYieldRates,
      get_user_info: getUserInfo,
    },
  })
}

export default createEodhdApisPlugin()
