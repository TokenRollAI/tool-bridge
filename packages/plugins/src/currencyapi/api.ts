/**
 * currencyapi 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/currencyapi/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 一处有意偏离上游:上游 `createCurrencyapiError` 把 401 与 422 都压成 400。这里把原始
 * 状态交给 `upstreamError`,401 仍是 permission_denied —— 把"key 不对"说成"入参不对"
 * 会让调用方反复重试同一个坏凭证。
 *
 * 响应归一保持上游的**严格**口径:缺字段或类型不对一律 502。这个 API 的响应结构是稳定
 * 契约的一部分(出参 schema 里全是必填),悄悄放行残缺数据比报错更糟。
 */

import type { z } from 'zod/v4'
import type {
  convertCurrencyInput,
  getHistoricalRatesInput,
  getLatestRatesInput,
  getSupportedCurrenciesInput,
} from './schema'
import { asJsonObject as record, trimmedText as text } from '../_runtime/jsonValue'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { createProviderHttpClient } from '../_runtime/providerHttp'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'currencyapi'
const API_BASE = 'https://api.currencyapi.com'
const http = createProviderHttpClient({ baseUrl: `${API_BASE}/`, service: SERVICE })

type Json = Record<string, unknown>
type QueryValue = number | string | undefined

function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') return text(payload)
  const body = record(payload)
  return text(body?.message) ?? text(record(body?.error)?.message)
}

function requireObject(value: unknown, field: string): Json {
  const body = record(value)
  // 以下 require* 全是**响应**校验:失败即上游破契约,不是调用方的错,故一律 502。
  if (body === undefined) throw upstreamError(502, `${field} must be an object`)
  return body
}

async function request(ctx: ProviderContext, path: string, query?: Record<string, QueryValue>): Promise<Json> {
  const apiKey = requireApiKey(ctx, SERVICE)
  const { data } = await http.request({
    path,
    query: Object.entries(query ?? {}),
    headers: { accept: 'application/json', apikey: apiKey },
    invalidJson: 'text',
    mapError: ({ data: payload, status }) => upstreamError(
      status,
      errorMessage(payload) ?? `currencyapi request failed with ${status || 500}`,
    ),
    mapTransportError: ({ message }) => upstreamError(
      502,
      message === undefined ? 'currencyapi request failed' : `currencyapi request failed: ${message}`,
    ),
  })
  return requireObject(data ?? null, 'payload')
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw upstreamError(502, `${field} must be a non-empty string`)
  }
  return value
}

function requireInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw upstreamError(502, `${field} must be an integer`)
  return value
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw upstreamError(502, `${field} must be a number`)
  return value
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw upstreamError(502, `${field} must be an array`)
  return value.map(item => String(item))
}

function normalizeQuotaBucket(value: unknown, field: string): Record<string, number> {
  const bucket = requireObject(value, field)
  return {
    total: requireInteger(bucket.total, `${field}.total`),
    used: requireInteger(bucket.used, `${field}.used`),
    remaining: requireInteger(bucket.remaining, `${field}.remaining`),
  }
}

/** 汇率类响应(latest / historical / convert)共用同一形状。 */
function normalizeRates(payload: Json): Json {
  const meta = requireObject(payload.meta, 'meta')
  const data = requireObject(payload.data, 'data')
  return {
    meta: { last_updated_at: requireString(meta.last_updated_at, 'meta.last_updated_at') },
    data: Object.fromEntries(Object.entries(data).map(([code, item]) => {
      const rate = requireObject(item, `data.${code}`)
      return [code, {
        code: requireString(rate.code, `data.${code}.code`),
        value: requireNumber(rate.value, `data.${code}.value`),
      }]
    })),
  }
}

/** 多个币种在 query 里是逗号拼接,不是重复同名键。 */
function currenciesQuery(value: string[] | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value.join(',')
}

export async function getApiStatus(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, '/v3/status')
  const quotas = requireObject(payload.quotas, 'quotas')
  return {
    account_id: requireInteger(payload.account_id, 'account_id'),
    quotas: {
      month: normalizeQuotaBucket(quotas.month, 'quotas.month'),
      grace: normalizeQuotaBucket(quotas.grace, 'quotas.grace'),
    },
  }
}

export async function getSupportedCurrencies(
  input: z.infer<typeof getSupportedCurrenciesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/v3/currencies', {
    currencies: currenciesQuery(input.currencies),
    type: input.type,
  })

  const data = requireObject(payload.data, 'data')
  return {
    data: Object.fromEntries(Object.entries(data).map(([code, item]) => {
      const meta = requireObject(item, `data.${code}`)
      return [code, {
        symbol: requireString(meta.symbol, `data.${code}.symbol`),
        name: requireString(meta.name, `data.${code}.name`),
        symbol_native: requireString(meta.symbol_native, `data.${code}.symbol_native`),
        decimal_digits: requireInteger(meta.decimal_digits, `data.${code}.decimal_digits`),
        rounding: requireNumber(meta.rounding, `data.${code}.rounding`),
        code: requireString(meta.code, `data.${code}.code`),
        name_plural: requireString(meta.name_plural, `data.${code}.name_plural`),
        type: requireString(meta.type, `data.${code}.type`),
        countries: requireStringArray(meta.countries, `data.${code}.countries`),
      }]
    })),
  }
}

export async function getLatestRates(
  input: z.infer<typeof getLatestRatesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return normalizeRates(await request(ctx, '/v3/latest', {
    base_currency: input.base_currency,
    currencies: currenciesQuery(input.currencies),
    type: input.type,
  }))
}

export async function getHistoricalRates(
  input: z.infer<typeof getHistoricalRatesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return normalizeRates(await request(ctx, '/v3/historical', {
    date: input.date,
    base_currency: input.base_currency,
    currencies: currenciesQuery(input.currencies),
    type: input.type,
  }))
}

export async function convertCurrency(
  input: z.infer<typeof convertCurrencyInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return normalizeRates(await request(ctx, '/v3/convert', {
    value: input.value,
    date: input.date,
    base_currency: input.base_currency,
    currencies: currenciesQuery(input.currencies),
    type: input.type,
  }))
}
