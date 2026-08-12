import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStormglassIoPlugin } from '../../src/stormglass_io/index'
import { stormglassIoActions } from '../../src/stormglass_io/schema'

/**
 * Stormglass 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 裸 authorization 头(没有 Bearer 前缀)、多值参数逗号连接而非重复键、
 * tide 端点把 `data` 改名成 `extremes`/`seaLevels` 的整形、以及 402 → 429 的特例。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'sg_test_key'
const plugin = createStormglassIoPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'weather/stormglass',
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

function mockStormglass(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

/** 取上游收到的那个请求。 */
function sent(mock: ReturnType<typeof vi.fn>): Request {
  return (mock.mock.calls[0] as [Request])[0]
}

const POINT = { lat: 58.7984, lng: 17.8081 }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 3 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(stormglassIoActions).length)
    expect(tools).toHaveLength(3)
    expect(tools.map(t => t.name)).toEqual([
      'get_weather_point',
      'get_tide_extremes',
      'get_tide_sea_level',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求组装', () => {
  it('get_weather_point:params/source 逗号连接,凭证是裸 authorization', async () => {
    const mock = mockStormglass(200, {
      hours: [{ time: '2024-01-01T00:00:00+00:00', windSpeed: { sg: 3.1 } }],
      meta: { dailyQuota: 10, requestCount: 1 },
    })
    const res = await call('get_weather_point', {
      ...POINT,
      params: ['windSpeed', 'waveHeight'],
      source: ['sg', 'noaa'],
      start: '2024-01-01',
      end: 1704153600,
    })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    const url = new URL(request.url)
    expect(url.origin).toBe('https://api.stormglass.io')
    expect(url.pathname).toBe('/v2/weather/point')
    expect(url.searchParams.get('lat')).toBe('58.7984')
    expect(url.searchParams.get('lng')).toBe('17.8081')
    expect(url.searchParams.get('params')).toBe('windSpeed,waveHeight')
    expect(url.searchParams.get('source')).toBe('sg,noaa')
    expect(url.searchParams.get('start')).toBe('2024-01-01')
    expect(url.searchParams.get('end')).toBe('1704153600')
    // 裸 key,不带 Bearer 前缀。
    expect(request.headers.get('authorization')).toBe(API_KEY)
    expect(request.headers.get('accept')).toBe('application/json')

    await expect(res.json()).resolves.toMatchObject({
      content: { meta: { dailyQuota: 10 } },
    })
  })

  it('省略的 start/end/source 不出现在 query 里', async () => {
    const mock = mockStormglass(200, { hours: [] })
    await call('get_weather_point', { ...POINT, params: ['windSpeed'] })
    const url = new URL(sent(mock).url)
    expect([...url.searchParams.keys()].sort()).toEqual(['lat', 'lng', 'params'])
  })

  it('get_tide_extremes:data 改名成 extremes,meta 缺失时补空对象', async () => {
    const mock = mockStormglass(200, {
      data: [{ height: 1.2, time: '2024-01-01T03:00:00+00:00', type: 'high' }],
    })
    const res = await call('get_tide_extremes', { ...POINT, datum: 'MSL' })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v2/tide/extremes/point')
    expect(url.searchParams.get('datum')).toBe('MSL')
    await expect(res.json()).resolves.toEqual({
      content: {
        extremes: [{ height: 1.2, time: '2024-01-01T03:00:00+00:00', type: 'high' }],
        meta: {},
      },
    })
  })

  it('get_tide_sea_level:data 改名成 seaLevels', async () => {
    const mock = mockStormglass(200, { data: [{ time: 't', sg: 0.4 }], meta: { datum: 'MLLW' } })
    const res = await call('get_tide_sea_level', POINT)
    expect(new URL(sent(mock).url).pathname).toBe('/v2/tide/sea-level/point')
    await expect(res.json()).resolves.toEqual({
      content: { seaLevels: [{ time: 't', sg: 0.4 }], meta: { datum: 'MLLW' } },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:params 为空数组 → 400 且不打上游', async () => {
    const mock = mockStormglass(200, { hours: [] })
    const res = await call('get_weather_point', { ...POINT, params: [] })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('params 含非法枚举值 → 400 且不打上游', async () => {
    const mock = mockStormglass(200, { hours: [] })
    const res = await call('get_weather_point', { ...POINT, params: ['notAParam'] })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('lat 超出 -90..90 → 400 且不打上游', async () => {
    const mock = mockStormglass(200, {})
    const res = await call('get_tide_extremes', { lat: 120, lng: 0 })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 message/error/detail', async () => {
    mockStormglass(401, { errors: {}, message: 'API key not found' })
    const denied = await call('get_tide_extremes', POINT)
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'API key not found',
    })

    mockStormglass(429, { error: 'Too many requests' })
    await expect((await call('get_tide_extremes', POINT)).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true, message: 'Too many requests' })

    mockStormglass(500, { detail: 'Stormglass is down' })
    await expect((await call('get_tide_extremes', POINT)).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('402(额度耗尽)归成可重试的限流,而不是 invalid_argument', async () => {
    mockStormglass(402, { message: 'Daily quota exceeded' })
    const res = await call('get_tide_extremes', POINT)
    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('hours 不是数组 → unavailable(上游契约破了,不是调用方的错)', async () => {
    mockStormglass(200, { hours: 'nope' })
    const res = await call('get_weather_point', { ...POINT, params: ['windSpeed'] })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockStormglass(200, {})
    const res = await call('get_tide_extremes', POINT, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
