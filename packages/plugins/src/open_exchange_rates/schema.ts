/**
 * Open Exchange Rates 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getCurrenciesInput = z.strictObject({}).describe('Input parameters for retrieving supported Open Exchange Rates currencies.')

export const getCurrenciesOutput = z.record(z.string(), z.string().describe('Currency name.')).describe('Mapping of ISO currency codes to full currency names.')

export const getLatestRatesInput = z.strictObject({
  base: z.string().min(3).max(3).regex(new RegExp('^[A-Z]{3}$')).describe('Three-letter base currency code for the returned rates.').optional(),
  symbols: z.array(z.string().min(3).max(3).regex(new RegExp('^[A-Z]{3}$')).describe('Three-letter ISO currency code.')).min(1).describe('List of target currency codes to include in the response.').optional(),
  showAlternative: z.boolean().describe('Whether to include alternative, black-market, and digital currency rates.').optional(),
}).describe('Input parameters for fetching the latest Open Exchange Rates exchange rates.')

export const getLatestRatesOutput = z.looseObject({
  disclaimer: z.string().min(1).describe('Disclaimer text returned by Open Exchange Rates.'),
  license: z.string().min(1).describe('License URL returned by Open Exchange Rates.'),
  timestamp: z.int().describe('Unix timestamp when the rates snapshot was generated.'),
  base: z.string().min(1).describe('Base currency used for the returned rates.'),
  rates: z.record(z.string(), z.number().describe('Exchange rate value.')).describe('Mapping of currency codes to exchange rates for the selected base currency.'),
}).describe('Open Exchange Rates exchange rate snapshot.')

export const getHistoricalRatesInput = z.strictObject({
  date: z.iso.date().describe('Historical date to request from Open Exchange Rates in YYYY-MM-DD format.'),
  base: z.string().min(3).max(3).regex(new RegExp('^[A-Z]{3}$')).describe('Three-letter base currency code for the returned rates.').optional(),
  symbols: z.array(z.string().min(3).max(3).regex(new RegExp('^[A-Z]{3}$')).describe('Three-letter ISO currency code.')).min(1).describe('List of target currency codes to include in the response.').optional(),
  showAlternative: z.boolean().describe('Whether to include alternative, black-market, and digital currency rates.').optional(),
}).describe('Input parameters for fetching historical Open Exchange Rates exchange rates.')

export const getHistoricalRatesOutput = z.looseObject({
  disclaimer: z.string().min(1).describe('Disclaimer text returned by Open Exchange Rates.'),
  license: z.string().min(1).describe('License URL returned by Open Exchange Rates.'),
  timestamp: z.int().describe('Unix timestamp when the rates snapshot was generated.'),
  historical: z.boolean().describe('Whether the returned rates represent a historical snapshot.'),
  base: z.string().min(1).describe('Base currency used for the returned rates.'),
  rates: z.record(z.string(), z.number().describe('Exchange rate value.')).describe('Mapping of currency codes to exchange rates for the selected base currency.'),
}).describe('Open Exchange Rates historical exchange rate snapshot.')

export const getTimeseriesRatesInput = z.strictObject({
  startDate: z.iso.date().describe('Start date of the time-series range in YYYY-MM-DD format.'),
  endDate: z.iso.date().describe('End date of the time-series range in YYYY-MM-DD format.'),
  base: z.string().min(3).max(3).regex(new RegExp('^[A-Z]{3}$')).describe('Three-letter base currency code for the returned rates.').optional(),
  symbols: z.array(z.string().min(3).max(3).regex(new RegExp('^[A-Z]{3}$')).describe('Three-letter ISO currency code.')).min(1).describe('List of target currency codes to include in the response.').optional(),
  showAlternative: z.boolean().describe('Whether to include alternative, black-market, and digital currency rates.').optional(),
}).describe('Input parameters for fetching Open Exchange Rates time-series exchange rates.')

export const getTimeseriesRatesOutput = z.looseObject({
  disclaimer: z.string().min(1).describe('Disclaimer text returned by Open Exchange Rates.'),
  license: z.string().min(1).describe('License URL returned by Open Exchange Rates.'),
  start_date: z.string().min(1).describe('Start date of the returned time-series range.'),
  end_date: z.string().min(1).describe('End date of the returned time-series range.'),
  base: z.string().min(1).describe('Base currency used for the returned rates.'),
  rates: z.record(z.string(), z.record(z.string(), z.number().describe('Exchange rate value.')).describe('Mapping of currency codes to exchange rates for one date.')).describe('Mapping of YYYY-MM-DD dates to per-currency exchange rates.'),
}).describe('Open Exchange Rates time-series exchange rates.')

export const convertCurrencyInput = z.strictObject({
  amount: z.number().gt(0).describe('Amount to convert.'),
  from: z.string().min(3).max(3).regex(new RegExp('^[A-Z]{3}$')).describe('Source currency code for the conversion.'),
  to: z.string().min(3).max(3).regex(new RegExp('^[A-Z]{3}$')).describe('Target currency code for the conversion.'),
}).describe('Input parameters for converting an amount between currencies with Open Exchange Rates.')

export const convertCurrencyOutput = z.looseObject({
  disclaimer: z.string().min(1).describe('Disclaimer text returned by Open Exchange Rates.'),
  license: z.string().min(1).describe('License URL returned by Open Exchange Rates.'),
  request: z.looseObject({
    query: z.string().min(1).describe('Original conversion query.'),
    amount: z.number().describe('Amount used for the conversion.'),
    from: z.string().min(1).describe('Source currency code used for the conversion.'),
    to: z.string().min(1).describe('Target currency code used for the conversion.'),
  }).describe('Conversion request echoed by Open Exchange Rates.'),
  meta: z.looseObject({
    timestamp: z.int().describe('Unix timestamp used for the conversion rate.'),
    rate: z.number().describe('Exchange rate used for the conversion.'),
  }).describe('Conversion metadata returned by Open Exchange Rates.'),
  response: z.number().describe('Converted amount returned by Open Exchange Rates.'),
}).describe('Currency conversion result returned by Open Exchange Rates.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const openExchangeRatesActions = {
  get_currencies: {
    description: 'Retrieve all currencies supported by Open Exchange Rates.',
    effect: 'read',
    inputSchema: getCurrenciesInput,
    outputSchema: z.toJSONSchema(getCurrenciesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_latest_rates: {
    description: 'Retrieve the latest Open Exchange Rates exchange rates.',
    effect: 'read',
    inputSchema: getLatestRatesInput,
    outputSchema: z.toJSONSchema(getLatestRatesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_historical_rates: {
    description: 'Retrieve historical Open Exchange Rates exchange rates for a specific date.',
    effect: 'read',
    inputSchema: getHistoricalRatesInput,
    outputSchema: z.toJSONSchema(getHistoricalRatesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_timeseries_rates: {
    description: 'Retrieve Open Exchange Rates exchange rates across a date range.',
    effect: 'read',
    inputSchema: getTimeseriesRatesInput,
    outputSchema: z.toJSONSchema(getTimeseriesRatesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  convert_currency: {
    description: 'Convert an amount between two currencies using Open Exchange Rates.',
    effect: 'write',
    inputSchema: convertCurrencyInput,
    outputSchema: z.toJSONSchema(convertCurrencyOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
