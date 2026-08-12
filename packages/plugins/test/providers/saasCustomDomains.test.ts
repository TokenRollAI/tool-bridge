import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSaasCustomDomainsPlugin } from '../../src/saas_custom_domains/index'
import { saasCustomDomainsActions } from '../../src/saas_custom_domains/schema'

/**
 * SaaS Custom Domains 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 三级嵌套的路径拼接、form-urlencoded 请求体、list 的 `{data,pagination}` 形状检查、
 * 以及 schema 标 optional 但上游必填的 `*_uuid`。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'scd_test_token'
const plugin = createSaasCustomDomainsPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'infra/saas-custom-domains',
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

function mockScd(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 11 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(saasCustomDomainsActions).length)
    expect(tools).toHaveLength(11)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('list_accounts')).toBe('read')
    expect(effectOf('get_upstream')).toBe('read')
    expect(effectOf('create_upstream')).toBe('write')
    expect(effectOf('delete_custom_domain')).toBe('destructive')
  })
})

describe('路径与请求体', () => {
  it('list_accounts:数组响应直接归一,凭证走 Bearer', async () => {
    const mock = mockScd(200, [{ uuid: 'acc-1', name: 'Acme' }])
    const res = await call('list_accounts', {})

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.url).toBe('https://app.saascustomdomains.com/api/v1/accounts')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    await expect(res.json()).resolves.toMatchObject({
      content: { accounts: [{ uuid: 'acc-1', name: 'Acme' }] },
    })
  })

  it('create_custom_domain:三级路径 + form-urlencoded 体,路径参数不混进 body', async () => {
    const mock = mockScd(200, { uuid: 'dom-1', host: 'shop.acme.test' })
    await call('create_custom_domain', {
      account_uuid: 'acc/1',
      upstream_uuid: 'up-1',
      host: 'shop.acme.test',
      challenge_type: 'dns01',
      redirect_to_www: false,
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.url)
      .toBe('https://app.saascustomdomains.com/api/v1/accounts/acc%2F1/upstreams/up-1/custom_domains')
    expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded;charset=UTF-8')

    const body = new URLSearchParams(await request.text())
    expect(body.get('host')).toBe('shop.acme.test')
    expect(body.get('challenge_type')).toBe('dns01')
    // 布尔 false 要真的发出去,不能被"空值跳过"吞掉。
    expect(body.get('redirect_to_www')).toBe('false')
    expect(body.has('account_uuid')).toBe(false)
    expect(body.has('prepend_path')).toBe(false)
  })

  it('list_custom_domains:分页参数进 query,{data,pagination} 归一', async () => {
    const mock = mockScd(200, {
      data: [{ uuid: 'dom-1' }],
      pagination: { current_page: 2, total_pages: 5 },
    })
    const res = await call('list_custom_domains', {
      account_uuid: 'acc-1',
      upstream_uuid: 'up-1',
      host: 'shop.acme.test',
      page: 2,
      per_page: 20,
    })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/v1/accounts/acc-1/upstreams/up-1/custom_domains')
    expect(url.searchParams.get('host')).toBe('shop.acme.test')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('per_page')).toBe('20')

    await expect(res.json()).resolves.toMatchObject({
      content: {
        custom_domains: [{ uuid: 'dom-1' }],
        pagination: { current_page: 2, total_pages: 5 },
      },
    })
  })

  it('verify_custom_domain_dns_records:POST 到子路径,三个字段都归一出来', async () => {
    const mock = mockScd(200, { message: 'Verified', dns_status: 'ok', host: 'shop.acme.test' })
    const res = await call('verify_custom_domain_dns_records', {
      account_uuid: 'acc-1',
      upstream_uuid: 'up-1',
      domain_uuid: 'dom-1',
    })
    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname)
      .toBe('/api/v1/accounts/acc-1/upstreams/up-1/custom_domains/dom-1/verify_dns_records')
    await expect(res.json()).resolves.toEqual({
      content: { message: 'Verified', dns_status: 'ok', host: 'shop.acme.test' },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:page 给 0 → 400 且不打上游', async () => {
    const mock = mockScd(200, {})
    const res = await call('list_upstreams', { account_uuid: 'acc-1', page: 0 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('schema 标 optional 但上游必填的 upstream_uuid 缺失 → 400 且不打上游', async () => {
    const mock = mockScd(200, {})
    const res = await call('get_upstream', { account_uuid: 'acc-1' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('upstream_uuid')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 error 或 message', async () => {
    mockScd(401, { error: 'Invalid API token' })
    const denied = await call('list_accounts', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API token',
    })

    mockScd(404, { message: 'Upstream not found' })
    await expect((await call('get_upstream', { account_uuid: 'a', upstream_uuid: 'u' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'Upstream not found' })

    mockScd(429, { error: 'Rate limited' })
    await expect((await call('list_accounts', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockScd(500, { error: 'Boom' })
    await expect((await call('list_accounts', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('响应形状不对归到 unavailable,而不是赖到调用方头上', async () => {
    mockScd(200, { accounts: [] })
    await expect((await call('list_accounts', {})).json())
      .resolves.toMatchObject({ code: 'unavailable' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockScd(200, [])
    const res = await call('list_accounts', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
