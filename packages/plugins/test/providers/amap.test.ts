import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAmapPlugin } from '../../src/amap/index'
import { amapActions } from '../../src/amap/schema'

/**
 * 高德地图迁移产物的 wire 级验收。重点钉住几处"迁移最容易迁丢"的地方:
 * 凭证是 **URL 上的 `key`**(不是头)、失败以 **HTTP 200 + `status:"0"`** 表达、
 * `info` / `infocode` 比 HTTP 状态准、camelCase 入参改名成高德的全小写参数、
 * `showFields` 里有没有 `cost` 决定出参带不带费用字段、以及 2000 字符的 GET URL 上限。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'amapkey_deadbeef'
const plugin = createAmapPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'location/amap',
  exportId: 'actions',
}

function envelope(body: unknown, opts: { auth?: string | null } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'authorization': `Bearer ${PLUGIN_TOKEN}`,
    'content-type': 'application/json',
    [HEADER_TB_CONTEXT]: encodeCallContext(CALLER),
  }
  const auth = opts.auth === undefined ? API_KEY : opts.auth
  if (auth !== null) {
    headers[HEADER_TB_UPSTREAM_AUTH] = base64urlEncode(new TextEncoder().encode(auth))
  }
  return Promise.resolve(plugin.fetch(
    new Request('https://plugin.test/', { method: 'POST', headers, body: JSON.stringify(body) }),
    ENV as never,
  ))
}

function call(name: string, args: unknown, opts?: { auth?: string | null }): Promise<Response> {
  return envelope({ tool: 'Call', arguments: { name, args } }, opts)
}

/** 成功响应必须带 `status: '1'`;这个 helper 帮忙补上,免得每个用例都写。 */
function mockAmap(payload: Json, status = 200): ReturnType<typeof vi.fn> {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const fn = vi.fn(() => Promise.resolve(new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

type Json = Record<string, unknown> | string

/** 成功信封。 */
function ok(payload: Record<string, unknown>): Record<string, unknown> {
  return { status: '1', info: 'OK', infocode: '10000', ...payload }
}

/** 取上游收到的那个请求。 */
function sent(mock: ReturnType<typeof vi.fn>): Request {
  return (mock.mock.calls[0] as [Request])[0]
}

function sentUrl(mock: ReturnType<typeof vi.fn>): URL {
  return new URL(sent(mock).url)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 15 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(amapActions).length)
    expect(tools).toHaveLength(15)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'district_search',
      'geocode',
      'get_place_detail',
      'input_tips',
      'ip_locate',
      'reverse_geocode',
      'route_bicycling',
      'route_driving',
      'route_electrobike',
      'route_transit',
      'route_walking',
      'search_places',
      'search_places_around',
      'search_places_polygon',
      'weather',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('凭证在 URL 上(高德的设计)', () => {
  it('key 是 query 参数而不是请求头', async () => {
    const mock = mockAmap(ok({ geocodes: [] }))
    await call('geocode', { address: '北京市朝阳区' })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin).toBe('https://restapi.amap.com')
    expect(url.pathname).toBe('/v3/geocode/geo')
    expect(url.searchParams.get('key')).toBe(API_KEY)
    // 换成头会被高德忽略并回 INVALID_USER_KEY,故这里钉住"别顺手改成 Bearer"。
    expect(request.headers.get('authorization')).toBeNull()
    expect(request.headers.get('x-api-key')).toBeNull()
  })

  it('每个 action 都带上 key —— 漏一个就是一次匿名调用,而高德用 200 回答', async () => {
    const cases: Array<[string, unknown]> = [
      ['geocode', { address: 'a' }],
      ['reverse_geocode', { location: '1,2' }],
      ['search_places', { keywords: 'k' }],
      ['search_places_around', { location: '1,2' }],
      ['search_places_polygon', { polygon: '1,2;3,4' }],
      ['get_place_detail', { id: 'B1' }],
      ['input_tips', { keywords: 'k' }],
      ['ip_locate', { ip: '1.2.3.4' }],
      ['district_search', { keywords: '北京' }],
      ['weather', { city: '110000' }],
      ['route_driving', { origin: '1,2', destination: '3,4' }],
      ['route_walking', { origin: '1,2', destination: '3,4' }],
      ['route_bicycling', { origin: '1,2', destination: '3,4' }],
      ['route_electrobike', { origin: '1,2', destination: '3,4' }],
      ['route_transit', { origin: '1,2', destination: '3,4', originCity: '北京', destinationCity: '上海' }],
    ]
    expect(cases).toHaveLength(Object.keys(amapActions).length)

    for (const [name, args] of cases) {
      vi.unstubAllGlobals()
      const mock = mockAmap(ok({}))
      const res = await call(name, args)
      expect(res.status, `${name} 应当成功`).toBe(200)
      expect(sentUrl(mock).searchParams.get('key'), `${name} 漏了 key`).toBe(API_KEY)
    }
  })

  it('没配 authRef → 报错且不打上游', async () => {
    const mock = mockAmap(ok({}))
    const res = await call('geocode', { address: 'a' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('参数改名(camelCase 入参 → 高德的全小写参数)', () => {
  it('reverse_geocode 的 roadLevel → roadlevel', async () => {
    const mock = mockAmap(ok({ regeocode: {} }))
    await call('reverse_geocode', { location: '116.4,39.9', radius: 500, extensions: 'all', roadLevel: 1 })
    expect(Object.fromEntries(sentUrl(mock).searchParams)).toEqual({
      location: '116.4,39.9',
      radius: '500',
      extensions: 'all',
      roadlevel: '1',
      key: API_KEY,
    })
  })

  it('search_places 的 cityLimit / pageNum / pageSize / showFields 各自改名', async () => {
    const mock = mockAmap(ok({ pois: [] }))
    await call('search_places', {
      keywords: '咖啡',
      region: '北京',
      cityLimit: true,
      types: '050000',
      pageNum: 2,
      pageSize: 20,
      showFields: 'business',
    })
    expect(Object.fromEntries(sentUrl(mock).searchParams)).toEqual({
      keywords: '咖啡',
      region: '北京',
      city_limit: 'true',
      types: '050000',
      page_num: '2',
      page_size: '20',
      show_fields: 'business',
      key: API_KEY,
    })
  })

  it('input_tips 的 cityLimit → citylimit、dataType → datatype', async () => {
    const mock = mockAmap(ok({ tips: [] }))
    await call('input_tips', { keywords: '肯德', cityLimit: false, dataType: 'poi' })
    const params = sentUrl(mock).searchParams
    expect(params.get('citylimit')).toBe('false')
    expect(params.get('datatype')).toBe('poi')
  })

  it('search_places_around 的 sortRule → sortrule;district_search 的 subDistrict → subdistrict', async () => {
    const around = mockAmap(ok({ pois: [] }))
    await call('search_places_around', { location: '1,2', sortRule: 'distance' })
    expect(sentUrl(around).searchParams.get('sortrule')).toBe('distance')

    vi.unstubAllGlobals()
    const district = mockAmap(ok({ districts: [] }))
    await call('district_search', { keywords: '浙江', subDistrict: 2 })
    expect(sentUrl(district).searchParams.get('subdistrict')).toBe('2')
  })

  it('route_driving 的 carType → cartype、avoidPolygons → avoidpolygons', async () => {
    const mock = mockAmap(ok({ route: {} }))
    await call('route_driving', {
      origin: '1,2',
      destination: '3,4',
      carType: '0',
      avoidPolygons: '1,2;3,4',
      plate: '京A12345',
    })
    const params = sentUrl(mock).searchParams
    expect(params.get('cartype')).toBe('0')
    expect(params.get('avoidpolygons')).toBe('1,2;3,4')
    expect(params.get('plate')).toBe('京A12345')
  })

  it('route_transit 的 originCity / destinationCity → city1 / city2', async () => {
    const mock = mockAmap(ok({ route: {} }))
    await call('route_transit', {
      origin: '1,2',
      destination: '3,4',
      originCity: '北京',
      destinationCity: '上海',
      nightFlag: '1',
    })
    const params = sentUrl(mock).searchParams
    expect(params.get('city1')).toBe('北京')
    expect(params.get('city2')).toBe('上海')
    expect(params.get('nightflag')).toBe('1')
  })

  it('未给的可选参数不出现在 query 里', async () => {
    const mock = mockAmap(ok({ geocodes: [] }))
    await call('geocode', { address: 'a' })
    expect([...sentUrl(mock).searchParams.keys()].sort()).toEqual(['address', 'key'])
  })

  it('纯空白的可选参数按"没给"处理(Zod 拦不住空白串)', async () => {
    const mock = mockAmap(ok({ geocodes: [] }))
    await call('geocode', { address: 'a', city: '   ' })
    expect(sentUrl(mock).searchParams.has('city')).toBe(false)
  })

  it('路线规划的各自专属参数:bicycling 带 alternative_route,walking 不带', async () => {
    const bike = mockAmap(ok({ route: {} }))
    await call('route_bicycling', { origin: '1,2', destination: '3,4', alternativeRoute: '1' })
    expect(sentUrl(bike).searchParams.get('alternative_route')).toBe('1')
    expect(sentUrl(bike).pathname).toBe('/v5/direction/bicycling')

    vi.unstubAllGlobals()
    const walk = mockAmap(ok({ route: {} }))
    await call('route_walking', { origin: '1,2', destination: '3,4' })
    expect(sentUrl(walk).pathname).toBe('/v5/direction/walking')
    expect(sentUrl(walk).searchParams.has('alternative_route')).toBe(false)

    vi.unstubAllGlobals()
    const bike2 = mockAmap(ok({ route: {} }))
    await call('route_electrobike', { origin: '1,2', destination: '3,4' })
    expect(sentUrl(bike2).pathname).toBe('/v5/direction/electrobike')
  })
})

describe('HTTP 200 + status:"0" 就是失败(本 provider 最容易迁丢的一处)', () => {
  it('status 不是 "1" 时报错,而不是当成空结果返回', async () => {
    mockAmap({ status: '0', info: 'INVALID_PARAMS', infocode: '20000' }, 200)
    const res = await call('geocode', { address: 'a' })
    // 只看 response.ok 的实现会在这里回 200 + 空 geocodes,把失败悄悄吃掉。
    expect(res.status).not.toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      message: 'INVALID_PARAMS (20000)',
    })
  })

  it('key 失效以 200 + INVALID_USER_KEY 回来,归 permission_denied 而不是"空结果"', async () => {
    mockAmap({ status: '0', info: 'INVALID_USER_KEY', infocode: '10001' }, 200)
    const res = await call('weather', { city: '110000' })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'INVALID_USER_KEY (10001)',
    })
  })

  it('配额耗尽以 200 + DAILY_QUERY_OVER_LIMIT 回来,归 rate_limited + retryable', async () => {
    mockAmap({ status: '0', info: 'DAILY_QUERY_OVER_LIMIT', infocode: '10003' }, 200)
    const res = await call('geocode', { address: 'a' })
    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('频率过高(ACCESS_TOO_FREQUENT / 10004)同样归 rate_limited', async () => {
    mockAmap({ status: '0', infocode: '10004' }, 200)
    const res = await call('geocode', { address: 'a' })
    expect(res.status).toBe(429)
    // 只有 infocode 没有 info 时的消息兜底。
    await expect(res.json()).resolves.toMatchObject({ message: 'amap request failed with 10004' })
  })

  it('缺参类(MISSING_REQUIRED_PARAMS / 18001)归 invalid_argument', async () => {
    mockAmap({ status: '0', info: 'MISSING_REQUIRED_PARAMS', infocode: '18001' }, 200)
    const res = await call('geocode', { address: 'a' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
  })

  it('平台不匹配 / 域名或 IP 白名单类错误也归 permission_denied', async () => {
    for (const info of ['USERKEY_PLAT_NOMATCH', 'INVALID_USER_DOMAIN', 'INVALID_USER_IP', 'SERVICE_NOT_AVAILABLE']) {
      vi.unstubAllGlobals()
      mockAmap({ status: '0', info }, 200)
      const res = await call('geocode', { address: 'a' })
      expect(res.status, info).toBe(401)
      await expect(res.json(), info).resolves.toMatchObject({ code: 'permission_denied', message: info })
    }
  })

  it('认不出的 info 时按 HTTP 状态归一:200 上退化成 invalid_argument', async () => {
    mockAmap({ status: '0', info: 'UNKNOWN_THING', infocode: '99999' }, 200)
    const res = await call('geocode', { address: 'a' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ message: 'UNKNOWN_THING (99999)' })
  })
})

describe('HTTP 层错误', () => {
  it('上游 5xx → unavailable + retryable', async () => {
    mockAmap({ status: '0', info: 'ENGINE_RESPONSE_DATA_ERROR' }, 503)
    const res = await call('geocode', { address: 'a' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('上游 429 → rate_limited', async () => {
    mockAmap({ status: '0' }, 429)
    const res = await call('geocode', { address: 'a' })
    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('非 JSON / 非对象响应 → unavailable(上游坏了,不是插件崩了)', async () => {
    mockAmap('<html>error</html>')
    const res = await call('geocode', { address: 'a' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })

    vi.unstubAllGlobals()
    mockAmap('[1,2,3]')
    await expect((await call('geocode', { address: 'a' })).json())
      .resolves.toMatchObject({ code: 'unavailable' })
  })
})

describe('响应整形', () => {
  it('geocode:裁剪成命名字段,city 支持单串与串数组两种形态', async () => {
    mockAmap(ok({
      geocodes: [
        {
          formatted_address: '北京市朝阳区',
          country: '中国',
          province: '北京市',
          city: '北京市',
          district: '朝阳区',
          adcode: '110105',
          location: '116.4,39.9',
          dropped_field: 'x',
        },
        { city: [], province: '上海市' },
      ],
    }))
    await expect((await call('geocode', { address: 'a' })).json()).resolves.toEqual({
      content: {
        geocodes: [
          {
            formattedAddress: '北京市朝阳区',
            country: '中国',
            province: '北京市',
            city: '北京市',
            district: '朝阳区',
            adcode: '110105',
            location: '116.4,39.9',
          },
          { city: [], province: '上海市' },
        ],
      },
    })
  })

  it('POI 列表裁剪成 9 个命名字段,count 一并透出', async () => {
    mockAmap(ok({
      count: '2',
      pois: [
        {
          id: 'B1',
          name: '星巴克',
          type: '餐饮',
          typecode: '050501',
          address: '某路 1 号',
          location: '116.4,39.9',
          pname: '北京市',
          cityname: '北京市',
          adname: '朝阳区',
          photos: ['dropped'],
        },
        'not an object',
      ],
    }))
    await expect((await call('search_places', { keywords: 'k' })).json()).resolves.toEqual({
      content: {
        count: '2',
        // 数组里的非对象项被丢掉(上游 readObjectArray 的口径),不是报错。
        pois: [{
          id: 'B1',
          name: '星巴克',
          type: '餐饮',
          typecode: '050501',
          address: '某路 1 号',
          location: '116.4,39.9',
          pname: '北京市',
          cityname: '北京市',
          adname: '朝阳区',
        }],
      },
    })
  })

  it('get_place_detail 只回 pois,不回 count(详情接口没有这个字段)', async () => {
    mockAmap(ok({ count: '1', pois: [{ id: 'B1', name: 'x' }] }))
    await expect((await call('get_place_detail', { id: 'B1' })).json()).resolves.toEqual({
      content: { pois: [{ id: 'B1', name: 'x' }] },
    })
  })

  it('reverse_geocode:addressComponent 原样透出,四类邻近数组缺失时兜底成空数组', async () => {
    mockAmap(ok({
      regeocode: {
        formatted_address: '北京市朝阳区',
        addressComponent: { province: '北京市', streetNumber: { street: '某路' } },
        pois: [{ id: 'p1' }],
      },
    }))
    await expect((await call('reverse_geocode', { location: '1,2' })).json()).resolves.toEqual({
      content: {
        formattedAddress: '北京市朝阳区',
        addressComponent: { province: '北京市', streetNumber: { street: '某路' } },
        pois: [{ id: 'p1' }],
        roads: [],
        roadinters: [],
        aois: [],
      },
    })
  })

  it('weather:extensions=all 回 forecasts,其余回 lives(两个键不同时出现)', async () => {
    const all = mockAmap(ok({ forecasts: [{ city: '北京' }], lives: [{ ignored: true }] }))
    await expect((await call('weather', { city: '110000', extensions: 'all' })).json())
      .resolves.toEqual({ content: { forecasts: [{ city: '北京' }] } })
    expect(sentUrl(all).searchParams.get('extensions')).toBe('all')

    vi.unstubAllGlobals()
    mockAmap(ok({ lives: [{ city: '北京', temperature: '20' }], forecasts: [{ ignored: true }] }))
    await expect((await call('weather', { city: '110000', extensions: 'base' })).json())
      .resolves.toEqual({ content: { lives: [{ city: '北京', temperature: '20' }] } })

    vi.unstubAllGlobals()
    mockAmap(ok({ lives: [] }))
    await expect((await call('weather', { city: '110000' })).json())
      .resolves.toEqual({ content: { lives: [] } })
  })

  it('ip_locate 裁剪成四个字段', async () => {
    mockAmap(ok({ province: '北京市', city: '北京市', adcode: '110000', rectangle: '1,2;3,4', extra: 'x' }))
    await expect((await call('ip_locate', { ip: '1.2.3.4' })).json()).resolves.toEqual({
      content: { province: '北京市', city: '北京市', adcode: '110000', rectangle: '1,2;3,4' },
    })
  })
})

describe('showFields 里有没有 cost 决定出参带不带费用', () => {
  const drivingPayload = ok({
    route: {
      origin: '1,2',
      destination: '3,4',
      taxi_cost: '38',
      paths: [{
        distance: '12000',
        restriction: '0',
        steps: [{ instruction: '向北' }],
        cost: { duration: '1800', tolls: '5', traffic_lights: '3' },
      }],
    },
  })

  it('没要 cost:费用字段整块不出现', async () => {
    mockAmap(drivingPayload)
    await expect((await call('route_driving', { origin: '1,2', destination: '3,4' })).json())
      .resolves.toEqual({
        content: {
          route: {
            origin: '1,2',
            destination: '3,4',
            taxi_cost: '38',
            paths: [{ distance: '12000', restriction: '0', steps: [{ instruction: '向北' }] }],
          },
        },
      })
  })

  it('要了 cost:驾车只留 duration 与 tolls(traffic_lights 不在声明里)', async () => {
    mockAmap(drivingPayload)
    await expect((await call('route_driving', {
      origin: '1,2',
      destination: '3,4',
      showFields: 'polyline,cost',
    })).json()).resolves.toMatchObject({
      content: { route: { paths: [{ cost: { duration: '1800', tolls: '5' } }] } },
    })
  })

  it('showFields 用逗号分隔且允许空格,按整段匹配而不是子串', async () => {
    const spaced = mockAmap(drivingPayload)
    await expect((await call('route_driving', {
      origin: '1,2',
      destination: '3,4',
      showFields: 'polyline, cost',
    })).json()).resolves.toMatchObject({
      content: { route: { paths: [{ cost: { duration: '1800' } }] } },
    })
    expect(sentUrl(spaced).searchParams.get('show_fields')).toBe('polyline, cost')

    // `costly` 不该被当成命中 `cost`。
    vi.unstubAllGlobals()
    mockAmap(drivingPayload)
    const substring = await call('route_driving', {
      origin: '1,2',
      destination: '3,4',
      showFields: 'costly',
    })
    const body = (await substring.json()) as { content: { route: { paths: Array<{ cost?: unknown }> } } }
    expect(body.content.route.paths[0]!.cost).toBeUndefined()
  })

  it('简单路线(walking)只留 cost.duration,不带 tolls / restriction', async () => {
    mockAmap(ok({
      route: {
        origin: '1,2',
        destination: '3,4',
        paths: [{
          distance: '800',
          restriction: '0',
          steps: [{ instruction: '直行' }],
          cost: { duration: '600', tolls: '0' },
        }],
      },
    }))
    await expect((await call('route_walking', {
      origin: '1,2',
      destination: '3,4',
      showFields: 'cost',
    })).json()).resolves.toEqual({
      content: {
        route: {
          origin: '1,2',
          destination: '3,4',
          paths: [{ distance: '800', steps: [{ instruction: '直行' }], cost: { duration: '600' } }],
        },
      },
    })
  })

  it('公交换乘:segment 是原样透出的,只有 cost 被处理', async () => {
    const payload = ok({
      route: {
        origin: '1,2',
        destination: '3,4',
        cost: { taxi_fee: '120', other: 'x' },
        transits: [{
          distance: '30000',
          nightflag: '0',
          cost: { duration: '3600', extra: 'x' },
          segments: [{
            walking: { distance: '200' },
            bus: { buslines: [{ name: '1 路' }] },
            cost: { transit_fee: '4', extra: 'x' },
          }],
        }],
      },
    })

    // 要了 cost:route.cost 只留 taxi_fee、transit.cost 只留 duration、segment.cost 只留 transit_fee,
    // 但 segment 自身的 walking / bus 原样保留(出参 schema 是 looseObject)。
    mockAmap(payload)
    await expect((await call('route_transit', {
      origin: '1,2',
      destination: '3,4',
      originCity: '北京',
      destinationCity: '天津',
      showFields: 'cost',
    })).json()).resolves.toEqual({
      content: {
        route: {
          origin: '1,2',
          destination: '3,4',
          cost: { taxi_fee: '120' },
          transits: [{
            distance: '30000',
            nightflag: '0',
            cost: { duration: '3600' },
            segments: [{
              walking: { distance: '200' },
              bus: { buslines: [{ name: '1 路' }] },
              cost: { transit_fee: '4' },
            }],
          }],
        },
      },
    })

    // 没要 cost:route.cost 不出现、transit.cost 不出现、segment 里的 cost 键被删掉。
    vi.unstubAllGlobals()
    mockAmap(payload)
    await expect((await call('route_transit', {
      origin: '1,2',
      destination: '3,4',
      originCity: '北京',
      destinationCity: '天津',
    })).json()).resolves.toEqual({
      content: {
        route: {
          origin: '1,2',
          destination: '3,4',
          transits: [{
            distance: '30000',
            nightflag: '0',
            segments: [{
              walking: { distance: '200' },
              bus: { buslines: [{ name: '1 路' }] },
            }],
          }],
        },
      },
    })
  })
})

describe('入参校验', () => {
  it('缺必填 → 400 且不打上游', async () => {
    const mock = mockAmap(ok({}))
    expect((await call('geocode', {})).status).toBe(400)
    expect((await call('route_transit', { origin: '1,2', destination: '3,4' })).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('纯空白的必填参数在本地就挡下(Zod 的必填拦不住空白串)', async () => {
    const mock = mockAmap(ok({}))
    const res = await call('geocode', { address: '   ' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'address is required.',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('ip_locate 不给 ip → invalid_argument(本层拿不到调用方来源 IP)', async () => {
    const mock = mockAmap(ok({}))
    const res = await call('ip_locate', {})
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: expect.stringContaining('ip is required'),
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('extensions 不在枚举里由 Zod 拦下', async () => {
    const mock = mockAmap(ok({}))
    expect((await call('weather', { city: '110000', extensions: 'full' })).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('GET URL 超过 2000 字符 → invalid_argument 且不打上游(高德直接拒)', async () => {
    const mock = mockAmap(ok({ route: {} }))
    const res = await call('route_driving', {
      origin: '1,2',
      destination: '3,4',
      waypoints: '116.481028,39.989643;'.repeat(120),
    })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'amap GET request is too long',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('长度检查算上了 key —— 刚好卡在边界的请求不能因为漏算 key 而放过去', async () => {
    // 这个 filler 长度是刻意选的:带上 key 时 URL 长 2008(超限),不带 key 只有 1987(不超)。
    // 漏算 key 的实现会在这里放行,然后被高德拒掉。
    const filler = 'a'.repeat(1900)
    const mock = mockAmap(ok({ route: {} }))
    const res = await call('route_driving', { origin: '1,2', destination: '3,4', waypoints: filler })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ message: 'amap GET request is too long' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('非路线 action 不查 URL 长度(上游只在路线上查)', async () => {
    const mock = mockAmap(ok({ pois: [] }))
    const res = await call('search_places', { keywords: 'k'.repeat(2500) })
    expect(res.status).toBe(200)
    expect(mock).toHaveBeenCalledTimes(1)
  })
})
