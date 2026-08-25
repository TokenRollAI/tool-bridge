import { describe, expect, it } from 'vitest'
import { createProviderHarness } from '../support/providerHarness'
import { createShodanPlugin } from '../../src/shodan/index'
import { shodanActions } from '../../src/shodan/schema'

/**
 * Shodan 迁移产物的 wire 级验收。重点在:凭证走 `key` query 参数、DNS 端点的逗号分隔串、
 * 响应结构收窄(只透出声明过的字段)、上游契约破损归 502 而非 400。
 */

const API_KEY = 'shodan_test_key'
const plugin = createShodanPlugin()

const {
  call,
  envelope,
  sent,
  mockJson: mockShodan,
} = createProviderHarness({
  mountPath: 'security/shodan',
  plugin,
  upstreamAuth: API_KEY,
})

const API_INFO = {
  plan: 'dev',
  https: true,
  monitored_ips: 0,
  query_credits: 100,
  scan_credits: 10,
  telnet: false,
  unlocked: true,
  usage_limits: { scan_credits: 100 },
}

describe('契约面', () => {
  it('List 出全部 7 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(shodanActions).length)
    expect(tools).toHaveLength(7)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求形状', () => {
  it('search_hosts:凭证走 key query,过滤器同在 query,响应被收窄', async () => {
    const mock = mockShodan(200, {
      matches: [{ ip_str: '1.2.3.4' }],
      total: 42,
      facets: { org: [] },
      // 上游未声明的字段应被收窄掉,不透出给调用方。
      undocumented: 'drop me',
    })
    const res = await call('search_hosts', { query: 'apache', facets: 'org:5', page: 2, minify: true })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin).toBe('https://api.shodan.io')
    expect(url.pathname).toBe('/shodan/host/search')
    expect(url.searchParams.get('key')).toBe(API_KEY)
    expect(url.searchParams.get('query')).toBe('apache')
    expect(url.searchParams.get('facets')).toBe('org:5')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('minify')).toBe('true')
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBeNull()

    await expect(res.json()).resolves.toEqual({
      content: { matches: [{ ip_str: '1.2.3.4' }], total: 42, facets: { org: [] } },
    })
  })

  it('resolve_hostnames:数组压成逗号分隔串,null 结果被剔除', async () => {
    const mock = mockShodan(200, { 'example.com': '93.184.216.34', 'missing.test': null })
    const res = await call('resolve_hostnames', { hostnames: ['example.com', 'missing.test'] })

    expect(new URL(sent(mock).url).searchParams.get('hostnames')).toBe('example.com,missing.test')
    await expect(res.json()).resolves.toEqual({
      content: { results: { 'example.com': '93.184.216.34' } },
    })
  })

  it('get_host:IP 进路径', async () => {
    const mock = mockShodan(200, { ip_str: '1.2.3.4', ports: [80] })
    const res = await call('get_host', { ip: '1.2.3.4', history: false })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/shodan/host/1.2.3.4')
    expect(url.searchParams.get('history')).toBe('false')
    await expect(res.json()).resolves.toEqual({ content: { host: { ip_str: '1.2.3.4', ports: [80] } } })
  })
})

describe('校验与错误', () => {
  it('入参校验生效:search_hosts 缺 query → 400 且不打上游', async () => {
    const mock = mockShodan(200, API_INFO)
    const res = await call('search_hosts', { page: 1 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('hostnames 成员含逗号 → 400 且不打上游(否则会把一项拆成两项)', async () => {
    const mock = mockShodan(200, {})
    const res = await call('resolve_hostnames', { hostnames: ['a.com,b.com'] })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('commas')
    expect(mock).not.toHaveBeenCalled()
  })

  it('响应缺必填字段 → 502(上游契约破了,不该报成调用方的入参错误)', async () => {
    mockShodan(200, { matches: [], facets: {} })
    const res = await call('search_hosts', { query: 'apache' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('上游错误按状态归一,消息取自 error 字段', async () => {
    mockShodan(401, { error: 'Invalid API key' })
    const denied = await call('get_api_info', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    mockShodan(429, { error: 'Rate limit exceeded' })
    await expect((await call('get_api_info', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', message: 'Rate limit exceeded', retryable: true })

    mockShodan(404, { error: 'No information available' })
    await expect((await call('get_host', { ip: '1.2.3.4' })).json())
      .resolves.toMatchObject({ code: 'not_found' })
  })

  it('没配 authRef → 503 且不打上游', async () => {
    const mock = mockShodan(200, API_INFO)
    const res = await call('get_api_info', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
