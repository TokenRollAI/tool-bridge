/**
 * Open Exchange Rates 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/open_exchange_rates/executors.ts`,语义等价、写法
 * 本地化:凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走
 * `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 两处需要留意的上游特性:
 * - **凭证走 query 参数 `app_id`**,不是请求头。凭证因此会进 URL,可能被上游访问日志或
 *   中间代理记下;这是 OER API 的形状,不是这里的选择。
 * - OER 会在 **HTTP 200** 上用 `{error:true,status:401,message,description}` 报错。所以
 *   `response.ok` 为真也要再验一遍 body。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  convertCurrencyInput,
  getCurrenciesInput,
  getHistoricalRatesInput,
  getLatestRatesInput,
  getTimeseriesRatesInput,
} from './schema'
import { createProviderHttpClient, type ProviderQuery } from '../_runtime/providerHttp'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { asJsonObject as record } from '../_runtime/jsonValue'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'open_exchange_rates'
const API_BASE = 'https://openexchangerates.org/api'
const http = createProviderHttpClient({ baseUrl: `${API_BASE}/`, service: SERVICE })

type Json = Record<string, unknown>

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** OER 的错误消息优先级:`description`(面向人)> `message`(机器码)> `error`。 */
function errorMessage(payload: unknown): string | undefined {
  const body = record(payload)
  if (body === undefined) return undefined
  return text(body.description) ?? text(body.message) ?? text(body.error)
}

interface RequestInput {
  /** get_currencies 是公开端点,上游不给它带 app_id。 */
  includeAppId?: boolean
  path: string
  query?: Record<string, boolean | string | undefined>
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<Json> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  // get_currencies 不带 app_id 也照样要求配好凭证 —— 与上游的 api_key runtime 一致,
  // 免得"能调通一个 action"给人凭证已配好的错觉。
  const apiKey = requireApiKey(ctx, SERVICE)
  const query: ProviderQuery = [
    ...(input.includeAppId === false ? [] : [['app_id', apiKey]] as const),
    ...Object.entries(input.query ?? {}),
  ]
  const result = await http.request({
    path: input.path.replace(/^\//, ''),
    query,
    headers: { accept: 'application/json' },
    invalidJsonMessage: 'Open Exchange Rates 返回了非法 JSON',
    mapError: ({ bodyKind, data: payload, status }) => bodyKind === 'invalid-json'
      ? upstreamError(502, 'Open Exchange Rates 返回了非法 JSON')
      : upstreamError(
          status,
          errorMessage(payload) ?? `Open Exchange Rates 返回 HTTP ${status}`,
        ),
    mapTransportError: ({ message }) => upstreamError(
      502,
      message === undefined
        ? 'open_exchange_rates 请求失败'
        : `open_exchange_rates 请求失败: ${message}`,
    ),
  })
  const payload = result.data ?? null
  const body = record(payload)
  const flagged = body?.error === true
  if (flagged) {
    // 200 + `{error:true}` 时 HTTP 状态没有信息量,改用 body 里的 `status`。
    // (上游这条路径把 `ProviderRequestError` 的状态设成了 200,是它的 bug;这里不照抄。)
    const embedded = body?.status
    const status = typeof embedded === 'number' && embedded >= 400 ? embedded : 502
    throw upstreamError(status, errorMessage(payload) ?? `Open Exchange Rates 返回 HTTP ${result.status}`)
  }

  if (body === undefined) throw upstreamError(502, 'Open Exchange Rates 返回了非对象响应')
  return body
}

/** 三个 rates 端点共用的过滤器;`symbols` 数组要拼成逗号分隔串。 */
function ratesQuery(input: {
  base?: string | undefined
  showAlternative?: boolean | undefined
  symbols?: string[] | undefined
}): Record<string, boolean | string | undefined> {
  const symbols = input.symbols?.map(item => item.trim()).filter(item => item !== '').join(',')
  return {
    base: input.base,
    symbols: symbols === undefined || symbols === '' ? undefined : symbols,
    show_alternative: input.showAlternative,
  }
}

export function getCurrencies(
  _input: z.infer<typeof getCurrenciesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, { path: '/currencies.json', includeAppId: false })
}

export function getLatestRates(
  input: z.infer<typeof getLatestRatesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, { path: '/latest.json', query: ratesQuery(input) })
}

export function getHistoricalRates(
  input: z.infer<typeof getHistoricalRatesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, {
    path: `/historical/${encodeURIComponent(input.date)}.json`,
    query: ratesQuery(input),
  })
}

export function getTimeseriesRates(
  input: z.infer<typeof getTimeseriesRatesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 跨字段约束,schema 表达不了:两个日期都是 YYYY-MM-DD,字典序即时间序。
  if (input.startDate > input.endDate) {
    throw new TBError('invalid_argument', 'startDate 必须早于或等于 endDate')
  }
  return request(ctx, {
    path: '/time-series.json',
    query: { start: input.startDate, end: input.endDate, ...ratesQuery(input) },
  })
}

export function convertCurrency(
  input: z.infer<typeof convertCurrencyInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/convert/${encodeURIComponent(String(input.amount))}`
    + `/${encodeURIComponent(input.from)}/${encodeURIComponent(input.to)}`
  return request(ctx, { path })
}
