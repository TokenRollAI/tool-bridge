/**
 * EODHD APIs 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const searchInstrumentsInput = z.strictObject({
  query: z.string().min(1).describe('Search query such as a ticker, company name, or ISIN.'),
  type: z.enum(['all', 'stock', 'etf', 'fund', 'bond', 'index', 'crypto']).describe('Security type used to filter EODHD instrument search results.').optional(),
  exchange: z.string().min(1).describe('Exchange code used to filter search results.').optional(),
  bondsOnly: z.boolean().describe('Whether to return only bond results.').optional(),
  limit: z.int().min(1).describe('Maximum number of search results to return.').optional(),
}).describe('Input parameters for searching EODHD instruments.')

export const searchInstrumentsOutput = z.strictObject({
  results: z.array(z.looseObject({
    Code: z.string().describe('Ticker code returned by EODHD.').nullable().optional(),
    Exchange: z.string().describe('Exchange code returned by EODHD.').nullable().optional(),
    Name: z.string().describe('Instrument or company name returned by EODHD.').nullable().optional(),
    Type: z.string().describe('Instrument type returned by EODHD.').nullable().optional(),
    Country: z.string().describe('Country returned by EODHD.').nullable().optional(),
    Currency: z.string().describe('Currency returned by EODHD.').nullable().optional(),
    ISIN: z.string().describe('ISIN identifier returned by EODHD.').nullable().optional(),
    previousClose: z.number().describe('Previous close value returned by EODHD.').nullable().optional(),
    previousCloseDate: z.string().describe('Previous close date returned by EODHD.').nullable().optional(),
  }).describe('An instrument search result returned by EODHD.')).describe('Instrument search results returned by EODHD.').optional(),
}).describe('Search results returned by EODHD.')

export const listExchangesInput = z.strictObject({}).describe('Input parameters for listing EODHD exchanges.')

export const listExchangesOutput = z.strictObject({
  exchanges: z.array(z.looseObject({
    Name: z.string().describe('Exchange display name.').nullable().optional(),
    Code: z.string().describe('Exchange code.').nullable().optional(),
    OperatingMIC: z.string().describe('Operating market identifier code.').nullable().optional(),
    Country: z.string().describe('Exchange country.').nullable().optional(),
    Currency: z.string().describe('Exchange currency.').nullable().optional(),
    CountryISO2: z.string().describe('ISO 3166-1 alpha-2 country code.').nullable().optional(),
    CountryISO3: z.string().describe('ISO 3166-1 alpha-3 country code.').nullable().optional(),
  }).describe('A supported exchange returned by EODHD.')).describe('Supported exchange rows returned by EODHD.').optional(),
}).describe('Supported exchanges returned by EODHD.')

export const getRealTimeQuoteInput = z.strictObject({
  ticker: z.string().min(1).describe('Primary ticker with exchange code, such as AAPL.US.'),
  additionalTickers: z.array(z.string().min(1).describe('Additional ticker with exchange code, such as MSFT.US.')).min(1).describe('Additional ticker symbols to include in the quote request.').optional(),
  exchange: z.string().min(1).describe('Exchange code filter, such as US.').optional(),
}).describe('Input parameters for retrieving delayed real-time EODHD quote data.')

export const getRealTimeQuoteOutput = z.strictObject({
  quotes: z.array(z.looseObject({
    code: z.string().describe('Ticker code returned by EODHD.').nullable().optional(),
    timestamp: z.int().describe('Unix timestamp for the quote.').nullable().optional(),
    gmtoffset: z.int().describe('GMT offset reported by EODHD.').nullable().optional(),
    open: z.number().describe('Open price returned by EODHD.').nullable().optional(),
    high: z.number().describe('High price returned by EODHD.').nullable().optional(),
    low: z.number().describe('Low price returned by EODHD.').nullable().optional(),
    close: z.number().describe('Close price returned by EODHD.').nullable().optional(),
    volume: z.int().describe('Volume returned by EODHD.').nullable().optional(),
    previousClose: z.number().describe('Previous close value returned by EODHD.').nullable().optional(),
    change: z.number().describe('Absolute price change returned by EODHD.').nullable().optional(),
    change_p: z.number().describe('Percentage price change returned by EODHD.').nullable().optional(),
  }).describe('A delayed real-time quote returned by EODHD.')).describe('Quote rows returned by EODHD.').optional(),
}).describe('Delayed real-time quotes returned by EODHD.')

export const getEodInput = z.strictObject({
  ticker: z.string().min(1).describe('Ticker with exchange code, such as AAPL.US.'),
  dateFrom: z.iso.date().describe('Inclusive start date in YYYY-MM-DD format.').optional(),
  dateTo: z.iso.date().describe('Inclusive end date in YYYY-MM-DD format.').optional(),
  period: z.enum(['d', 'w', 'm']).describe('EODHD historical price period.').optional(),
  filter: z.enum(['last_date', 'last_open', 'last_high', 'last_low', 'last_close', 'last_volume']).describe('EODHD last-value filter for historical price data.').optional(),
}).describe('Input parameters for retrieving EODHD historical end-of-day price rows.')

export const getEodOutput = z.strictObject({
  rows: z.array(z.looseObject({
    date: z.string().describe('Price row date.').nullable().optional(),
    open: z.number().describe('Open price.').nullable().optional(),
    high: z.number().describe('High price.').nullable().optional(),
    low: z.number().describe('Low price.').nullable().optional(),
    close: z.number().describe('Close price.').nullable().optional(),
    adjusted_close: z.number().describe('Adjusted close price.').nullable().optional(),
    volume: z.int().describe('Trading volume.').nullable().optional(),
  }).describe('A historical EOD price row returned by EODHD.')).describe('Historical price rows returned by EODHD.').optional(),
  value: z.union([z.string().describe('String scalar returned by EODHD.'), z.number().describe('Numeric scalar returned by EODHD.')]).describe('Scalar last-value response returned when an EOD filter is used.').nullable().optional(),
  raw: z.looseObject({}).describe('The raw object returned by EODHD.').nullable().optional(),
}).describe('Historical EOD response returned by EODHD.')

export const getIdMappingInput = z.strictObject({
  filterSymbol: z.string().min(1).describe('Ticker symbol filter, such as AAPL.US.').optional(),
  filterExchange: z.string().min(1).describe('Exchange code filter, such as US.').optional(),
  filterIsin: z.string().min(1).describe('ISIN identifier filter.').optional(),
  filterFigi: z.string().min(1).describe('FIGI identifier filter.').optional(),
  filterLei: z.string().min(1).describe('LEI identifier filter.').optional(),
  filterCusip: z.string().min(1).describe('CUSIP identifier filter.').optional(),
  filterCik: z.string().min(1).describe('CIK identifier filter.').optional(),
  pageLimit: z.int().min(1).describe('Number of records per page.').optional(),
  pageOffset: z.int().min(0).describe('Pagination offset.').optional(),
}).describe('Input parameters for mapping EODHD security identifiers. At least one identifier filter is required.')

export const getIdMappingOutput = z.strictObject({
  mappings: z.array(z.looseObject({
    Code: z.string().describe('Ticker symbol.').nullable().optional(),
    Exchange: z.string().describe('Exchange code.').nullable().optional(),
    Name: z.string().describe('Company or instrument name.').nullable().optional(),
    ISIN: z.string().describe('ISIN identifier.').nullable().optional(),
    FIGI: z.string().describe('FIGI identifier.').nullable().optional(),
    LEI: z.string().describe('LEI identifier.').nullable().optional(),
    CUSIP: z.string().describe('CUSIP identifier.').nullable().optional(),
    CIK: z.string().describe('CIK identifier.').nullable().optional(),
  }).describe('A security identifier mapping returned by EODHD.')).describe('Security identifier mappings returned by EODHD.').optional(),
}).describe('Identifier mappings returned by EODHD.')

export const getMacroIndicatorsInput = z.strictObject({
  country: z.string().min(3).max(3).describe('ISO 3166-1 alpha-3 country code, such as USA.'),
  indicator: z.enum(['real_interest_rate', 'population_total', 'population_growth_annual', 'inflation_consumer_prices_annual', 'consumer_price_index', 'gdp_current_usd', 'gdp_per_capita_usd', 'gdp_growth_annual', 'debt_percent_gdp', 'net_trades_goods_services', 'inflation_gdp_deflator_annual', 'agriculture_value_added_percent_gdp', 'industry_value_added_percent_gdp', 'services_value_added_percent_gdp', 'exports_of_goods_services_percent_gdp', 'imports_of_goods_services_percent_gdp', 'gross_capital_formation_percent_gdp', 'net_migration', 'gni_usd', 'gni_per_capita_usd', 'gni_ppp_usd', 'gni_per_capita_ppp_usd', 'income_share_lowest_twenty', 'life_expectancy', 'fertility_rate', 'prevalence_hiv_total', 'co2_emissions_tons_per_capita', 'surface_area_km', 'poverty_poverty_lines_percent_population', 'revenue_excluding_grants_percent_gdp', 'cash_surplus_deficit_percent_gdp', 'startup_procedures_register', 'market_cap_domestic_companies_percent_gdp', 'mobile_subscriptions_per_hundred', 'internet_users_per_hundred', 'high_technology_exports_percent_total', 'merchandise_trade_percent_gdp', 'total_debt_service_percent_gni', 'unemployment_total_percent']).describe('Macroeconomic indicator code supported by EODHD.').optional(),
}).describe('Input parameters for retrieving EODHD macro indicator data.')

export const getMacroIndicatorsOutput = z.strictObject({
  indicators: z.array(z.looseObject({
    CountryCode: z.string().describe('ISO alpha-3 country code.').nullable().optional(),
    CountryName: z.string().describe('Country name.').nullable().optional(),
    Indicator: z.string().describe('Indicator display name.').nullable().optional(),
    Date: z.string().describe('Observation date.').nullable().optional(),
    Period: z.string().describe('Observation period.').nullable().optional(),
    Value: z.number().describe('Observed indicator value.').nullable().optional(),
  }).describe('A macro indicator row returned by EODHD.')).describe('Macro indicator rows returned by EODHD.').optional(),
}).describe('Macroeconomic indicator rows returned by EODHD.')

export const getUstYieldRatesInput = z.strictObject({
  dateFrom: z.iso.date().describe('Inclusive start date in YYYY-MM-DD format.').optional(),
  dateTo: z.iso.date().describe('Inclusive end date in YYYY-MM-DD format.').optional(),
  filterYear: z.int().min(1).describe('Year filter for Treasury yield rates.').optional(),
  pageLimit: z.int().min(1).describe('Number of records per page.').optional(),
  pageOffset: z.int().min(0).describe('Pagination offset.').optional(),
}).describe('Input parameters for retrieving EODHD US Treasury yield rates.')

export const getUstYieldRatesOutput = z.strictObject({
  rates: z.array(z.looseObject({
    'date': z.string().describe('Yield rate date.').nullable().optional(),
    '1_month': z.number().describe('One-month constant maturity rate.').nullable().optional(),
    '2_months': z.number().describe('Two-month constant maturity rate.').nullable().optional(),
    '3_months': z.number().describe('Three-month constant maturity rate.').nullable().optional(),
    '4_months': z.number().describe('Four-month constant maturity rate.').nullable().optional(),
    '6_months': z.number().describe('Six-month constant maturity rate.').nullable().optional(),
    '1_year': z.number().describe('One-year constant maturity rate.').nullable().optional(),
    '2_years': z.number().describe('Two-year constant maturity rate.').nullable().optional(),
    '3_years': z.number().describe('Three-year constant maturity rate.').nullable().optional(),
    '5_years': z.number().describe('Five-year constant maturity rate.').nullable().optional(),
    '7_years': z.number().describe('Seven-year constant maturity rate.').nullable().optional(),
    '10_years': z.number().describe('Ten-year constant maturity rate.').nullable().optional(),
    '20_years': z.number().describe('Twenty-year constant maturity rate.').nullable().optional(),
    '30_years': z.number().describe('Thirty-year constant maturity rate.').nullable().optional(),
  }).describe('A US Treasury yield rate row returned by EODHD.')).describe('US Treasury yield curve rows returned by EODHD.').optional(),
}).describe('US Treasury yield rate rows returned by EODHD.')

export const getUserInfoInput = z.strictObject({}).describe('Input parameters for retrieving the EODHD authenticated user.')

export const getUserInfoOutput = z.strictObject({
  user: z.looseObject({
    name: z.string().describe('User name returned by EODHD.').nullable(),
    email: z.string().describe('User email returned by EODHD.').nullable(),
    subscriptionType: z.string().describe('Subscription plan type.').nullable(),
    paymentMethod: z.string().describe('Payment method summary.').nullable(),
    apiRequests: z.int().describe('API requests used in the current period.').nullable(),
    apiRequestsDate: z.string().describe('Date of the current API request count.').nullable(),
    dailyRateLimit: z.int().describe('Daily API request limit.').nullable(),
  }).describe('Authenticated EODHD user details.').optional(),
}).describe('Authenticated user details returned by EODHD.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const eodhdApisActions = {
  search_instruments: {
    description: 'Search EODHD instruments by ticker, company name, or ISIN.',
    effect: 'read',
    inputSchema: searchInstrumentsInput,
    outputSchema: z.toJSONSchema(searchInstrumentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_exchanges: {
    description: 'List exchanges supported by EODHD.',
    effect: 'read',
    inputSchema: listExchangesInput,
    outputSchema: z.toJSONSchema(listExchangesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_real_time_quote: {
    description: 'Get delayed real-time quote data for one or more EODHD symbols.',
    effect: 'read',
    inputSchema: getRealTimeQuoteInput,
    outputSchema: z.toJSONSchema(getRealTimeQuoteOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_eod: {
    description: 'Get historical end-of-day price data for an EODHD ticker.',
    effect: 'read',
    inputSchema: getEodInput,
    outputSchema: z.toJSONSchema(getEodOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_id_mapping: {
    description: 'Map between EODHD ticker symbols and security identifiers.',
    effect: 'read',
    inputSchema: getIdMappingInput,
    outputSchema: z.toJSONSchema(getIdMappingOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_macro_indicators: {
    description: 'Get macroeconomic indicator time series for a country from EODHD.',
    effect: 'read',
    inputSchema: getMacroIndicatorsInput,
    outputSchema: z.toJSONSchema(getMacroIndicatorsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_ust_yield_rates: {
    description: 'Get US Treasury yield curve rates from EODHD.',
    effect: 'read',
    inputSchema: getUstYieldRatesInput,
    outputSchema: z.toJSONSchema(getUstYieldRatesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_user_info: {
    description: 'Get EODHD account details and API usage for the authenticated user.',
    effect: 'read',
    inputSchema: getUserInfoInput,
    outputSchema: z.toJSONSchema(getUserInfoOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
