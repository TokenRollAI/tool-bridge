import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStoreLeadsPlugin } from '../../src/store_leads/index'
import { storeLeadsActions } from '../../src/store_leads/schema'

/**
 * Store Leads 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * `f:` 前缀的过滤器参数名、零基 page 的 0 必须发出去、next_cursor 缺失时补 null。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'sl_test_key'
const plugin = createStoreLeadsPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'data/store-leads',
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

function mockStoreLeads(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 6 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(storeLeadsActions).length)
    expect(tools).toHaveLength(6)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('全部 action 都是只读', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    for (const tool of tools) expect(tool.effect, tool.name).toBe('read')
  })
})

describe('查询参数编码', () => {
  it('list_apps:platform/categories 走 f: 前缀的参数名,零基 page 的 0 要发出去', async () => {
    const mock = mockStoreLeads(200, { apps: [{ id: 'shopify.marsello', name: 'Marsello' }] })
    const res = await call('list_apps', {
      page: 0,
      page_size: 50,
      sort: '-installs',
      platform: 'shopify',
      categories: 'marketing,email',
    })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://storeleads.app/json/api/v1/all/app')
    // 零基分页:page=0 是第一页,不能被"空值跳过"吞掉。
    expect(url.searchParams.get('page')).toBe('0')
    expect(url.searchParams.get('page_size')).toBe('50')
    expect(url.searchParams.get('sort')).toBe('-installs')
    expect(url.searchParams.get('f:p')).toBe('shopify')
    expect(url.searchParams.get('f:categories')).toBe('marketing,email')
    expect(url.searchParams.has('platform')).toBe(false)

    await expect(res.json()).resolves.toMatchObject({
      content: { apps: [{ id: 'shopify.marsello', name: 'Marsello' }] },
    })
  })

  it('get_domain:路径参数被编码,布尔参数字符串化', async () => {
    const mock = mockStoreLeads(200, { domain: { name: 'shop.example', platform: 'shopify' } })
    const res = await call('get_domain', {
      domain: 'shop.example/x',
      follow_redirects: true,
      fields: 'name,platform',
    })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/json/api/v1/all/domain/shop.example%2Fx')
    expect(url.searchParams.get('follow_redirects')).toBe('true')
    expect(url.searchParams.get('fields')).toBe('name,platform')

    await expect(res.json()).resolves.toEqual({
      content: { domain: { name: 'shop.example', platform: 'shopify' } },
    })
  })

  it('list_domains:上游没给 next_cursor 时补 null', async () => {
    mockStoreLeads(200, { domains: [{ name: 'a.test' }] })
    await expect((await call('list_domains', { aq: 'platform:shopify' })).json())
      .resolves.toMatchObject({ content: { domains: [{ name: 'a.test' }], next_cursor: null } })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:page_size 超上限 → 400 且不打上游', async () => {
    const mock = mockStoreLeads(200, {})
    const res = await call('list_domains', { page_size: 100 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('缺必填 app_id → 400 且不打上游', async () => {
    const mock = mockStoreLeads(200, {})
    const res = await call('get_app', { fields: 'name' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 message/error/detail', async () => {
    mockStoreLeads(401, { message: 'Invalid API key' })
    const denied = await call('list_apps', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    mockStoreLeads(404, { error: 'Domain not found' })
    await expect((await call('get_domain', { domain: 'nope.test' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'Domain not found' })

    mockStoreLeads(429, { detail: 'Rate limited' })
    await expect((await call('list_apps', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockStoreLeads(500, { message: 'Store Leads is down' })
    await expect((await call('list_apps', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('响应缺了预期字段归到 unavailable,而不是赖到调用方头上', async () => {
    mockStoreLeads(200, { apps: 'not-an-array' })
    await expect((await call('list_apps', {})).json())
      .resolves.toMatchObject({ code: 'unavailable' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockStoreLeads(200, {})
    const res = await call('list_apps', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
