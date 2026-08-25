/**
 * IPGeolocation.io 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/ipgeolocation_io/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * IPGeolocation.io 的形状特点:
 * - **凭证是 query 参数 `apiKey`**,不走 header。
 * - 三个 action 都把上游 snake_case 的响应整形成 camelCase,且**缺失一律补 null 而非省略**
 *   (出参 schema 是 nullable),同时保留 `raw` 兜住整形没覆盖到的字段。
 * - `include` 是把六个布尔开关折成一个逗号分隔的参数,不是六个独立 query。
 */

import type { z } from 'zod/v4'
import type {
  getAstronomyInput,
  getTimezoneInput,
  lookupIpInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { createProviderHttpClient } from '../_runtime/providerHttp'
import { asJsonObject as toRecord } from '../_runtime/jsonValue'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'ipgeolocation_io'
const API_BASE = 'https://api.ipgeolocation.io/'
const REQUEST_TIMEOUT_MS = 30_000
const http = createProviderHttpClient({ baseUrl: API_BASE, service: SERVICE })

type Json = Record<string, unknown>

/** 字符串化取值:数字/布尔也接受(上游同样宽松),取不到就是 null。 */
function nullableString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

/** 数值取值:上游把经纬度这类字段有时回成字符串,故字符串也解析一次。 */
function nullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function nullableInteger(value: unknown): number | null {
  const parsed = nullableNumber(value)
  return parsed !== null && Number.isInteger(parsed) ? parsed : null
}

function errorMessage(payload: unknown, status: number): string {
  if (typeof payload === 'string' && payload.trim() !== '') return payload
  const record = toRecord(payload)
  const message = record?.message ?? record?.error
  if (typeof message === 'string' && message.trim() !== '') return message
  return `IPGeolocation.io request failed with status ${status}`
}

async function request(
  ctx: ProviderContext,
  path: string,
  params: Record<string, string | undefined>,
): Promise<Json> {
  const { data: payload } = await http.request({
    path,
    method: 'GET',
    query: [['apiKey', requireApiKey(ctx, SERVICE)], ...Object.entries(params)],
    headers: { accept: 'application/json' },
    timeoutMs: REQUEST_TIMEOUT_MS,
    invalidJsonMessage: 'IPGeolocation.io returned invalid JSON',
    mapError: ({ bodyKind, data, status }) => {
      if (bodyKind === 'invalid-json') return upstreamError(502, 'IPGeolocation.io returned invalid JSON')
      // 上游把所有 4xx(429 与凭证类除外)一律压成 400:这些端点的 404/422 都是
      // "参数不对",没有"资源不存在"的语义。保留。
      const normalized = status === 429 || status === 401 || status === 403
        ? status
        : (status >= 400 && status < 500 ? 400 : (status || 500))
      return upstreamError(normalized, errorMessage(data, status))
    },
    mapTransportError: ({ kind }) => kind === 'timeout'
      ? upstreamError(504, 'IPGeolocation.io request timed out')
      : upstreamError(502, 'IPGeolocation.io request failed'),
  })

  const record = toRecord(payload)
  if (record === undefined) throw upstreamError(502, 'IPGeolocation.io returned an invalid payload')
  return record
}

/** 逗号分隔的字段列表;空白项剔掉,全空则整个参数不传。 */
function joinList(value: string[] | undefined): string | undefined {
  if (value === undefined) return undefined
  const items = value.map(item => item.trim()).filter(item => item !== '')
  return items.length === 0 ? undefined : items.join(',')
}

function numberParam(value: number | undefined): string | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined
}

export async function lookupIp(
  input: z.infer<typeof lookupIpInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const includes = [
    input.includeHostname === true ? 'hostname' : undefined,
    input.includeGeoAccuracy === true ? 'geo_accuracy' : undefined,
    input.includeDmaCode === true ? 'dma_code' : undefined,
    input.includeSecurity === true ? 'security' : undefined,
    input.includeAbuse === true ? 'abuse' : undefined,
    input.includeUserAgent === true ? 'user_agent' : undefined,
  ].filter((item): item is string => item !== undefined)

  const payload = await request(ctx, 'v3/ipgeo', {
    ip: input.ip,
    fields: joinList(input.fields),
    excludes: joinList(input.excludes),
    include: includes.length > 0 ? includes.join(',') : undefined,
  })

  // v3 把地理字段收进 `location`,但用 `fields` 裁剪过的响应会把它们平铺在顶层;
  // 两种都要认,故取不到 location 时回退到 payload 本身。
  const location = toRecord(payload.location) ?? payload
  return {
    geolocation: {
      ip: nullableString(payload.ip),
      hostname: nullableString(payload.hostname),
      continentCode: nullableString(location.continent_code),
      continentName: nullableString(location.continent_name),
      countryCode2: nullableString(location.country_code2),
      countryCode3: nullableString(location.country_code3),
      countryName: nullableString(location.country_name),
      stateProvince: nullableString(location.state_prov),
      district: nullableString(location.district),
      city: nullableString(location.city),
      zipcode: nullableString(location.zipcode),
      latitude: nullableNumber(location.latitude),
      longitude: nullableNumber(location.longitude),
      callingCode: nullableString(toRecord(payload.country_metadata)?.calling_code),
      countryFlag: nullableString(location.country_flag),
      countryMetadata: toRecord(payload.country_metadata) ?? null,
      network: toRecord(payload.network) ?? null,
      asn: toRecord(payload.asn) ?? null,
      company: toRecord(payload.company) ?? null,
      timeZone: toRecord(payload.time_zone) ?? null,
      currency: toRecord(payload.currency) ?? null,
      security: toRecord(payload.security) ?? null,
      abuse: toRecord(payload.abuse) ?? null,
      userAgent: toRecord(payload.user_agent) ?? null,
      raw: payload,
    },
  }
}

export async function getTimezone(
  input: z.infer<typeof getTimezoneInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, 'v3/timezone', {
    ip: input.ip,
    lat: numberParam(input.lat),
    long: numberParam(input.long),
    location: input.location,
    // 入参叫 timeZone,上游 query 叫 tz。
    tz: input.timeZone,
  })

  return {
    timeZone: {
      timeZone: nullableString(payload.timezone),
      date: nullableString(payload.date),
      dateTime: nullableString(payload.date_time),
      dateTimeTxt: nullableString(payload.date_time_txt),
      dateTimeWti: nullableString(payload.date_time_wti),
      dateTimeYmd: nullableString(payload.date_time_ymd),
      dateTimeUnix: nullableNumber(payload.date_time_unix),
      time24: nullableString(payload.time_24),
      time12: nullableString(payload.time_12),
      week: nullableInteger(payload.week),
      month: nullableInteger(payload.month),
      year: nullableInteger(payload.year),
      yearAbbr: nullableString(payload.year_abbr),
      isDst: typeof payload.is_dst === 'boolean' ? payload.is_dst : null,
      dstSavings: nullableInteger(payload.dst_savings),
      geo: toRecord(payload.geo) ?? null,
      raw: payload,
    },
  }
}

export async function getAstronomy(
  input: z.infer<typeof getAstronomyInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, 'v3/astronomy', {
    ip: input.ip,
    lat: numberParam(input.lat),
    long: numberParam(input.long),
    location: input.location,
    date: input.date,
  })

  return {
    astronomy: {
      location: toRecord(payload.location) ?? null,
      date: nullableString(payload.date),
      currentTime: nullableString(payload.current_time),
      sunrise: nullableString(payload.sunrise),
      sunset: nullableString(payload.sunset),
      sunStatus: nullableString(payload.sun_status),
      solarNoon: nullableString(payload.solar_noon),
      dayLength: nullableString(payload.day_length),
      moonrise: nullableString(payload.moonrise),
      moonset: nullableString(payload.moonset),
      moonStatus: nullableString(payload.moon_status),
      moonPhase: nullableString(payload.moon_phase),
      moonIlluminationPercentage: nullableNumber(payload.moon_illumination_percentage),
      moonAngle: nullableNumber(payload.moon_angle),
      raw: payload,
    },
  }
}
