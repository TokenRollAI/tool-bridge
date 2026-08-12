/**
 * currencyapi —— 从 open-connector 迁移的 provider(api_key,5 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  convertCurrency,
  getApiStatus,
  getHistoricalRates,
  getLatestRates,
  getSupportedCurrencies,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { currencyapiActions } from './schema'

export type { ProviderEnv as Env }

export function createCurrencyapiPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'currencyapi',
    actions: currencyapiActions,
    // 上游的 credentialValidators 打的就是 /v3/status;它只读、无入参,且不消耗汇率配额。
    credentialProbe: 'get_api_status',
    handlers: {
      get_api_status: getApiStatus,
      get_supported_currencies: getSupportedCurrencies,
      get_latest_rates: getLatestRates,
      get_historical_rates: getHistoricalRates,
      convert_currency: convertCurrency,
    },
  })
}

export default createCurrencyapiPlugin()
