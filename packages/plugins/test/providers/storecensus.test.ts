import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStorecensusPlugin } from '../../src/storecensus/index'
import { storecensusActions } from '../../src/storecensus/schema'

/**
 * StoreCensus 迁移产物的 wire 级验收。重点在 base URL 的 `/api/v1` 前缀不被冲掉、
 * sections 的逗号拼接、POST 体的字段筛选,以及响应形状不符时归成上游故障。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'sc_test_key'
const plugin = createStorecensusPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'data/storecensus',
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

function mockStorecensus(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 4 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(storecensusActions).length)
    expect(tools).toHaveLength(4)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('get_website', () => {
  it('domain 编码进路径,/api/v1 前缀保住,sections 逗号拼接', async () => {
    const mock = mockStorecensus(200, { basic_info: { domain: 'a/b.com' } })
    const res = await call('get_website', {
      domain: 'a/b.com',
      sections: ['basic_info', 'crm'],
    })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    const url = new URL(request.url)
    expect(url.pathname).toBe('/api/v1/website/a%2Fb.com')
    expect(url.searchParams.get('sections')).toBe('basic_info,crm')

    await expect(res.json()).resolves.toEqual({
      content: { website: { basic_info: { domain: 'a/b.com' } } },
    })
  })

  it('省略 sections 时不带该参数', async () => {
    const mock = mockStorecensus(200, {})
    await call('get_website', { domain: 'shop.example' })
    expect(new URL(sent(mock).url).searchParams.has('sections')).toBe(false)
  })
})

describe('search_stores 与 list_apps', () => {
  it('search_stores 发 JSON 体,只带显式给出的字段', async () => {
    const mock = mockStorecensus(200, {
      data: [{ basic_info: { domain: 'x.com' } }],
      pagination: { hasMore: true, nextCursor: 'c2' },
      filters: { country: 'US' },
      sort: { column: 'estimatedVisits', direction: 'desc' },
      sections: ['basic_info'],
    })
    const res = await call('search_stores', {
      filters: { country: 'US' },
      sort: { column: 'estimatedVisits', direction: 'desc' },
      pageSize: 50,
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/api/v1/stores')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      filters: { country: 'US' },
      sort: { column: 'estimatedVisits', direction: 'desc' },
      pageSize: 50,
    })

    await expect(res.json()).resolves.toMatchObject({
      content: {
        stores: [{ basic_info: { domain: 'x.com' } }],
        pagination: { hasMore: true, nextCursor: 'c2' },
        sections: ['basic_info'],
      },
    })
  })

  it('search_stores 无入参时仍发 {} 而非空体', async () => {
    const mock = mockStorecensus(200, { data: [], pagination: {} })
    await call('search_stores', {})
    await expect(sent(mock).json()).resolves.toEqual({})
  })

  it('list_apps 的分页与筛选进 query', async () => {
    const mock = mockStorecensus(200, { data: [{ app_id: 1 }], pagination: { page: 2 } })
    const res = await call('list_apps', { page: 2, pageSize: 50, minRating: 4.5, search: 'seo' })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/v1/apps')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('pageSize')).toBe('50')
    expect(url.searchParams.get('minRating')).toBe('4.5')
    expect(url.searchParams.get('search')).toBe('seo')
    expect(url.searchParams.has('categoryId')).toBe(false)
    await expect(res.json()).resolves.toEqual({
      content: { apps: [{ app_id: 1 }], pagination: { page: 2 }, filters: {} },
    })
  })

  it('list_app_categories 的 total 缺失时用数组长度兜底', async () => {
    const mock = mockStorecensus(200, { data: [{ category_id: 1 }, { category_id: 2 }] })
    const res = await call('list_app_categories', {})
    expect(new URL(sent(mock).url).pathname).toBe('/api/v1/app-categories')
    await expect(res.json()).resolves.toEqual({
      content: { categories: [{ category_id: 1 }, { category_id: 2 }], total: 2 },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验生效:domain 为空串 → 400 且不打上游', async () => {
    const mock = mockStorecensus(200, {})
    const res = await call('get_website', { domain: '' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('list_apps 的 minRating 超界 → 400 且不打上游', async () => {
    const mock = mockStorecensus(200, {})
    const res = await call('list_apps', { minRating: 9 })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('响应缺 pagination → 上游故障', async () => {
    mockStorecensus(200, { data: [] })
    await expect((await call('list_apps', {})).json())
      .resolves.toMatchObject({ code: 'unavailable' })
  })

  it('上游错误按状态归一,消息取自 error 字段', async () => {
    mockStorecensus(401, { error: 'Invalid API key' })
    await expect((await call('list_app_categories', {})).json())
      .resolves.toMatchObject({ code: 'permission_denied', message: 'Invalid API key' })

    mockStorecensus(429, { message: 'Too many requests' })
    await expect((await call('list_app_categories', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockStorecensus(500, { detail: 'boom' })
    await expect((await call('list_app_categories', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → 503 且不打上游', async () => {
    const mock = mockStorecensus(200, {})
    const res = await call('list_app_categories', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
