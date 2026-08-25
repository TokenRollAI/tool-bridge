import { describe, expect, it } from 'vitest'
import { createProviderHarness } from '../support/providerHarness'
import { createLemlistPlugin } from '../../src/lemlist/index'
import { lemlistActions } from '../../src/lemlist/schema'

/**
 * lemlist 迁移产物的 wire 级验收。重点在凭证形式(HTTP Basic、空用户名)、固定的
 * `version=v2` 参数,以及 leads 端点末尾那个不能省的斜杠。
 */

const API_KEY = 'lem_deadbeef'
const plugin = createLemlistPlugin()

const {
  call,
  envelope,
  sent,
  mockJson: mockLemlist,
} = createProviderHarness({
  mountPath: 'outreach/lemlist',
  plugin,
  upstreamAuth: API_KEY,
})

describe('契约面', () => {
  it('List 出全部 4 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(lemlistActions).length)
    expect(tools).toHaveLength(4)
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

describe('请求构造', () => {
  it('凭证走 HTTP Basic,用户名留空', async () => {
    const mock = mockLemlist(200, { _id: 'team_1', name: 'Acme' })
    const res = await call('get_team', {})

    const request = sent(mock)
    expect(request.url).toBe('https://api.lemlist.com/api/team')
    expect(request.headers.get('authorization')).toBe(`Basic ${btoa(`:${API_KEY}`)}`)
    expect(request.headers.get('user-agent')).toBeNull()
    await expect(res.json()).resolves.toMatchObject({
      content: { team: { _id: 'team_1', name: 'Acme' } },
    })
  })

  it('list_campaigns 固定带 version=v2,省略的可选参数不进 query', async () => {
    const mock = mockLemlist(200, [{ _id: 'c1', name: 'Q1', status: 'running' }])
    const res = await call('list_campaigns', { limit: 50, status: 'running' })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/campaigns')
    expect(url.searchParams.get('version')).toBe('v2')
    expect(url.searchParams.get('limit')).toBe('50')
    expect(url.searchParams.get('status')).toBe('running')
    expect(url.searchParams.has('offset')).toBe(false)
    expect(url.searchParams.has('sortBy')).toBe(false)
    await expect(res.json()).resolves.toMatchObject({
      content: { campaigns: [{ _id: 'c1', name: 'Q1', status: 'running' }] },
    })
  })

  it('leads 端点保留末尾斜杠,路径参数被 URL 编码', async () => {
    const mock = mockLemlist(200, [{ _id: 'l1', state: 'contacted' }])
    const res = await call('list_campaign_leads', { campaignId: 'a/b', state: 'contacted', limit: 10 })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/campaigns/a%2Fb/leads/')
    expect(url.searchParams.get('state')).toBe('contacted')
    await expect(res.json()).resolves.toMatchObject({
      content: { leads: [{ _id: 'l1', state: 'contacted' }] },
    })
  })
})

describe('校验与错误', () => {
  it('get_campaign 缺 campaignId → 400 且不打上游(schema 里它是 optional,靠手写校验挡)', async () => {
    const mock = mockLemlist(200, {})
    const res = await call('get_campaign', {})
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'campaignId is required',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('入参校验生效:limit 超过 100 → 400 且不打上游', async () => {
    const mock = mockLemlist(200, {})
    const res = await call('list_campaigns', { limit: 1000 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('列表端点回非数组 → unavailable(上游违约)', async () => {
    mockLemlist(200, { campaigns: [] })
    await expect((await call('list_campaigns', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('上游错误按状态归一', async () => {
    mockLemlist(401, { message: 'Invalid API key' })
    const unauth = await call('get_team', {})
    expect(unauth.status).toBe(401)
    await expect(unauth.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    mockLemlist(429, { error: 'Rate limit reached' })
    await expect((await call('get_team', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockLemlist(404, { reason: 'campaign not found' })
    await expect((await call('get_campaign', { campaignId: 'nope' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'campaign not found' })

    // 上游把 5xx 压成 502;迁移后 500 直接归一成 unavailable。
    mockLemlist(500, { message: 'boom' })
    await expect((await call('get_team', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockLemlist(200, {})
    const res = await call('get_team', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
