import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGraphhopperPlugin } from '../../src/graphhopper/index'
import { graphhopperActions } from '../../src/graphhopper/schema'

/**
 * GraphHopper 迁移产物的 wire 级验收。重点在:凭证走 `key` query、数组参数重复同名键
 * (顺序即语义)、camelCase → snake_case/带点层级名的映射、跨字段互斥的本地拦截。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'gh_test_key'
const plugin = createGraphhopperPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'maps/graphhopper',
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

function mockGraphhopper(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 5 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(graphhopperActions).length)
    expect(tools).toHaveLength(5)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求形状', () => {
  it('calculate_route:point 重复同名键且保序,带点层级名照发,凭证走 key query', async () => {
    const mock = mockGraphhopper(200, { paths: [{ distance: 1200, time: 300000 }] })
    const res = await call('calculate_route', {
      point: ['52.5,13.4', '52.6,13.5'],
      profile: 'car',
      chDisable: true,
      roundTripDistance: 5000,
      alternativeRouteMaxPaths: 3,
      calcPoints: false,
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin).toBe('https://graphhopper.com')
    expect(url.pathname).toBe('/api/1/route')
    expect(url.searchParams.getAll('point')).toEqual(['52.5,13.4', '52.6,13.5'])
    expect(url.searchParams.get('profile')).toBe('car')
    expect(url.searchParams.get('ch.disable')).toBe('true')
    expect(url.searchParams.get('round_trip.distance')).toBe('5000')
    expect(url.searchParams.get('alternative_route.max_paths')).toBe('3')
    expect(url.searchParams.get('calc_points')).toBe('false')
    expect(url.searchParams.get('key')).toBe(API_KEY)
    expect(url.searchParams.has('locale')).toBe(false)
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBeNull()
    await expect(res.json()).resolves.toMatchObject({ content: { paths: [{ distance: 1200 }] } })
  })

  it('compute_matrix:from/to 数组各自重复同名键', async () => {
    const mock = mockGraphhopper(200, { times: [[0, 100]] })
    await call('compute_matrix', {
      fromPoint: ['52.5,13.4'],
      toPoint: ['52.6,13.5', '52.7,13.6'],
      outArray: ['times', 'distances'],
    })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/1/matrix')
    expect(url.searchParams.getAll('from_point')).toEqual(['52.5,13.4'])
    expect(url.searchParams.getAll('to_point')).toEqual(['52.6,13.5', '52.7,13.6'])
    expect(url.searchParams.getAll('out_array')).toEqual(['times', 'distances'])
  })

  it('list_profiles:裸数组与 {profiles} 两种响应都归一到 {profiles}', async () => {
    mockGraphhopper(200, [{ id: 'my_car' }])
    await expect((await call('list_profiles', {})).json())
      .resolves.toEqual({ content: { profiles: [{ id: 'my_car' }] } })

    mockGraphhopper(200, { profiles: [{ id: 'my_bike' }] })
    await expect((await call('list_profiles', {})).json())
      .resolves.toEqual({ content: { profiles: [{ id: 'my_bike' }] } })
  })
})

describe('校验与错误', () => {
  it('入参校验生效:point 少于 2 个 → 400 且不打上游', async () => {
    const mock = mockGraphhopper(200, {})
    const res = await call('calculate_route', { point: ['52.5,13.4'] })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('geocode 的条件必填在本地就挡下(schema 表达不了)', async () => {
    const mock = mockGraphhopper(200, {})
    const forward = await call('geocode', { limit: 5 })
    expect(forward.status).toBe(400)
    expect(((await forward.json()) as { message: string }).message).toContain('q is required')

    // point 的检查在 q 之前(照搬上游顺序),故这里必须给上 point 才能测到后一条。
    const reverse = await call('geocode', { reverse: true, point: '52.5,13.4', q: 'Berlin' })
    expect(reverse.status).toBe(400)
    expect(((await reverse.json()) as { message: string }).message).toContain('q must be omitted')
    expect(mock).not.toHaveBeenCalled()
  })

  it('compute_matrix 的 point 与 from/to 互斥,isochrone 的两种上限互斥', async () => {
    const mock = mockGraphhopper(200, {})
    const matrix = await call('compute_matrix', {
      point: ['52.5,13.4', '52.6,13.5', '52.7,13.6'],
      fromPoint: ['52.5,13.4'],
    })
    expect(matrix.status).toBe(400)
    expect(((await matrix.json()) as { message: string }).message).toContain('cannot be combined')

    const isochrone = await call('compute_isochrone', { point: '52.5,13.4', timeLimit: 600, distanceLimit: 5000 })
    expect(isochrone.status).toBe(400)
    expect(((await isochrone.json()) as { message: string }).message).toContain('cannot be provided together')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息可从 hints[] 里取', async () => {
    mockGraphhopper(401, { message: 'Invalid API key' })
    const denied = await call('list_profiles', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    mockGraphhopper(429, { message: 'API limit reached' })
    await expect((await call('list_profiles', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', message: 'API limit reached', retryable: true })

    mockGraphhopper(400, { hints: [{ message: 'Cannot find point 0' }] })
    await expect((await call('calculate_route', { point: ['0,0', '1,1'] })).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'Cannot find point 0' })
  })

  it('没配 authRef → 503 且不打上游', async () => {
    const mock = mockGraphhopper(200, {})
    const res = await call('list_profiles', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
