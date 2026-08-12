/**
 * currencyapi 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getApiStatusInput = z.strictObject({}).describe('Input parameters for retrieving current currencyapi quota usage.')

export const getApiStatusOutput = z.strictObject({
  account_id: z.int().describe('currencyapi account identifier.'),
  quotas: z.strictObject({
    month: z.strictObject({
      total: z.int().describe('Total quota available in the current bucket.'),
      used: z.int().describe('Quota already consumed in the current bucket.'),
      remaining: z.int().describe('Quota still available in the current bucket.'),
    }).describe('Usage quota bucket.'),
    grace: z.strictObject({
      total: z.int().describe('Total quota available in the current bucket.'),
      used: z.int().describe('Quota already consumed in the current bucket.'),
      remaining: z.int().describe('Quota still available in the current bucket.'),
    }).describe('Usage quota bucket.'),
  }).describe('Quota usage information returned by currencyapi.'),
}).describe('currencyapi account quota status.')

export const getSupportedCurrenciesInput = z.strictObject({
  currencies: z.array(z.string().regex(new RegExp('^[A-Z0-9]{3,10}$')).describe('Currency code using uppercase ASCII letters or digits.')).min(1).describe('List of currency codes to include in the response.').optional(),
  type: z.enum(['fiat', 'metal', 'crypto']).describe('Currency type filter. Supported values are fiat, metal, or crypto.').optional(),
}).describe('Input parameters for retrieving supported currencies from currencyapi.')

export const getSupportedCurrenciesOutput = z.strictObject({
  data: z.record(z.string(), z.strictObject({
    symbol: z.string().min(1).describe('Currency symbol returned by currencyapi.'),
    name: z.string().min(1).describe('Currency display name.'),
    symbol_native: z.string().min(1).describe('Native currency symbol.'),
    decimal_digits: z.int().describe('Number of decimal digits used by the currency.'),
    rounding: z.number().describe('Currency rounding precision value.'),
    code: z.string().regex(new RegExp('^[A-Z0-9]{3,10}$')).describe('Currency code using uppercase ASCII letters or digits.'),
    name_plural: z.string().min(1).describe('Plural display name for the currency.'),
    type: z.enum(['fiat', 'metal', 'crypto']).describe('Currency type filter. Supported values are fiat, metal, or crypto.'),
    countries: z.array(z.string().min(1).describe('ISO country code that uses the currency.')).describe('List of ISO country codes associated with the currency.'),
  }).describe('Currency metadata returned by currencyapi.')).describe('Mapping of currency codes to currency metadata.'),
}).describe('Supported currencies returned by currencyapi.')

export const getLatestRatesInput = z.strictObject({
  base_currency: z.string().regex(new RegExp('^[A-Z0-9]{3,10}$')).describe('Currency code using uppercase ASCII letters or digits.').optional(),
  currencies: z.array(z.string().regex(new RegExp('^[A-Z0-9]{3,10}$')).describe('Currency code using uppercase ASCII letters or digits.')).min(1).describe('List of currency codes to include in the response.').optional(),
  type: z.enum(['fiat', 'metal', 'crypto']).describe('Currency type filter. Supported values are fiat, metal, or crypto.').optional(),
}).describe('Input parameters for retrieving latest exchange rates from currencyapi.')

export const getLatestRatesOutput = z.strictObject({
  meta: z.strictObject({
    last_updated_at: z.string().min(1).describe('Timestamp indicating when the dataset was last updated.'),
  }).describe('Response metadata returned by currencyapi.'),
  data: z.record(z.string(), z.strictObject({
    code: z.string().regex(new RegExp('^[A-Z0-9]{3,10}$')).describe('Currency code using uppercase ASCII letters or digits.'),
    value: z.number().describe('Exchange rate or converted value returned by currencyapi.'),
  }).describe('Exchange rate entry returned by currencyapi.')).describe('Mapping of currency codes to exchange rate entries.'),
}).describe('Exchange rate payload returned by currencyapi.')

export const getHistoricalRatesInput = z.strictObject({
  date: z.string().regex(new RegExp('^\\d{4}-\\d{2}-\\d{2}$')).describe('Date in YYYY-MM-DD format.'),
  base_currency: z.string().regex(new RegExp('^[A-Z0-9]{3,10}$')).describe('Currency code using uppercase ASCII letters or digits.').optional(),
  currencies: z.array(z.string().regex(new RegExp('^[A-Z0-9]{3,10}$')).describe('Currency code using uppercase ASCII letters or digits.')).min(1).describe('List of currency codes to include in the response.').optional(),
  type: z.enum(['fiat', 'metal', 'crypto']).describe('Currency type filter. Supported values are fiat, metal, or crypto.').optional(),
}).describe('Input parameters for retrieving historical exchange rates from currencyapi.')

export const getHistoricalRatesOutput = z.strictObject({
  meta: z.strictObject({
    last_updated_at: z.string().min(1).describe('Timestamp indicating when the dataset was last updated.'),
  }).describe('Response metadata returned by currencyapi.'),
  data: z.record(z.string(), z.strictObject({
    code: z.string().regex(new RegExp('^[A-Z0-9]{3,10}$')).describe('Currency code using uppercase ASCII letters or digits.'),
    value: z.number().describe('Exchange rate or converted value returned by currencyapi.'),
  }).describe('Exchange rate entry returned by currencyapi.')).describe('Mapping of currency codes to exchange rate entries.'),
}).describe('Exchange rate payload returned by currencyapi.')

export const convertCurrencyInput = z.strictObject({
  value: z.number().gt(0).describe('Numeric amount to convert from the base currency.'),
  date: z.string().regex(new RegExp('^\\d{4}-\\d{2}-\\d{2}$')).describe('Date in YYYY-MM-DD format.').optional(),
  base_currency: z.string().regex(new RegExp('^[A-Z0-9]{3,10}$')).describe('Currency code using uppercase ASCII letters or digits.').optional(),
  currencies: z.array(z.string().regex(new RegExp('^[A-Z0-9]{3,10}$')).describe('Currency code using uppercase ASCII letters or digits.')).min(1).describe('List of currency codes to include in the response.').optional(),
  type: z.enum(['fiat', 'metal', 'crypto']).describe('Currency type filter. Supported values are fiat, metal, or crypto.').optional(),
}).describe('Input parameters for converting a monetary amount with currencyapi.')

export const convertCurrencyOutput = z.strictObject({
  meta: z.strictObject({
    last_updated_at: z.string().min(1).describe('Timestamp indicating when the dataset was last updated.'),
  }).describe('Response metadata returned by currencyapi.'),
  data: z.record(z.string(), z.strictObject({
    code: z.string().regex(new RegExp('^[A-Z0-9]{3,10}$')).describe('Currency code using uppercase ASCII letters or digits.'),
    value: z.number().describe('Exchange rate or converted value returned by currencyapi.'),
  }).describe('Exchange rate entry returned by currencyapi.')).describe('Mapping of currency codes to exchange rate entries.'),
}).describe('Exchange rate payload returned by currencyapi.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const currencyapiActions = {
  get_api_status: {
    description: 'Retrieve current currencyapi account quota usage.',
    effect: 'read',
    inputSchema: getApiStatusInput,
    outputSchema: z.toJSONSchema(getApiStatusOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_supported_currencies: {
    description: 'Retrieve supported currency metadata from currencyapi.',
    effect: 'read',
    inputSchema: getSupportedCurrenciesInput,
    outputSchema: z.toJSONSchema(getSupportedCurrenciesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_latest_rates: {
    description: 'Retrieve the latest exchange rates from currencyapi.',
    effect: 'read',
    inputSchema: getLatestRatesInput,
    outputSchema: z.toJSONSchema(getLatestRatesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_historical_rates: {
    description: 'Retrieve historical exchange rates for a specific date from currencyapi.',
    effect: 'read',
    inputSchema: getHistoricalRatesInput,
    outputSchema: z.toJSONSchema(getHistoricalRatesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  convert_currency: {
    description: 'Convert a monetary amount into one or more currencies with currencyapi.',
    effect: 'write',
    inputSchema: convertCurrencyInput,
    outputSchema: z.toJSONSchema(convertCurrencyOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
