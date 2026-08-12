import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRootlyPlugin } from '../../src/rootly/index'
import { rootlyActions } from '../../src/rootly/schema'

/**
 * Rootly 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * JSON:API 的 `filter[...]` / `page[...]` 方括号参数名、include 的逗号拼接、
 * 单资源与列表元素共用同一套剥壳、sidecar(included/links/meta)有才带出。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'rootly_test_key'
const plugin = createRootlyPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'oncall/rootly',
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

function mockRootly(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/vnd.api+json' },
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
  it('List 出全部 5 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(rootlyActions).length)
    expect(tools).toHaveLength(5)
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

describe('JSON:API 查询参数', () => {
  it('list_incidents:filter/page 方括号参数名原样保留,布尔与数字字符串化', async () => {
    const mock = mockRootly(200, {
      data: [{ id: 'inc-1', type: 'incidents', attributes: { title: 'DB down' } }],
      meta: { total_count: 1 },
      links: { next: '/v1/incidents?page[number]=2' },
    })
    const res = await call('list_incidents', {
      pageAfter: 'cur-1',
      pageNumber: 2,
      pageSize: 50,
      search: 'db',
      private: false,
      userId: 7,
      createdAtGte: '2024-01-01T00:00:00Z',
      sort: '-created_at',
    })

    const request = sent(mock)
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('accept')).toBe('application/vnd.api+json')
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.rootly.com/v1/incidents')
    expect(url.searchParams.get('page[after]')).toBe('cur-1')
    expect(url.searchParams.get('page[number]')).toBe('2')
    expect(url.searchParams.get('page[size]')).toBe('50')
    expect(url.searchParams.get('filter[search]')).toBe('db')
    // false 是有意义的过滤值,不能被"空值跳过"吞掉。
    expect(url.searchParams.get('filter[private]')).toBe('false')
    expect(url.searchParams.get('filter[user_id]')).toBe('7')
    expect(url.searchParams.get('filter[created_at][gte]')).toBe('2024-01-01T00:00:00Z')
    expect(url.searchParams.get('sort')).toBe('-created_at')

    await expect(res.json()).resolves.toMatchObject({
      content: {
        resources: [{ id: 'inc-1', type: 'incidents', attributes: { title: 'DB down' }, relationships: {} }],
        meta: { total_count: 1 },
        links: { next: '/v1/incidents?page[number]=2' },
      },
    })
  })

  it('get_incident:include 逗号拼接,单资源从 data 里剥出来', async () => {
    const mock = mockRootly(200, {
      data: { id: 'inc-1', type: 'incidents', attributes: { title: 'DB down' } },
      included: [{ id: 'svc-1', type: 'services' }],
    })
    const res = await call('get_incident', { id: 'inc/1', include: ['services', 'environments'] })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v1/incidents/inc%2F1')
    expect(url.searchParams.get('include')).toBe('services,environments')

    await expect(res.json()).resolves.toMatchObject({
      content: {
        resource: { id: 'inc-1', type: 'incidents', relationships: {} },
        included: [{ id: 'svc-1', type: 'services' }],
      },
    })
  })

  it('list_teams 认 color 过滤器,list_services 不认(上游就这么分的)', async () => {
    const teamsMock = mockRootly(200, { data: [] })
    await call('list_teams', { color: '#ff0000', name: 'sre' })
    const teamsUrl = new URL(sent(teamsMock).url)
    expect(teamsUrl.pathname).toBe('/v1/teams')
    expect(teamsUrl.searchParams.get('filter[color]')).toBe('#ff0000')
    expect(teamsUrl.searchParams.get('filter[name]')).toBe('sre')

    vi.unstubAllGlobals()
    const servicesMock = mockRootly(200, { data: [] })
    // list_services 的 schema 里没有 color,给了会被 strictObject 挡下。
    const rejected = await call('list_services', { color: '#ff0000' })
    expect(rejected.status).toBe(400)
    expect(servicesMock).not.toHaveBeenCalled()
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:pageSize 给 0 → 400 且不打上游', async () => {
    const mock = mockRootly(200, {})
    const res = await call('list_incidents', { pageSize: 0 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('缺必填 id → 400 且不打上游', async () => {
    const mock = mockRootly(200, {})
    const res = await call('get_incident', {})
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 JSON:API 的 errors[0].detail', async () => {
    mockRootly(401, { errors: [{ detail: 'Invalid API key', title: 'Unauthorized' }] })
    const denied = await call('get_current_user', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    // 上游把 404 压成 400;共用映射保住 not_found 语义。
    mockRootly(404, { errors: [{ title: 'Not Found' }] })
    await expect((await call('get_incident', { id: 'nope' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'Not Found' })

    mockRootly(429, { errors: [{ detail: 'Too many requests' }] })
    await expect((await call('list_incidents', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockRootly(500, { errors: [{ detail: 'Rootly is down' }] })
    await expect((await call('list_incidents', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('列表响应少了 data 数组归到 unavailable,而不是赖到调用方头上', async () => {
    mockRootly(200, { meta: {} })
    await expect((await call('list_services', {})).json())
      .resolves.toMatchObject({ code: 'unavailable' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockRootly(200, {})
    const res = await call('get_current_user', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
