/**
 * Open Exchange Rates —— 从 open-connector 迁移的 provider(api_key,5 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  convertCurrency,
  getCurrencies,
  getHistoricalRates,
  getLatestRates,
  getTimeseriesRates,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { openExchangeRatesActions } from './schema'

export type { ProviderEnv as Env }

export function createOpenExchangeRatesPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Open Exchange Rates',
    actions: openExchangeRatesActions,
    // 上游 credentialValidators 打的是 /latest.json;get_currencies 不带 app_id,
    // 校验不了凭证,所以探针选 get_latest_rates(只读、无必填入参)。
    credentialProbe: 'get_latest_rates',
    handlers: {
      get_currencies: getCurrencies,
      get_latest_rates: getLatestRates,
      get_historical_rates: getHistoricalRates,
      get_timeseries_rates: getTimeseriesRates,
      convert_currency: convertCurrency,
    },
  })
}

export default createOpenExchangeRatesPlugin()
