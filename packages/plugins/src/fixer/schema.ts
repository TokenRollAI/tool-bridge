/**
 * Fixer 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getSupportedSymbolsInput = z.strictObject({}).describe('Input parameters for retrieving all supported Fixer currency symbols.')

export const getSupportedSymbolsOutput = z.looseObject({
  success: z.boolean().describe('Whether the Fixer request completed successfully.'),
  symbols: z.record(z.string(), z.string().describe('Currency name.')).describe('Mapping of ISO currency codes to full currency names.'),
}).describe('Supported Fixer currency symbols.')

export const getLatestRatesInput = z.strictObject({
  base: z.string().min(3).max(3).regex(new RegExp('^[A-Z]{3}$')).describe('Three-letter base currency code for the returned rates.').optional(),
  symbols: z.array(z.string().min(3).max(3).regex(new RegExp('^[A-Z]{3}$')).describe('A three-letter ISO currency code used to limit the response.')).min(1).describe('List of target currency codes to include in the Fixer response.').optional(),
}).describe('Input parameters for fetching the latest Fixer exchange rates.')

export const getLatestRatesOutput = z.looseObject({
  success: z.boolean().describe('Whether the Fixer request completed successfully.'),
  timestamp: z.int().describe('Unix timestamp when the rates snapshot was generated.'),
  base: z.string().min(1).describe('Base currency used for the returned rates.'),
  date: z.string().min(1).describe('Date of the returned exchange rates in YYYY-MM-DD format.'),
  rates: z.record(z.string(), z.number().describe('Exchange rate value.')).describe('Mapping of currency codes to exchange rates for the selected base currency.'),
}).describe('Fixer latest rates response.')

export const getHistoricalRatesInput = z.strictObject({
  date: z.iso.date().describe('Historical date to request from Fixer in YYYY-MM-DD format.'),
  base: z.string().min(3).max(3).regex(new RegExp('^[A-Z]{3}$')).describe('Three-letter base currency code for the returned rates.').optional(),
  symbols: z.array(z.string().min(3).max(3).regex(new RegExp('^[A-Z]{3}$')).describe('A three-letter ISO currency code used to limit the response.')).min(1).describe('List of target currency codes to include in the Fixer response.').optional(),
}).describe('Input parameters for fetching historical Fixer exchange rates.')

export const getHistoricalRatesOutput = z.looseObject({
  success: z.boolean().describe('Whether the Fixer request completed successfully.'),
  historical: z.boolean().describe('Whether the returned rates represent a historical snapshot.'),
  timestamp: z.int().describe('Unix timestamp when the rates snapshot was generated.'),
  base: z.string().min(1).describe('Base currency used for the returned rates.'),
  date: z.string().min(1).describe('Date of the returned exchange rates in YYYY-MM-DD format.'),
  rates: z.record(z.string(), z.number().describe('Exchange rate value.')).describe('Mapping of currency codes to exchange rates for the selected base currency.'),
}).describe('Fixer historical rates response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const fixerActions = {
  get_supported_symbols: {
    description: 'Retrieve all supported Fixer currency symbols and their full names.',
    effect: 'read',
    inputSchema: getSupportedSymbolsInput,
    outputSchema: z.toJSONSchema(getSupportedSymbolsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_latest_rates: {
    description: 'Retrieve the latest Fixer exchange rates for all or selected currencies.',
    effect: 'read',
    inputSchema: getLatestRatesInput,
    outputSchema: z.toJSONSchema(getLatestRatesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_historical_rates: {
    description: 'Retrieve historical Fixer exchange rates for a specific date.',
    effect: 'read',
    inputSchema: getHistoricalRatesInput,
    outputSchema: z.toJSONSchema(getHistoricalRatesOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
