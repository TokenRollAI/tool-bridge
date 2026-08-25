/**
 * 高德地图(AMap Web 服务 API)的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/amap/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * ## 凭证在 URL(部署侧需知)
 *
 * 高德的 API key 是 **`key` query 参数**,不是请求头 —— 这是高德 Web 服务 API 本身的设计
 * (上游 `definition.ts` 也写着 "sent as the key query parameter"),换成头会 401。
 * 故每一次出站的 URL 里都带明文凭证:**访问日志、出站抓包、错误上报里都要脱敏 `key`**。
 * 15 个 action 无一例外,没有"只有某几个会带"的余地。
 *
 * ## 三处上游细节决定了这里的形状
 *
 * - **失败以 HTTP 200 + `status: "0"` 表达**。高德几乎从不用 HTTP 状态报业务错误:
 *   key 失效、配额耗尽、参数缺失都是 200 带一个信封。只看 `response.ok` 会把每一次失败
 *   都当成空结果返回。真正的判据是 `status === '1'`。
 * - **`info` / `infocode` 比 HTTP 状态准**。同一个 200 里 `INVALID_USER_KEY`(凭证)与
 *   `DAILY_QUERY_OVER_LIMIT`(配额)语义完全不同,故先按这两个字段归一,拿不到再退回状态。
 * - **GET URL 有 2000 字符上限**,超了高德直接拒。上游只在 5 个路线规划 action 上查这条
 *   (只有它们会带 `waypoints` / `avoidpolygons` 这种能撑爆 URL 的参数),照搬这个范围。
 *
 * ## 与上游的有意偏离
 *
 * - **`ip_locate` 的 `ip` 变成实质必填**。上游能从 `context.clientIp`(调用方的来源 IP)兜底;
 *   tool-bridge 的 `ProviderContext` 没有这个东西 —— 而且真要有也不该用:那会是**网关**的
 *   出口 IP,不是最终用户的,定位结果是错的且看不出错。故不给 `ip` 就报 `invalid_argument`。
 * - 上游 2xx 上 JSON 解不开时报 `ProviderRequestError(response.status || 500)`,即 200 上
 *   会造出一个"状态 200 的错误";这里归 `unavailable`(上游坏了,不是插件崩了)。
 * - 上游 `mode: 'validate'` 把认证类错误压成 400 的分支只服务凭证校验流程,不迁。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  districtSearchInput,
  geocodeInput,
  getPlaceDetailInput,
  inputTipsInput,
  ipLocateInput,
  reverseGeocodeInput,
  routeBicyclingInput,
  routeDrivingInput,
  routeElectrobikeInput,
  routeTransitInput,
  routeWalkingInput,
  searchPlacesAroundInput,
  searchPlacesInput,
  searchPlacesPolygonInput,
  weatherInput,
} from './schema'
import { booleanValue as boolean, asJsonObject as record, trimmedText as text } from '../_runtime/jsonValue'
import { createProviderHttpClient, type ProviderQuery } from '../_runtime/providerHttp'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'amap'
const API_BASE = 'https://restapi.amap.com'
const http = createProviderHttpClient({ baseUrl: API_BASE, service: SERVICE })
/** 高德对 GET 的 URL 长度上限;超了直接拒。 */
const MAX_GET_URL_LENGTH = 2000

/** 凭证类错误:调用方要换 key(或去控制台放开域名/IP 白名单),不是重试能解决的。 */
const AUTH_INFOS = new Set([
  'INVALID_USER_KEY',
  'SERVICE_NOT_AVAILABLE',
  'USERKEY_PLAT_NOMATCH',
  'INVALID_USER_DOMAIN',
  'INVALID_USER_IP',
  'INVALID_USER_SIGNATURE',
  'INVALID_USER_SCODE',
])
const AUTH_INFOCODES = new Set(['10001', '10002'])
/** 配额/频率:这些出现时一律按 429 处理,不管高德给的是什么 HTTP 状态。 */
const RATE_LIMIT_INFOS = new Set(['DAILY_QUERY_OVER_LIMIT', 'ACCESS_TOO_FREQUENT'])
const RATE_LIMIT_INFOCODES = new Set(['10003', '10004'])
/** 请求本身不被接受(缺参、参数非法)。 */
const INPUT_ERROR_INFOS = new Set(['MISSING_REQUIRED_PARAMS', 'INVALID_PARAMS'])
const INPUT_ERROR_INFOCODES = new Set(['18001', '18002'])

type Json = Record<string, unknown>
type QueryValue = boolean | number | string | undefined

function number(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

/** 上游 `readObjectArray`:非数组兜底成空,数组里的非对象项**丢掉**(不是报错)。 */
function recordArray(value: unknown): Json[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => record(item))
    .filter((item): item is Json => item !== undefined)
}

/** `geocodes[].city` 既可能是单个串也可能是串数组(高德对直辖市回数组)。 */
function stringOrStringArray(value: unknown): string | string[] | undefined {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === 'string')
}

/**
 * 上游 `requiredString`:Zod 的必填拦不住纯空白串,而空白的 address / origin 打到高德
 * 是一次必然失败的请求,故这层必须保留。
 */
function requireText(value: unknown, field: string): string {
  const result = text(value)
  if (result === undefined) throw new TBError('invalid_argument', `${field} is required.`)
  return result
}

/** `showFields` 是逗号分隔的串;`cost` 在不在里面决定出参带不带费用字段。 */
function hasShowField(value: unknown, field: string): boolean {
  if (typeof value !== 'string') return false
  return value.split(',').map(item => item.trim()).includes(field)
}

function buildUrl(path: string, query: Record<string, QueryValue>): string {
  const url = new URL(path, API_BASE)
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

/** `info` 与 `infocode` 都在时拼成 `INFO (INFOCODE)` —— 那个码是查高德文档的唯一线索。 */
function errorMessage(status: number, info: string | undefined, infocode: string | undefined): string {
  if (info !== undefined && infocode !== undefined) return `${info} (${infocode})`
  if (info !== undefined) return info
  if (infocode !== undefined) return `amap request failed with ${infocode}`
  return `amap request failed with ${status}`
}

/**
 * 高德错误 → TBError。`info` / `infocode` 优先(它们才带语义),拿不到再按 HTTP 状态归一。
 * 认证类归 401 而不是 400:换 key 才能修,不是改参数。
 */
function amapError(status: number, payload: Json): TBError {
  const info = typeof payload.info === 'string' ? payload.info : undefined
  const infocode = typeof payload.infocode === 'string' ? payload.infocode : undefined
  const message = errorMessage(status, info, infocode)

  if (status === 429 || RATE_LIMIT_INFOS.has(info ?? '') || RATE_LIMIT_INFOCODES.has(infocode ?? '')) {
    return upstreamError(429, message)
  }
  if (
    status === 401
    || status === 403
    || AUTH_INFOS.has(info ?? '')
    || AUTH_INFOCODES.has(infocode ?? '')
  ) {
    return upstreamError(401, message)
  }
  if (status === 400 || INPUT_ERROR_INFOS.has(info ?? '') || INPUT_ERROR_INFOCODES.has(infocode ?? '')) {
    return upstreamError(400, message)
  }
  return upstreamError(status === 0 ? 500 : status, message)
}

/**
 * 打一次高德接口。**`key` 是 query 参数**(见文件顶部),由这里统一补上 ——
 * 每个 handler 各自拼 key 的话,漏一个就是一次匿名调用,而高德会用 200 + `status:"0"`
 * 回答,看起来像"没有结果"。
 */
async function amapGet(ctx: ProviderContext, path: string, query: Record<string, QueryValue>): Promise<Json> {
  const { data, status } = await http.request({
    path,
    method: 'GET',
    query: Object.entries({ ...query, key: requireApiKey(ctx, SERVICE) }) satisfies ProviderQuery,
    headers: { accept: 'application/json' },
    invalidJsonMessage: 'amap 返回了非 JSON 对象响应',
    mapError: ({ data: payload, status }) => {
      const body = record(payload)
      return body === undefined
        ? new TBError('unavailable', 'amap 返回了非 JSON 对象响应', { retryable: true })
        : amapError(status, body)
    },
    mapTransportError: ({ message }) => upstreamError(
      502,
      message === undefined ? 'amap request failed' : `amap request failed: ${message}`,
    ),
  })
  const payload = record(data)
  if (payload === undefined) {
    // 高德的每一个响应都该是 JSON 对象;不是就说明上游坏了(或者被中间设备劫持了)。
    throw new TBError('unavailable', 'amap 返回了非 JSON 对象响应', { retryable: true })
  }

  // 这是本 provider 最关键的一行:高德用 200 + status:"0" 表达失败,只看 ok 会把
  // 每一次失败都当成空结果返回。
  if (payload.status !== '1') throw amapError(status, payload)
  return payload
}

/**
 * 路线规划才查 URL 长度:只有它们会带能撑爆 URL 的参数(waypoints / avoidpolygons)。
 * 长度要**连 `key` 一起算** —— 它也占 URL,而且不短。
 */
function assertGetUrlLength(ctx: ProviderContext, path: string, query: Record<string, QueryValue>): void {
  if (buildUrl(path, { ...query, key: requireApiKey(ctx, SERVICE) }).length > MAX_GET_URL_LENGTH) {
    throw new TBError('invalid_argument', 'amap GET request is too long')
  }
}

/**
 * POI 的裁剪出参:9 个命名字段。上游对 `search_places*` 与 `get_place_detail` 共用这一份,
 * 未声明的字段一律丢掉。
 */
function poi(item: Json): Json {
  return {
    id: text(item.id),
    name: text(item.name),
    type: text(item.type),
    typecode: text(item.typecode),
    address: text(item.address),
    location: text(item.location),
    pname: text(item.pname),
    cityname: text(item.cityname),
    adname: text(item.adname),
  }
}

function poiSearchOutput(payload: Json): Json {
  return {
    count: text(payload.count),
    pois: recordArray(payload.pois).map(item => poi(item)),
  }
}

export async function geocode(
  input: z.infer<typeof geocodeInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await amapGet(ctx, '/v3/geocode/geo', {
    address: requireText(input.address, 'address'),
    city: text(input.city),
  })
  return {
    geocodes: recordArray(payload.geocodes).map(item => ({
      formattedAddress: text(item.formatted_address),
      country: text(item.country),
      province: text(item.province),
      city: stringOrStringArray(item.city),
      district: text(item.district),
      adcode: text(item.adcode),
      location: text(item.location),
    })),
  }
}

export async function reverseGeocode(
  input: z.infer<typeof reverseGeocodeInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await amapGet(ctx, '/v3/geocode/regeo', {
    location: requireText(input.location, 'location'),
    radius: number(input.radius),
    extensions: text(input.extensions),
    // 入参是 camelCase 的 roadLevel,高德认的是全小写 roadlevel。
    roadlevel: number(input.roadLevel),
  })
  const regeocode = record(payload.regeocode)
  return {
    formattedAddress: text(regeocode?.formatted_address),
    addressComponent: record(regeocode?.addressComponent),
    pois: recordArray(regeocode?.pois),
    roads: recordArray(regeocode?.roads),
    roadinters: recordArray(regeocode?.roadinters),
    aois: recordArray(regeocode?.aois),
  }
}

export async function searchPlaces(
  input: z.infer<typeof searchPlacesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return poiSearchOutput(await amapGet(ctx, '/v5/place/text', {
    keywords: requireText(input.keywords, 'keywords'),
    region: text(input.region),
    city_limit: boolean(input.cityLimit),
    types: text(input.types),
    page_num: number(input.pageNum),
    page_size: number(input.pageSize),
    show_fields: text(input.showFields),
  }))
}

export async function searchPlacesAround(
  input: z.infer<typeof searchPlacesAroundInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return poiSearchOutput(await amapGet(ctx, '/v5/place/around', {
    location: requireText(input.location, 'location'),
    radius: number(input.radius),
    keywords: text(input.keywords),
    types: text(input.types),
    sortrule: text(input.sortRule),
    page_num: number(input.pageNum),
    page_size: number(input.pageSize),
    show_fields: text(input.showFields),
  }))
}

export async function searchPlacesPolygon(
  input: z.infer<typeof searchPlacesPolygonInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return poiSearchOutput(await amapGet(ctx, '/v5/place/polygon', {
    polygon: requireText(input.polygon, 'polygon'),
    keywords: text(input.keywords),
    types: text(input.types),
    page_num: number(input.pageNum),
    page_size: number(input.pageSize),
    show_fields: text(input.showFields),
  }))
}

export async function getPlaceDetail(
  input: z.infer<typeof getPlaceDetailInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await amapGet(ctx, '/v5/place/detail', {
    id: requireText(input.id, 'id'),
    show_fields: text(input.showFields),
  })
  // 详情接口不回 count,故这里只透出 pois(不是共用 poiSearchOutput)。
  return { pois: recordArray(payload.pois).map(item => poi(item)) }
}

export async function inputTips(
  input: z.infer<typeof inputTipsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await amapGet(ctx, '/v3/assistant/inputtips', {
    keywords: requireText(input.keywords, 'keywords'),
    type: text(input.type),
    location: text(input.location),
    city: text(input.city),
    // 入参 cityLimit,高德认的是全小写 citylimit;下面 datatype 同理。
    citylimit: boolean(input.cityLimit),
    datatype: text(input.dataType),
  })
  return { tips: recordArray(payload.tips) }
}

export async function ipLocate(
  input: z.infer<typeof ipLocateInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 上游能退回 context.clientIp;这一层没有那个东西,见文件顶部的偏离说明。
  const ip = text(input.ip)
  if (ip === undefined) {
    throw new TBError('invalid_argument', 'ip is required: 本层拿不到调用方的来源 IP,必须显式给出要定位的 IP')
  }
  const payload = await amapGet(ctx, '/v3/ip', { ip })
  return {
    province: text(payload.province),
    city: text(payload.city),
    adcode: text(payload.adcode),
    rectangle: text(payload.rectangle),
  }
}

export async function districtSearch(
  input: z.infer<typeof districtSearchInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await amapGet(ctx, '/v3/config/district', {
    keywords: requireText(input.keywords, 'keywords'),
    subdistrict: number(input.subDistrict),
    extensions: text(input.extensions),
    page: number(input.page),
    offset: number(input.offset),
    filter: text(input.filter),
  })
  return {
    count: text(payload.count),
    districts: recordArray(payload.districts),
  }
}

export async function weather(
  input: z.infer<typeof weatherInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const extensions = text(input.extensions)
  const payload = await amapGet(ctx, '/v3/weather/weatherInfo', {
    city: requireText(input.city, 'city'),
    extensions,
  })
  // 同一个端点两种出参:`all` 回预报、其余回实况。两个键在出参 schema 里都是 optional,
  // 只带其中一个。
  if (extensions === 'all') return { forecasts: recordArray(payload.forecasts) }
  return { lives: recordArray(payload.lives) }
}

/** walking / bicycling / electrobike 共用的形状。 */
function simpleRoutePaths(value: unknown, includeCost: boolean): Json[] {
  return recordArray(value).map((item) => {
    const path: Json = {
      distance: text(item.distance),
      steps: recordArray(item.steps),
    }
    const cost = record(item.cost)
    if (!includeCost || cost === undefined) return path
    return { ...path, cost: { duration: text(cost.duration) } }
  })
}

async function simpleRoute(
  ctx: ProviderContext,
  path: string,
  input: { destination: string, origin: string, showFields?: string },
  extra: Record<string, QueryValue> = {},
): Promise<Json> {
  const query = {
    origin: requireText(input.origin, 'origin'),
    destination: requireText(input.destination, 'destination'),
    show_fields: text(input.showFields),
    ...extra,
  }
  assertGetUrlLength(ctx, path, query)
  const payload = await amapGet(ctx, path, query)
  const route = record(payload.route)
  return {
    route: {
      origin: text(route?.origin),
      destination: text(route?.destination),
      paths: simpleRoutePaths(route?.paths, hasShowField(input.showFields, 'cost')),
    },
  }
}

export async function routeWalking(
  input: z.infer<typeof routeWalkingInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return simpleRoute(ctx, '/v5/direction/walking', input)
}

export async function routeBicycling(
  input: z.infer<typeof routeBicyclingInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return simpleRoute(ctx, '/v5/direction/bicycling', input, {
    alternative_route: text(input.alternativeRoute),
  })
}

export async function routeElectrobike(
  input: z.infer<typeof routeElectrobikeInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return simpleRoute(ctx, '/v5/direction/electrobike', input)
}

export async function routeDriving(
  input: z.infer<typeof routeDrivingInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const query = {
    origin: requireText(input.origin, 'origin'),
    destination: requireText(input.destination, 'destination'),
    waypoints: text(input.waypoints),
    strategy: text(input.strategy),
    plate: text(input.plate),
    cartype: text(input.carType),
    avoidpolygons: text(input.avoidPolygons),
    show_fields: text(input.showFields),
  }
  assertGetUrlLength(ctx, '/v5/direction/driving', query)
  const payload = await amapGet(ctx, '/v5/direction/driving', query)
  const route = record(payload.route)
  const includeCost = hasShowField(input.showFields, 'cost')

  return {
    route: {
      origin: text(route?.origin),
      destination: text(route?.destination),
      taxi_cost: text(route?.taxi_cost),
      // 驾车路径多两个字段:限行信息与过路费。
      paths: recordArray(route?.paths).map((item) => {
        const path: Json = {
          distance: text(item.distance),
          restriction: text(item.restriction),
          steps: recordArray(item.steps),
        }
        const cost = record(item.cost)
        if (!includeCost || cost === undefined) return path
        return { ...path, cost: { duration: text(cost.duration), tolls: text(cost.tolls) } }
      }),
    },
  }
}

/**
 * 公交换乘的 segment 是**原样透出**的(出参 schema 是 looseObject),只有 `cost` 被处理:
 * 没要 cost 时把这个键**删掉**,要了就只留 `transit_fee`。
 * 这是上游唯一一处"保留未声明字段"的地方,别顺手改成裁剪。
 */
function transitSegments(value: unknown, includeCost: boolean): Json[] {
  return recordArray(value).map((item) => {
    if (!includeCost) {
      const rest = { ...item }
      delete rest.cost
      return rest
    }
    const cost = record(item.cost)
    if (cost === undefined) return item
    return { ...item, cost: { transit_fee: text(cost.transit_fee) } }
  })
}

export async function routeTransit(
  input: z.infer<typeof routeTransitInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const query = {
    origin: requireText(input.origin, 'origin'),
    destination: requireText(input.destination, 'destination'),
    // 入参是 originCity / destinationCity,高德认的是 city1 / city2。
    city1: requireText(input.originCity, 'originCity'),
    city2: requireText(input.destinationCity, 'destinationCity'),
    strategy: text(input.strategy),
    nightflag: text(input.nightFlag),
    show_fields: text(input.showFields),
  }
  assertGetUrlLength(ctx, '/v5/direction/transit/integrated', query)
  const payload = await amapGet(ctx, '/v5/direction/transit/integrated', query)
  const route = record(payload.route)
  const includeCost = hasShowField(input.showFields, 'cost')
  const taxiCost = record(route?.cost)

  return {
    route: {
      origin: text(route?.origin),
      destination: text(route?.destination),
      cost: includeCost && taxiCost !== undefined ? { taxi_fee: text(taxiCost.taxi_fee) } : undefined,
      transits: recordArray(route?.transits).map((item) => {
        const transit: Json = {
          distance: text(item.distance),
          nightflag: text(item.nightflag),
          segments: transitSegments(item.segments, includeCost),
        }
        const cost = record(item.cost)
        if (!includeCost || cost === undefined) return transit
        return { ...transit, cost: { duration: text(cost.duration) } }
      }),
    },
  }
}
