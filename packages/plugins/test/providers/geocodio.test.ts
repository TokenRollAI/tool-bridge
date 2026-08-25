import { describe, expect, it } from 'vitest'
import { createProviderHarness } from '../support/providerHarness'
import { createGeocodioPlugin } from '../../src/geocodio/index'
import { geocodioActions } from '../../src/geocodio/schema'

/**
 * Geocodio 迁移产物的 wire 级验收。重点在凭证走 query 参数、批量端点的数组进 POST body、
 * 反向查询把 lat/lng 拼成一个 q,以及"至少给一个地址字段"这条跨字段约束。
 */

const API_KEY = 'geocodio_key_deadbeef'
const plugin = createGeocodioPlugin()

const {
  call,
  envelope,
  sent,
  mockJson: mockGeocodio,
} = createProviderHarness({
  mountPath: 'geo/geocodio',
  plugin,
  upstreamAuth: API_KEY,
})

describe('契约面', () => {
  it('List 出全部 4 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(geocodioActions).length)
    expect(tools).toHaveLength(4)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求成形', () => {
  it('凭证走 query 参数,地址组件逐个进 query', async () => {
    const mock = mockGeocodio(200, { results: [] })
    await call('single_geocode', {
      street: '1109 N Highland St',
      city: 'Arlington',
      state: 'VA',
      fields: 'cd,stateleg',
      limit: 1,
    })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.geocod.io/v1.12/geocode')
    expect(url.searchParams.get('api_key')).toBe(API_KEY)
    expect(url.searchParams.get('street')).toBe('1109 N Highland St')
    expect(url.searchParams.get('city')).toBe('Arlington')
    expect(url.searchParams.get('fields')).toBe('cd,stateleg')
    expect(url.searchParams.get('limit')).toBe('1')
    expect(url.searchParams.has('q')).toBe(false)
  })

  it('批量端点把数组放进 POST body,过滤器仍走 query', async () => {
    const mock = mockGeocodio(200, { results: [] })
    await call('geocode_batch', { addresses: ['1 Main St', '2 Oak Ave'], limit: 2 })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toContain('application/json')
    await expect(request.json()).resolves.toEqual(['1 Main St', '2 Oak Ave'])
    const url = new URL(request.url)
    expect(url.pathname).toBe('/v1.12/geocode')
    expect(url.searchParams.get('limit')).toBe('2')
  })

  it('反向查询把 lat/lng 拼成一个 q', async () => {
    const mock = mockGeocodio(200, { results: [] })
    await call('single_reverse_geocode', { lat: 38.886, lng: -77.094, format: 'simple' })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v1.12/reverse')
    expect(url.searchParams.get('q')).toBe('38.886,-77.094')
    expect(url.searchParams.get('format')).toBe('simple')
    expect(url.searchParams.has('lat')).toBe(false)
  })

  it('响应原样透出(形状随 format/fields 变,不做归一)', async () => {
    mockGeocodio(200, { lat: 38.886, lng: -77.094, address: '1109 N Highland St', source: 'Arlington' })
    const res = await call('single_reverse_geocode', { lat: 38.886, lng: -77.094, format: 'simple' })
    await expect(res.json()).resolves.toEqual({
      content: { lat: 38.886, lng: -77.094, address: '1109 N Highland St', source: 'Arlington' },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:lat 超范围 → 400 且不打上游', async () => {
    const mock = mockGeocodio(200, {})
    const res = await call('single_reverse_geocode', { lat: 999, lng: 0 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('single_geocode 一个地址字段都不给 → 400 且不打上游(schema 表达不了的跨字段约束)', async () => {
    const mock = mockGeocodio(200, {})
    const res = await call('single_geocode', { limit: 1 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('address component')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 error 字段', async () => {
    mockGeocodio(403, { error: 'Invalid API key' })
    const denied = await call('single_geocode', { q: 'x' })
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    mockGeocodio(401, { error: 'Missing API key' })
    expect((await call('single_geocode', { q: 'x' })).status).toBe(401)

    mockGeocodio(429, { error: 'Rate limit exceeded' })
    await expect((await call('single_geocode', { q: 'x' })).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockGeocodio(422, { error: 'Could not parse address' })
    await expect((await call('single_geocode', { q: 'x' })).json())
      .resolves.toMatchObject({ code: 'invalid_argument' })

    mockGeocodio(500, {})
    await expect((await call('single_geocode', { q: 'x' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockGeocodio(200, {})
    const res = await call('single_geocode', { q: 'x' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
