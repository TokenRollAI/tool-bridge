import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAimfoxPlugin } from '../../src/aimfox/index'
import { aimfoxActions } from '../../src/aimfox/schema'

/**
 * Aimfox 迁移产物的 wire 级验收。重点在 lead 检索的 body/query 分层、
 * account_ids 的 JSON 字符串编码、区间倒置的本地拦截,以及响应关键字段的严格校验。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'aimfox_test_key'
const plugin = createAimfoxPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'outreach/aimfox',
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

function mockAimfox(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 11 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(aimfoxActions).length)
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
    expect(effectOf('list_campaigns')).toBe('read')
    expect(effectOf('add_profile_to_campaign')).toBe('write')
    expect(effectOf('remove_profile_from_campaign')).toBe('destructive')
  })
})

describe('campaigns', () => {
  it('凭证走 Bearer,筛选进 query,status 原样透出', async () => {
    const mock = mockAimfox(200, { status: 'ok', campaigns: [{ id: 'c1' }] })
    const res = await call('list_campaigns', { outreach_type: 'outbound', accepts_profiles: true })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    const url = new URL(request.url)
    expect(url.origin).toBe('https://api.aimfox.com')
    expect(url.pathname).toBe('/api/v2/campaigns')
    expect(url.searchParams.get('outreach_type')).toBe('outbound')
    expect(url.searchParams.get('accepts_profiles')).toBe('true')

    await expect(res.json()).resolves.toEqual({
      content: { status: 'ok', campaigns: [{ id: 'c1' }] },
    })
  })

  it('campaign_id 编码进路径', async () => {
    const mock = mockAimfox(200, { campaign: { id: 'c/1' } })
    const res = await call('get_campaign', { campaign_id: 'c/1' })
    expect(new URL(sent(mock).url).pathname).toBe('/api/v2/campaigns/c%2F1')
    // status 缺失时补 null,不省略。
    await expect(res.json()).resolves.toEqual({ content: { status: null, campaign: { id: 'c/1' } } })
  })

  it('add_profile_to_campaign 发 JSON 体', async () => {
    const mock = mockAimfox(200, { status: 'queued' })
    await call('add_profile_to_campaign', {
      campaign_id: 'c1',
      profile_url: 'https://www.linkedin.com/in/ada',
    })
    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/api/v2/campaigns/c1/audience')
    await expect(request.json()).resolves.toEqual({ profile_url: 'https://www.linkedin.com/in/ada' })
  })

  it('remove_profile_from_campaign 用 DELETE,urn 编码进路径', async () => {
    const mock = mockAimfox(200, { status: 'removed' })
    await call('remove_profile_from_campaign', { campaign_id: 'c1', urn: 'urn:li:person:1' })
    const request = sent(mock)
    expect(request.method).toBe('DELETE')
    expect(new URL(request.url).pathname).toBe('/api/v2/campaigns/c1/audience/urn%3Ali%3Aperson%3A1')
  })
})

describe('leads 与 analytics', () => {
  it('search_leads 的 facet 进 body、分页进 query', async () => {
    const mock = mockAimfox(200, { status: 'ok', leads: [{ id: 'l1' }] })
    await call('search_leads', {
      keywords: 'engineer',
      locations: ['us'],
      optimize: true,
      start: 20,
      count: 10,
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.pathname).toBe('/api/v2/leads:search')
    expect(url.searchParams.get('start')).toBe('20')
    expect(url.searchParams.get('count')).toBe('10')
    // start/count 不进 body。
    await expect(request.json()).resolves.toEqual({
      keywords: 'engineer',
      locations: ['us'],
      optimize: true,
    })
  })

  it('get_total_leads_count 断言 total_leads 与 sync 的类型', async () => {
    mockAimfox(200, { status: 'ok', total_leads: 42, sync: true, accounts_sync: { a1: true } })
    const res = await call('get_total_leads_count', { keywords: 'engineer' })
    await expect(res.json()).resolves.toEqual({
      content: { status: 'ok', total_leads: 42, sync: true, accounts_sync: { a1: true } },
    })
  })

  it('list_interactions 把 account_ids 编成 JSON 字符串', async () => {
    const mock = mockAimfox(200, { count: 2, buckets: [{ t: 1 }, { t: 2 }] })
    await call('list_interactions', {
      bucket: '1 day',
      from: 1700000000000,
      to: 1700086400000,
      account_ids: ['a1', 'a2'],
    })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/v2/analytics/interactions')
    expect(url.searchParams.get('bucket')).toBe('1 day')
    expect(url.searchParams.get('account_ids')).toBe('["a1","a2"]')
  })

  it('list_workspace_labels 与 list_recent_leads 是零参调用', async () => {
    const labels = mockAimfox(200, { labels: [{ id: 'lb1' }] })
    await expect((await call('list_workspace_labels', {})).json())
      .resolves.toEqual({ content: { status: null, labels: [{ id: 'lb1' }] } })
    expect(new URL(sent(labels).url).pathname).toBe('/api/v2/labels')

    vi.unstubAllGlobals()
    const recent = mockAimfox(200, { leads: [] })
    await call('list_recent_leads', {})
    expect(new URL(sent(recent).url).pathname).toBe('/api/v2/analytics/recent-leads')
  })
})

describe('校验与错误', () => {
  it('入参校验生效:profile_url 不是 URL → 400 且不打上游', async () => {
    const mock = mockAimfox(200, {})
    const res = await call('add_profile_to_campaign', { campaign_id: 'c1', profile_url: 'not-a-url' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('from > to 在本地就挡下(上游对倒置区间只回空桶)', async () => {
    const mock = mockAimfox(200, {})
    const res = await call('list_interactions', { bucket: '1 hour', from: 200, to: 100 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('from must be earlier')
    expect(mock).not.toHaveBeenCalled()
  })

  it('响应缺 campaigns → 上游故障', async () => {
    mockAimfox(200, { status: 'ok' })
    await expect((await call('list_campaigns', {})).json())
      .resolves.toMatchObject({ code: 'unavailable' })
  })

  it('上游错误按状态归一,消息优先取 error.message', async () => {
    mockAimfox(401, { error: { message: 'Invalid API key' } })
    await expect((await call('list_campaigns', {})).json())
      .resolves.toMatchObject({ code: 'permission_denied', message: 'Invalid API key' })

    mockAimfox(429, { message: 'Too many requests' })
    await expect((await call('list_campaigns', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true, message: 'Too many requests' })

    mockAimfox(404, { error: { message: 'No such campaign' } })
    await expect((await call('get_campaign', { campaign_id: 'nope' })).json())
      .resolves.toMatchObject({ code: 'not_found' })
  })

  it('没配 authRef → 503 且不打上游', async () => {
    const mock = mockAimfox(200, {})
    const res = await call('list_campaigns', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
