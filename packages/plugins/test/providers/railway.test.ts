import {
  type CallContext,
} from '@tool-bridge/core'
import { describe, expect, it, vi } from 'vitest'
import { createProviderHarness } from '../support/providerHarness'
import { createRailwayPlugin } from '../../src/railway/index'
import { railwayActions } from '../../src/railway/schema'

/**
 * Railway 迁移产物的 wire 级验收。重点在四处迁移最容易迁丢的地方:
 * HTTP 200 的 GraphQL 信封错误、connection 分页壳的拆解(含 null node)、
 * 上游声明里没写 required 但 executor 有断言的那批字段、以及 workspace 令牌那条分支。
 */

const API_KEY = 'railway_test_token'
const GRAPHQL_URL = 'https://backboard.railway.com/graphql/v2'
const plugin = createRailwayPlugin()

function caller(workspaceId?: string): CallContext {
  return {
    keyId: 'k1',
    owner: 'agent:tester',
    scopes: [],
    traceId: 't1',
    mountPath: 'infra/railway',
    exportId: 'actions',
    ...(workspaceId === undefined ? {} : { mountConfig: { workspaceId } }),
  }
}

interface CallOptions {
  auth?: string | null
  workspaceId?: string
}

const { call, envelope, sent, mockJson: mockRailway, env: ENV } = createProviderHarness<CallOptions>({
  caller: opts => caller(opts.workspaceId),
  mountPath: 'infra/railway',
  plugin,
  upstreamAuth: API_KEY,
})

/** 上游收到的 GraphQL 请求体。 */
async function sentBody(mock: ReturnType<typeof vi.fn>): Promise<{ query: string, variables?: unknown }> {
  return (await sent(mock).json()) as { query: string, variables?: unknown }
}

/** 比较 GraphQL 查询时把缩进压平 —— 断言的是选择集,不是排版。 */
function flat(query: string): string {
  return query.replace(/\s+/g, ' ').trim()
}

describe('契约面', () => {
  it('~describe 报单个 tools/v1 export,并宣告 list_projects 为凭证探针', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    await expect(res.json()).resolves.toEqual({
      protocolVersion: 'plugin/v2',
      exports: [{
        auth: { kind: 'single', required: true },
        id: 'actions',
        profile: 'tools/v1',
        description: 'Railway',
        credentialProbe: 'list_projects',
        mountConfigFields: [{
          key: 'workspaceId',
          label: 'Workspace ID',
          description: '限定 list_projects 的工作区;留空用账户默认',
        }],
      }],
    })
  })

  it('List 出全部 9 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(railwayActions).length)
    expect(tools).toHaveLength(9)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('探针 list_projects 是 read 且入参为空对象(平台会空参调它)', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{
      effect?: string
      inputSchema?: { required?: string[] }
      name: string
    }>
    const probe = tools.find(tool => tool.name === 'list_projects')
    expect(probe?.effect).toBe('read')
    expect(probe?.inputSchema?.required ?? []).toEqual([])
  })
})

describe('请求拼装', () => {
  it('九个 action 打同一个端点:POST /graphql/v2,Bearer 认证,body 是 {query,variables}', async () => {
    const mock = mockRailway(200, { data: { project: { id: 'p1', name: 'demo' } } })
    await call('get_project', { projectId: 'p1' })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.url).toBe(GRAPHQL_URL)
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('content-type')).toBe('application/json')
    expect(request.headers.get('accept')).toBe('application/json')

    const body = await sentBody(mock)
    expect(body.variables).toEqual({ id: 'p1' })
    expect(flat(body.query)).toContain('query project($id: String!)')
  })

  it('list_projects:账号令牌下不带 variables,配了 workspaceId 则换成 workspace 查询', async () => {
    const account = mockRailway(200, { data: { projects: { edges: [] } } })
    await call('list_projects', {})
    const accountBody = await sentBody(account)
    expect(accountBody.variables).toBeUndefined()
    expect(flat(accountBody.query)).toContain('query projects { projects { edges')

    vi.unstubAllGlobals()
    const workspace = mockRailway(200, { data: { projects: { edges: [] } } })
    await call('list_projects', {}, { workspaceId: 'ws_42' })
    const workspaceBody = await sentBody(workspace)
    expect(workspaceBody.variables).toEqual({ workspaceId: 'ws_42' })
    expect(flat(workspaceBody.query)).toContain('projects(workspaceId: $workspaceId)')
  })

  it('list_deployments:筛选进 input 对象,limit 映射成 first,省略时兜底 20', async () => {
    const explicit = mockRailway(200, { data: { deployments: { edges: [] } } })
    await call('list_deployments', { projectId: 'p1', serviceId: 's1', environmentId: 'e1', limit: 5 })
    expect((await sentBody(explicit)).variables).toEqual({
      input: { projectId: 'p1', serviceId: 's1', environmentId: 'e1' },
      first: 5,
    })

    vi.unstubAllGlobals()
    const fallback = mockRailway(200, { data: { deployments: { edges: [] } } })
    await call('list_deployments', { projectId: 'p1', serviceId: 's1', environmentId: 'e1' })
    expect((await sentBody(fallback)).variables).toMatchObject({ first: 20 })
  })

  it('get_deployment_logs:未给的筛选项不进 variables,limit 兜底 500', async () => {
    const bare = mockRailway(200, { data: { deploymentLogs: [] } })
    await call('get_deployment_logs', { deploymentId: 'd1' })
    expect((await sentBody(bare)).variables).toEqual({ deploymentId: 'd1', limit: 500 })

    vi.unstubAllGlobals()
    const full = mockRailway(200, { data: { deploymentLogs: [] } })
    await call('get_deployment_logs', {
      deploymentId: 'd1',
      limit: 10,
      filter: 'level:error',
      startDate: '2024-01-01T00:00:00Z',
      endDate: '2024-01-02T00:00:00Z',
    })
    expect((await sentBody(full)).variables).toEqual({
      deploymentId: 'd1',
      limit: 10,
      filter: 'level:error',
      startDate: '2024-01-01T00:00:00Z',
      endDate: '2024-01-02T00:00:00Z',
    })
  })

  it('deploy_service:未给 commitSha 时该键不出现(不是 null)', async () => {
    const mock = mockRailway(200, { data: { serviceInstanceDeployV2: 'dep_1' } })
    await call('deploy_service', { serviceId: 's1', environmentId: 'e1' })
    expect((await sentBody(mock)).variables).toEqual({ serviceId: 's1', environmentId: 'e1' })
  })

  it('upsert_variable:value 逐字保留(空串与前后空白都要原样写进去)', async () => {
    const blank = mockRailway(200, { data: { variableUpsert: true } })
    await call('upsert_variable', { projectId: 'p1', environmentId: 'e1', name: 'API_URL', value: '' })
    expect((await sentBody(blank)).variables).toEqual({
      input: { projectId: 'p1', environmentId: 'e1', name: 'API_URL', value: '' },
    })

    vi.unstubAllGlobals()
    const spaced = mockRailway(200, { data: { variableUpsert: true } })
    await call('upsert_variable', {
      projectId: 'p1',
      environmentId: 'e1',
      serviceId: 's1',
      name: 'TOKEN',
      value: '  padded  ',
      skipDeploys: true,
    })
    expect((await sentBody(spaced)).variables).toEqual({
      input: {
        projectId: 'p1',
        environmentId: 'e1',
        serviceId: 's1',
        name: 'TOKEN',
        value: '  padded  ',
        skipDeploys: true,
      },
    })
  })
})

describe('响应整形', () => {
  it('connection 壳拆成裸数组,node 为 null 的边丢掉(不留数组里的空洞)', async () => {
    mockRailway(200, {
      data: {
        projects: {
          edges: [
            { node: { id: 'p1', name: 'one' } },
            { node: null },
            { node: { id: 'p2', name: 'two' } },
          ],
        },
      },
    })
    await expect((await call('list_projects', {})).json()).resolves.toEqual({
      content: { projects: [{ id: 'p1', name: 'one' }, { id: 'p2', name: 'two' }] },
    })
  })

  it('get_project:services / environments 各自拆壳,缺席的 description 归一成 null', async () => {
    mockRailway(200, {
      data: {
        project: {
          id: 'p1',
          name: 'demo',
          createdAt: '2024-01-01T00:00:00Z',
          services: { edges: [{ node: { id: 's1', name: 'api', icon: null } }] },
          environments: { edges: [{ node: { id: 'e1', name: 'production' } }] },
        },
      },
    })
    await expect((await call('get_project', { projectId: 'p1' })).json()).resolves.toEqual({
      content: {
        project: {
          id: 'p1',
          name: 'demo',
          description: null,
          createdAt: '2024-01-01T00:00:00Z',
          services: [{ id: 's1', name: 'api', icon: null }],
          environments: [{ id: 'e1', name: 'production' }],
        },
      },
    })
  })

  it('deploy_service 的返回值就是一个 id 字符串;variableUpsert 是一个布尔', async () => {
    mockRailway(200, { data: { serviceInstanceDeployV2: 'dep_9' } })
    await expect((await call('deploy_service', { serviceId: 's1', environmentId: 'e1' })).json())
      .resolves.toEqual({ content: { deploymentId: 'dep_9' } })

    vi.unstubAllGlobals()
    mockRailway(200, { data: { variableUpsert: false } })
    await expect((await call('upsert_variable', {
      projectId: 'p1',
      environmentId: 'e1',
      name: 'A',
      value: 'b',
    })).json()).resolves.toEqual({ content: { updated: false } })
  })

  it('deploymentLogs 为 null 时归一成空数组(出参声明的是数组)', async () => {
    mockRailway(200, { data: { deploymentLogs: null } })
    await expect((await call('get_deployment_logs', { deploymentId: 'd1' })).json())
      .resolves.toEqual({ content: { logs: [] } })
  })
})

describe('校验与错误', () => {
  it.each([
    ['get_project', {}, 'projectId'],
    ['get_service_instance', { serviceId: 's1' }, 'environmentId'],
    ['get_deployment', {}, 'deploymentId'],
    ['rollback_deployment', {}, 'deploymentId'],
  ])('%s 缺必填字段 → invalid_argument(上游声明里没写 required,断言在这一层)', async (name, args, field) => {
    const mock = mockRailway(200, { data: {} })
    const res = await call(name, args)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument', message: `${field} 是必填的` })
    expect(mock).not.toHaveBeenCalled()
  })

  it('纯空白的必填 id 能过 Zod 的 min(1),但在本地就挡下', async () => {
    const mock = mockRailway(200, { data: {} })
    const res = await call('get_deployment', { deploymentId: '   ' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('入参校验真的生效:limit 越界 → invalid_argument 且不打上游', async () => {
    const mock = mockRailway(200, { data: {} })
    const res = await call('list_deployments', {
      projectId: 'p1',
      serviceId: 's1',
      environmentId: 'e1',
      limit: 500,
    })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('HTTP 200 + errors[] 是 GraphQL 的失败表达,不能当成功返回;多条错误串起来', async () => {
    mockRailway(200, {
      data: null,
      errors: [{ message: 'Problem processing request' }, { message: 'Not Authorized' }],
    })
    const res = await call('get_project', { projectId: 'p1' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'Problem processing request; Not Authorized',
    })
  })

  it('errors[] 为空数组时不算失败,继续按 data 走', async () => {
    mockRailway(200, { data: { projects: { edges: [] } }, errors: [] })
    await expect((await call('list_projects', {})).json())
      .resolves.toEqual({ content: { projects: [] } })
  })

  it('上游 401 → permission_denied,消息从 errors[] 里取;5xx → unavailable + retryable', async () => {
    mockRailway(401, { errors: [{ message: 'Not Authorized' }] })
    const unauthorized = await call('list_projects', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Not Authorized',
    })

    vi.unstubAllGlobals()
    mockRailway(429, { message: 'Too many requests' })
    await expect((await call('list_projects', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockRailway(502, { message: 'bad gateway' })
    await expect((await call('list_projects', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('data 缺席、或 GraphQL 把该给的对象给成 null → unavailable + retryable', async () => {
    mockRailway(200, { extensions: {} })
    await expect((await call('list_projects', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })

    vi.unstubAllGlobals()
    mockRailway(200, { data: { project: null } })
    await expect((await call('get_project', { projectId: 'p1' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })

    vi.unstubAllGlobals()
    mockRailway(200, { data: { serviceInstanceDeployV2: null } })
    await expect((await call('deploy_service', { serviceId: 's1', environmentId: 'e1' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockRailway(200, { data: {} })
    const res = await call('list_projects', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
