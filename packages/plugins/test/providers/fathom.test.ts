import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFathomPlugin } from '../../src/fathom/index'
import { fathomActions } from '../../src/fathom/schema'

/**
 * Fathom 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * form-encoded 的写请求(更新也走 POST)、cursor 分页的互斥、聚合报表的数组编码
 * (逗号分隔 vs filters 的 JSON)、entity 决定的条件必填、路径参数注入。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'fathom_test_token'
const plugin = createFathomPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'analytics/fathom',
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

function mockFathom(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 15 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(fathomActions).length)
    expect(tools).toHaveLength(15)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('get_account')).toBe('read')
    expect(effectOf('list_sites')).toBe('read')
    expect(effectOf('get_current_visitors')).toBe('read')
    expect(effectOf('create_site')).toBe('write')
    expect(effectOf('update_milestone')).toBe('write')
  })
})

describe('读请求:URL、凭证头与分页', () => {
  it('get_account 打 /v1/account,凭证走 Bearer,不带 body', async () => {
    const mock = mockFathom(200, { id: 42, object: 'account', name: 'Ada', email: 'ada@example.com' })
    const res = await call('get_account', {})

    const request = sent(mock)
    expect(request.url).toBe('https://api.usefathom.com/v1/account')
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('accept')).toBe('application/json')
    expect(request.headers.get('content-type')).toBeNull()
    await expect(res.json()).resolves.toEqual({
      content: { id: 42, object: 'account', name: 'Ada', email: 'ada@example.com' },
    })
  })

  it('cursor 分页参数进 query,has_more 原样透出', async () => {
    const mock = mockFathom(200, {
      object: 'list',
      url: '/v1/sites',
      has_more: true,
      data: [{ id: 'CDBUGS', object: 'site' }],
    })
    const res = await call('list_sites', { limit: 2, starting_after: 'CDBUGS' })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v1/sites')
    expect(url.searchParams.get('limit')).toBe('2')
    expect(url.searchParams.get('starting_after')).toBe('CDBUGS')
    expect(url.searchParams.has('ending_before')).toBe(false)
    await expect(res.json()).resolves.toMatchObject({ content: { has_more: true } })
  })

  it('路径参数被 URL 编码(site_id 里的斜杠不能劈出新路径段)', async () => {
    const mock = mockFathom(200, { id: 'a/b', object: 'event' })
    await call('get_event', { site_id: 'a/b', event_id: 'signed up' })
    expect(sent(mock).url).toBe('https://api.usefathom.com/v1/sites/a%2Fb/events/signed%20up')
  })

  it('get_current_visitors 的 detailed 进 query,detailed 响应里的 content 字段不被当作结果信封', async () => {
    const mock = mockFathom(200, {
      total: 3,
      content: [{ pathname: '/', hostname: 'example.com', total: 3 }],
      referrers: [],
    })
    const res = await call('get_current_visitors', { site_id: 'CDBUGS', detailed: true })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v1/current_visitors')
    expect(url.searchParams.get('site_id')).toBe('CDBUGS')
    expect(url.searchParams.get('detailed')).toBe('true')
    await expect(res.json()).resolves.toEqual({
      content: {
        total: 3,
        content: [{ pathname: '/', hostname: 'example.com', total: 3 }],
        referrers: [],
      },
    })
  })
})

describe('写请求(form-encoded,更新也走 POST)', () => {
  it('create_site 发 form body,省略的可选字段不出现', async () => {
    const mock = mockFathom(200, { id: 'CDBUGS', object: 'site', name: 'Docs' })
    await call('create_site', { name: 'Docs', sharing: 'private', share_password: 'hunter2' })

    const request = sent(mock)
    expect(request.url).toBe('https://api.usefathom.com/v1/sites')
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded')
    const body = new URLSearchParams(await request.text())
    expect(body.get('name')).toBe('Docs')
    expect(body.get('sharing')).toBe('private')
    expect(body.get('share_password')).toBe('hunter2')
    expect(body.has('timezone')).toBe(false)
  })

  it('update_milestone 走 POST,路径参数不重复出现在 body 里', async () => {
    const mock = mockFathom(200, { id: 'm_1', object: 'milestone', name: 'Launch' })
    await call('update_milestone', {
      site_id: 'CDBUGS',
      milestone_id: 'm_1',
      name: 'Launch',
      milestone_date: '2024-01-15',
    })

    const request = sent(mock)
    expect(request.url).toBe('https://api.usefathom.com/v1/sites/CDBUGS/milestones/m_1')
    expect(request.method).toBe('POST')
    const body = new URLSearchParams(await request.text())
    expect([...body.keys()].sort()).toEqual(['milestone_date', 'name'])
    expect(body.get('name')).toBe('Launch')
    expect(body.get('milestone_date')).toBe('2024-01-15')
  })

  it('create_event 只发 name(site_id 是路径参数)', async () => {
    const mock = mockFathom(200, { id: 'signed-up', object: 'event' })
    await call('create_event', { site_id: 'CDBUGS', name: 'Signed up' })

    const request = sent(mock)
    expect(request.url).toBe('https://api.usefathom.com/v1/sites/CDBUGS/events')
    const body = new URLSearchParams(await request.text())
    expect([...body.keys()]).toEqual(['name'])
  })
})

describe('聚合报表', () => {
  it('数组参数压成逗号分隔串,filters 单独 JSON 编码', async () => {
    const mock = mockFathom(200, [{ visits: 10, pathname: '/' }])
    const res = await call('run_aggregation', {
      entity: 'pageview',
      entity_id: 'CDBUGS',
      aggregates: ['visits', 'uniques'],
      field_grouping: ['pathname', 'browser'],
      date_grouping: 'day',
      filters: [{ property: 'pathname', operator: 'is', value: '/pricing' }],
    })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v1/aggregations')
    expect(url.searchParams.get('entity')).toBe('pageview')
    expect(url.searchParams.get('entity_id')).toBe('CDBUGS')
    expect(url.searchParams.get('aggregates')).toBe('visits,uniques')
    expect(url.searchParams.get('field_grouping')).toBe('pathname,browser')
    expect(url.searchParams.get('date_grouping')).toBe('day')
    expect(url.searchParams.get('filters')).toBe(
      JSON.stringify([{ property: 'pathname', operator: 'is', value: '/pricing' }]),
    )
    await expect(res.json()).resolves.toEqual({ content: [{ visits: 10, pathname: '/' }] })
  })

  it('entity=pageview 缺 entity_id → 400 且不打上游', async () => {
    const mock = mockFathom(200, [])
    const res = await call('run_aggregation', { entity: 'pageview', aggregates: ['visits'] })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('entity_id')
    expect(mock).not.toHaveBeenCalled()
  })

  it('entity=event 缺 site_id / entity_name → 400 且不打上游', async () => {
    const mock = mockFathom(200, [])
    const noSite = await call('run_aggregation', {
      entity: 'event',
      entity_name: 'Signed up',
      aggregates: ['conversions'],
    })
    expect(noSite.status).toBe(400)
    expect(((await noSite.json()) as { message: string }).message).toContain('site_id')

    const noName = await call('run_aggregation', {
      entity: 'event',
      site_id: 'CDBUGS',
      aggregates: ['conversions'],
    })
    expect(noName.status).toBe(400)
    expect(((await noName.json()) as { message: string }).message).toContain('entity_name')
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:limit 超上限 → 400 且不打上游', async () => {
    const mock = mockFathom(200, {})
    const res = await call('list_sites', { limit: 500 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('未声明的字段被 strictObject 挡下 → 400 且不打上游', async () => {
    const mock = mockFathom(200, {})
    const res = await call('get_site', { site_id: 'CDBUGS', page: 2 })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('分页游标互斥在本地就挡下(schema 表达不了这条)', async () => {
    const mock = mockFathom(200, {})
    const res = await call('list_events', {
      site_id: 'CDBUGS',
      starting_after: 'e_1',
      ending_before: 'e_9',
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('starting_after')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 Fathom 的 error 字段', async () => {
    mockFathom(401, { error: 'Unauthenticated.' })
    const unauthorized = await call('list_sites', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Unauthenticated.',
    })

    mockFathom(404, { error: 'Site not found.' })
    await expect((await call('get_site', { site_id: 'nope' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'Site not found.' })

    mockFathom(429, { error: 'Too many requests.' })
    const limited = await call('list_sites', {})
    expect(limited.status).toBe(429)
    await expect(limited.json())
      .resolves.toMatchObject({ code: 'rate_limited', message: 'Too many requests.', retryable: true })

    mockFathom(500, { error: 'Fathom is down.' })
    await expect((await call('list_sites', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('错误体不是 JSON 时状态码仍然归一,不被 502 顶掉', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>rate limited</html>', {
      status: 429,
      statusText: 'Too Many Requests',
      headers: { 'content-type': 'text/html' },
    }))))
    const res = await call('list_sites', {})
    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('成功响应体为空 → unavailable(上游说成功却没给内容)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 200 }))))
    const res = await call('get_account', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockFathom(200, {})
    const res = await call('list_sites', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
