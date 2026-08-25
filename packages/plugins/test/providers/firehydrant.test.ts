import { describe, expect, it, vi } from 'vitest'
import { createFirehydrantPlugin } from '../../src/firehydrant/index'
import { createProviderHarness } from '../support/providerHarness'
import { firehydrantActions } from '../../src/firehydrant/schema'

/**
 * FireHydrant 迁移产物的 wire 级验收。重点在两种响应形状(list 的 data/pagination 信封
 * 与单条裸对象)、camelCase → snake_case 的筛选与请求体映射。
 */

const API_KEY = 'fhb_test_key'
const plugin = createFirehydrantPlugin()

const {
  call,
  envelope,
  sent,
  mockJson: mockFirehydrant,
} = createProviderHarness({
  mountPath: 'oncall/firehydrant',
  plugin,
  upstreamAuth: API_KEY,
})

describe('契约面', () => {
  it('List 出全部 7 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(firehydrantActions).length)
    expect(tools).toHaveLength(7)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('list_incidents')).toBe('read')
    expect(effectOf('get_service')).toBe('read')
    expect(effectOf('create_incident')).toBe('write')
  })
})

describe('请求构造', () => {
  it('list_incidents 的筛选映射成 snake_case query,凭证走 Bearer', async () => {
    const mock = mockFirehydrant(200, { data: [], pagination: {} })
    await call('list_incidents', {
      page: 3,
      perPage: 50,
      query: 'db',
      status: 'active',
      tagMatchStrategy: 'match_all',
      archived: false,
      createdAtOrAfter: '2024-01-01T00:00:00Z',
      updatedBefore: '2024-02-01T00:00:00Z',
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.firehydrant.io/v1/incidents')
    expect(url.searchParams.get('page')).toBe('3')
    expect(url.searchParams.get('per_page')).toBe('50')
    expect(url.searchParams.get('query')).toBe('db')
    expect(url.searchParams.get('status')).toBe('active')
    expect(url.searchParams.get('tag_match_strategy')).toBe('match_all')
    // archived:false 要发出去,不能被"假值即省略"吞掉。
    expect(url.searchParams.get('archived')).toBe('false')
    expect(url.searchParams.get('created_at_or_after')).toBe('2024-01-01T00:00:00Z')
    expect(url.searchParams.get('updated_before')).toBe('2024-02-01T00:00:00Z')
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
  })

  it('create_incident 把 camelCase 映射成 snake_case,impacts 逐项改写', async () => {
    const mock = mockFirehydrant(201, { id: 'inc_1' })
    await call('create_incident', {
      name: 'DB down',
      customerImpactSummary: 'checkout failing',
      severityConditionId: 'cond_1',
      tagList: ['db', 'urgent'],
      impacts: [{ type: 'service', id: 'svc_1', conditionId: 'cond_2' }],
      teamIds: ['team_1'],
      skipIncidentTypeValues: true,
    })

    const request = sent(mock)
    expect(request.url).toBe('https://api.firehydrant.io/v1/incidents')
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      name: 'DB down',
      customer_impact_summary: 'checkout failing',
      severity_condition_id: 'cond_1',
      tag_list: ['db', 'urgent'],
      impacts: [{ type: 'service', id: 'svc_1', condition_id: 'cond_2' }],
      team_ids: ['team_1'],
      skip_incident_type_values: true,
    })
  })

  it('get_service 的路径参数被 URL 编码', async () => {
    const mock = mockFirehydrant(200, { id: 'svc_1' })
    await call('get_service', { serviceId: 'a/b' })
    expect(sent(mock).url).toBe('https://api.firehydrant.io/v1/services/a%2Fb')
  })
})

describe('响应归一', () => {
  it('list 的 data/pagination 信封被拆开,raw 保留整个信封', async () => {
    mockFirehydrant(200, {
      data: [{
        id: 'inc_1',
        name: 'DB down',
        number: 42,
        active: true,
        services: [{ id: 'svc_1', name: 'api', slug: 'api' }],
        tag_list: ['db'],
        labels: { team: 'core' },
      }],
      pagination: { count: 1, page: 1, pages: 1 },
    })
    const body = (await (await call('list_incidents', {})).json()) as {
      content: { incidents: Array<Record<string, unknown>>, pagination: Record<string, unknown>, raw: unknown }
    }
    const incident = body.content.incidents[0]!
    expect(incident.id).toBe('inc_1')
    expect(incident.number).toBe(42)
    expect(incident.active).toBe(true)
    expect(incident.customerImpactSummary).toBeNull()
    expect(incident.services).toEqual([{
      id: 'svc_1',
      name: 'api',
      slug: 'api',
      raw: { id: 'svc_1', name: 'api', slug: 'api' },
    }])
    expect(incident.tags).toEqual(['db'])
    expect(incident.labels).toEqual({ team: 'core' })
    expect(body.content.pagination).toMatchObject({ count: 1, page: 1, pages: 1, next: null })
    expect(body.content.raw).toMatchObject({ pagination: { count: 1 } })
  })

  it('get_environment 直接归一裸对象(单条响应没有 data 包裹)', async () => {
    mockFirehydrant(200, {
      id: 'env_1',
      name: 'production',
      service_tier: 1,
      owner: { id: 'team_1', name: 'core' },
    })
    await expect((await call('get_environment', { environmentId: 'env_1' })).json())
      .resolves.toMatchObject({
        content: {
          environment: {
            id: 'env_1',
            name: 'production',
            serviceTier: 1,
            activeIncidents: [],
            owner: { id: 'team_1', name: 'core', slug: null },
          },
        },
      })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:perPage 超上限 → 400 且不打上游', async () => {
    const mock = mockFirehydrant(200, { data: [] })
    const res = await call('list_incidents', { perPage: 500 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('缺必填 incidentId → 400 且不打上游', async () => {
    const mock = mockFirehydrant(200, {})
    expect((await call('get_incident', {})).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一', async () => {
    mockFirehydrant(401, { error: 'Unauthorized' })
    const denied = await call('list_incidents', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Unauthorized',
    })
    vi.unstubAllGlobals()

    mockFirehydrant(429, { errors: ['Too many requests', 'slow down'] })
    await expect((await call('list_incidents', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', message: 'Too many requests, slow down', retryable: true })
    vi.unstubAllGlobals()

    mockFirehydrant(404, { message: 'Incident not found' })
    await expect((await call('get_incident', { incidentId: 'nope' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'Incident not found' })
    vi.unstubAllGlobals()

    mockFirehydrant(503, {})
    await expect((await call('list_incidents', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockFirehydrant(200, { data: [] })
    const res = await call('list_incidents', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
