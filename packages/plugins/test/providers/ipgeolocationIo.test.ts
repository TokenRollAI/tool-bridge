import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIpgeolocationIoPlugin } from '../../src/ipgeolocation_io/index'
import { ipgeolocationIoActions } from '../../src/ipgeolocation_io/schema'

/**
 * IPGeolocation.io 迁移产物的 wire 级验收。重点在凭证走 query 参数 `apiKey`、
 * 六个布尔开关折成一个 `include`、以及 snake_case → camelCase 的整形(缺失补 null)。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'ipgeo_test_key'
const plugin = createIpgeolocationIoPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'location/ipgeolocation',
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

function mockIpgeo(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

function sent(mock: ReturnType<typeof vi.fn>): Request {
  return (mock.mock.calls[0] as [Request])[0]
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 3 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(ipgeolocationIoActions).length)
    expect(tools).toHaveLength(3)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('lookup_ip', () => {
  it('凭证走 query 的 apiKey,include 折成一个逗号参数', async () => {
    const mock = mockIpgeo(200, {
      ip: '8.8.8.8',
      location: { country_code2: 'US', city: 'Mountain View', latitude: '37.4', longitude: '-122.0' },
      country_metadata: { calling_code: '+1' },
      time_zone: { name: 'America/Los_Angeles' },
    })
    const res = await call('lookup_ip', {
      ip: '8.8.8.8',
      fields: ['location', 'time_zone'],
      excludes: ['currency'],
      includeSecurity: true,
      includeHostname: true,
    })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    const url = new URL(request.url)
    expect(url.pathname).toBe('/v3/ipgeo')
    expect(url.searchParams.get('apiKey')).toBe(API_KEY)
    expect(url.searchParams.get('ip')).toBe('8.8.8.8')
    expect(url.searchParams.get('fields')).toBe('location,time_zone')
    expect(url.searchParams.get('excludes')).toBe('currency')
    // 顺序照搬上游的开关顺序,不是入参出现顺序。
    expect(url.searchParams.get('include')).toBe('hostname,security')

    await expect(res.json()).resolves.toMatchObject({
      content: {
        geolocation: {
          ip: '8.8.8.8',
          countryCode2: 'US',
          city: 'Mountain View',
          // 上游把经纬度回成字符串,整形时解析成数字。
          latitude: 37.4,
          longitude: -122,
          callingCode: '+1',
          timeZone: { name: 'America/Los_Angeles' },
        },
      },
    })
  })

  it('缺失字段补 null,raw 保留完整响应', async () => {
    mockIpgeo(200, { ip: '1.1.1.1' })
    const res = await call('lookup_ip', {})
    const body = (await res.json()) as { content: { geolocation: Record<string, unknown> } }
    expect(body.content.geolocation.city).toBeNull()
    expect(body.content.geolocation.asn).toBeNull()
    expect(body.content.geolocation.raw).toEqual({ ip: '1.1.1.1' })
  })

  it('没有 include 开关时不带 include 参数', async () => {
    const mock = mockIpgeo(200, { ip: '1.1.1.1' })
    await call('lookup_ip', {})
    const url = new URL(sent(mock).url)
    expect(url.searchParams.has('include')).toBe(false)
    expect(url.searchParams.has('ip')).toBe(false)
  })
})

describe('get_timezone 与 get_astronomy', () => {
  it('timeZone 入参映射成上游的 tz,坐标转成字符串', async () => {
    const mock = mockIpgeo(200, {
      timezone: 'Asia/Shanghai',
      date_time_unix: 1700000000,
      week: 46,
      is_dst: false,
    })
    const res = await call('get_timezone', { lat: 31.23, long: 121.47, timeZone: 'Asia/Shanghai' })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v3/timezone')
    expect(url.searchParams.get('lat')).toBe('31.23')
    expect(url.searchParams.get('long')).toBe('121.47')
    expect(url.searchParams.get('tz')).toBe('Asia/Shanghai')

    await expect(res.json()).resolves.toMatchObject({
      content: {
        timeZone: {
          timeZone: 'Asia/Shanghai',
          dateTimeUnix: 1700000000,
          week: 46,
          isDst: false,
          geo: null,
        },
      },
    })
  })

  it('get_astronomy 的 date 进 query,响应整形成 camelCase', async () => {
    const mock = mockIpgeo(200, {
      date: '2026-08-12',
      sunrise: '05:31',
      moon_phase: 'WAXING_GIBBOUS',
      moon_illumination_percentage: '82.5',
      location: { city: 'SF' },
    })
    const res = await call('get_astronomy', { location: 'San Francisco', date: '2026-08-12' })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v3/astronomy')
    expect(url.searchParams.get('location')).toBe('San Francisco')
    expect(url.searchParams.get('date')).toBe('2026-08-12')

    await expect(res.json()).resolves.toMatchObject({
      content: {
        astronomy: {
          date: '2026-08-12',
          sunrise: '05:31',
          moonPhase: 'WAXING_GIBBOUS',
          moonIlluminationPercentage: 82.5,
          location: { city: 'SF' },
          moonAngle: null,
        },
      },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验生效:lat 超界 → 400 且不打上游', async () => {
    const mock = mockIpgeo(200, {})
    const res = await call('get_timezone', { lat: 120 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('date 不是 YYYY-MM-DD → 400 且不打上游', async () => {
    const mock = mockIpgeo(200, {})
    const res = await call('get_astronomy', { date: '08/12/2026' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 message', async () => {
    mockIpgeo(401, { message: 'Provided API key is not valid' })
    await expect((await call('lookup_ip', {})).json())
      .resolves.toMatchObject({ code: 'permission_denied', message: 'Provided API key is not valid' })

    mockIpgeo(429, { message: 'Rate limit reached' })
    await expect((await call('lookup_ip', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    // 上游把 404 这类 4xx 一律压成 400(这些端点没有"资源不存在"语义)。
    mockIpgeo(404, { message: 'Not found' })
    await expect((await call('lookup_ip', {})).json())
      .resolves.toMatchObject({ code: 'invalid_argument' })

    mockIpgeo(500, { error: 'boom' })
    await expect((await call('lookup_ip', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → 503 且不打上游', async () => {
    const mock = mockIpgeo(200, {})
    const res = await call('lookup_ip', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
