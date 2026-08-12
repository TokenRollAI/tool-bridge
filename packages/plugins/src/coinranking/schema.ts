/**
 * Coinranking 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const searchSuggestionsInput = z.strictObject({
  query: z.string().min(1).describe('Search query used for Coinranking suggestions.'),
}).describe('Input parameters for searching Coinranking suggestions.')

export const searchSuggestionsOutput = z.strictObject({
  results: z.strictObject({
    coins: z.array(z.looseObject({
      uuid: z.string().min(1).describe('Unique identifier returned by Coinranking.').optional(),
      name: z.string().min(1).describe('Display name returned by Coinranking.').optional(),
      symbol: z.string().min(1).describe('Ticker or short symbol returned by Coinranking.').optional(),
      price: z.string().min(1).describe('String price returned by Coinranking when present.').optional(),
      iconUrl: z.string().min(1).describe('Icon URL returned by Coinranking when present.').optional(),
    }).describe('One suggestion item returned by Coinranking.')).describe('Coin suggestions matched by the query.').optional(),
    exchanges: z.array(z.looseObject({}).describe('One exchange suggestion.')).describe('Exchange suggestions matched by the query.').optional(),
    markets: z.array(z.looseObject({}).describe('One market suggestion.')).describe('Market suggestions matched by the query.').optional(),
    fiat: z.array(z.looseObject({}).describe('One fiat suggestion.')).describe('Fiat currency suggestions matched by the query.').optional(),
  }).describe('Grouped search suggestion payload returned by Coinranking.').optional(),
}).describe('Search suggestion results returned by Coinranking.')

export const listCoinsInput = z.strictObject({
  limit: z.int().min(1).max(100).describe('Maximum number of coins to return.').optional(),
  offset: z.int().min(0).describe('Number of leading results to skip.').optional(),
  search: z.string().min(1).describe('Search string used to filter the returned coins.').optional(),
  orderBy: z.enum(['marketCap', 'price', 'change', '24hVolume', 'listedAt']).describe('Field used to sort the returned coins.').optional(),
  orderDirection: z.enum(['asc', 'desc']).describe('Sort direction applied to the ordered result set.').optional(),
  referenceCurrencyUuid: z.string().min(1).describe('Reference currency UUID used to price the returned coins.').optional(),
  timePeriod: z.enum(['1h', '3h', '12h', '24h', '7d', '30d', '3m', '1y', '3y', '5y']).describe('Time period used for change and historical market data.').optional(),
}).describe('Input parameters for listing coins from Coinranking.')

export const listCoinsOutput = z.strictObject({
  stats: z.looseObject({
    total: z.int().describe('Total number of matching coins when present.').optional(),
  }).describe('List statistics returned by Coinranking.').optional(),
  coins: z.array(z.looseObject({
    uuid: z.string().min(1).describe('Unique identifier of the coin.').optional(),
    symbol: z.string().min(1).describe('Ticker symbol of the coin.').optional(),
    name: z.string().min(1).describe('Name of the coin.').optional(),
    price: z.string().min(1).describe('Current price returned by Coinranking.').optional(),
    marketCap: z.string().min(1).describe('Market capitalization returned by Coinranking.').optional(),
  }).describe('One coin summary returned by Coinranking.')).describe('Ordered list of coins returned by Coinranking.').optional(),
}).describe('Coin list payload returned by Coinranking.')

export const getCoinDetailsInput = z.strictObject({
  uuid: z.string().min(1).describe('Coin UUID returned by Coinranking.'),
  referenceCurrencyUuid: z.string().min(1).describe('Reference currency UUID used to price the returned coin.').optional(),
  timePeriod: z.enum(['1h', '3h', '12h', '24h', '7d', '30d', '3m', '1y', '3y', '5y']).describe('Time period used for change and historical market data.').optional(),
}).describe('Input parameters for retrieving coin details from Coinranking.')

export const getCoinDetailsOutput = z.strictObject({
  coin: z.looseObject({}).describe('Detailed coin payload returned by Coinranking.').optional(),
}).describe('Detailed coin response returned by Coinranking.')

export const getCoinPriceHistoryInput = z.strictObject({
  uuid: z.string().min(1).describe('Coin UUID returned by Coinranking.'),
  referenceCurrencyUuid: z.string().min(1).describe('Reference currency UUID used to price the historical points.').optional(),
  timePeriod: z.enum(['1h', '3h', '12h', '24h', '7d', '30d', '3m', '1y', '3y', '5y']).describe('Time period used for change and historical market data.').optional(),
}).describe('Input parameters for retrieving historical prices from Coinranking.')

export const getCoinPriceHistoryOutput = z.strictObject({
  change: z.string().min(1).describe('Price change percentage over the requested time period.').optional(),
  history: z.array(z.strictObject({
    price: z.string().min(1).describe('Historical price returned by Coinranking.').optional(),
    timestamp: z.int().describe('Unix timestamp for the historical price point.'),
  }).describe('One historical price point returned by Coinranking.')).describe('Historical price points for the coin.').optional(),
}).describe('Price history response returned by Coinranking.')

export const getReferenceCurrenciesInput = z.strictObject({}).describe('Input parameters for listing Coinranking reference currencies.')

export const getReferenceCurrenciesOutput = z.strictObject({
  currencies: z.array(z.looseObject({
    uuid: z.string().min(1).describe('Unique identifier of the reference currency.').optional(),
    type: z.string().min(1).describe('Reference currency type returned by Coinranking.').optional(),
    symbol: z.string().min(1).describe('Reference currency symbol.').optional(),
    name: z.string().min(1).describe('Reference currency display name.').optional(),
  }).describe('One reference currency returned by Coinranking.')).describe('Reference currencies returned by Coinranking.').optional(),
}).describe('Reference currency list returned by Coinranking.')

export const getGlobalStatsInput = z.strictObject({}).describe('Input parameters for retrieving Coinranking global stats.')

export const getGlobalStatsOutput = z.strictObject({
  stats: z.looseObject({}).describe('Global market statistics returned by Coinranking.').optional(),
}).describe('Global market statistics returned by Coinranking.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const coinrankingActions = {
  search_suggestions: {
    description: 'Search Coinranking suggestions by keyword and return grouped entity matches.',
    effect: 'read',
    inputSchema: searchSuggestionsInput,
    outputSchema: z.toJSONSchema(searchSuggestionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_coins: {
    description: 'List coins from Coinranking with optional filtering, sorting, and pagination.',
    effect: 'read',
    inputSchema: listCoinsInput,
    outputSchema: z.toJSONSchema(listCoinsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_coin_details: {
    description: 'Get detailed information for a single coin from Coinranking.',
    effect: 'read',
    inputSchema: getCoinDetailsInput,
    outputSchema: z.toJSONSchema(getCoinDetailsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_coin_price_history: {
    description: 'Get historical price points for a single coin from Coinranking.',
    effect: 'read',
    inputSchema: getCoinPriceHistoryInput,
    outputSchema: z.toJSONSchema(getCoinPriceHistoryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_reference_currencies: {
    description: 'List reference currencies supported by Coinranking.',
    effect: 'read',
    inputSchema: getReferenceCurrenciesInput,
    outputSchema: z.toJSONSchema(getReferenceCurrenciesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_global_stats: {
    description: 'Get global cryptocurrency market statistics from Coinranking.',
    effect: 'read',
    inputSchema: getGlobalStatsInput,
    outputSchema: z.toJSONSchema(getGlobalStatsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
