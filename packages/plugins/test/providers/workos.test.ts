import { describe, expect, it } from 'vitest'
import { createProviderHarness } from '../support/providerHarness'
import { createWorkosPlugin } from '../../src/workos/index'
import { workosActions } from '../../src/workos/schema'

/**
 * WorkOS 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 多值过滤的重复 key、单对象响应的两种形状、无 body 的 PUT、raw 原样透出。
 */

const API_KEY = 'sk_test_workos'
const plugin = createWorkosPlugin()

const {
  call,
  envelope,
  sent,
  mockJson: mockWorkos,
} = createProviderHarness({
  mountPath: 'auth/workos',
  plugin,
  upstreamAuth: API_KEY,
})

describe('契约面', () => {
  it('List 出全部 14 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(workosActions).length)
    expect(tools).toHaveLength(14)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('list_users')).toBe('read')
    expect(effectOf('get_organization')).toBe('read')
    expect(effectOf('create_user')).toBe('write')
    expect(effectOf('deactivate_organization_membership')).toBe('write')
  })
})

describe('请求成形', () => {
  it('多值过滤重复同名键,凭证走 Bearer', async () => {
    const mock = mockWorkos(200, { data: [], list_metadata: {} })
    await call('list_organization_memberships', {
      organization_id: 'org_1',
      statuses: ['active', 'pending'],
      limit: 10,
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname)
      .toBe('https://api.workos.com/user_management/organization_memberships')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(url.searchParams.getAll('statuses')).toEqual(['active', 'pending'])
    expect(url.searchParams.get('organization_id')).toBe('org_1')
    expect(url.searchParams.has('user_id')).toBe(false)
  })

  it('create_user 发 JSON body,省略的可选字段不出现', async () => {
    const mock = mockWorkos(200, { user: { id: 'user_1' } })
    await call('create_user', { email: 'ada@example.com', email_verified: true })
    const request = sent(mock)
    expect(request.url).toBe('https://api.workos.com/user_management/users')
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      email: 'ada@example.com',
      email_verified: true,
    })
  })

  it('deactivate 是不带 body 的 PUT,路径参数被编码', async () => {
    const mock = mockWorkos(200, { organization_membership: { id: 'om_1', status: 'inactive' } })
    await call('deactivate_organization_membership', { id: 'om/1' })
    const request = sent(mock)
    expect(request.url)
      .toBe('https://api.workos.com/user_management/organization_memberships/om%2F1/deactivate')
    expect(request.method).toBe('PUT')
    expect(request.headers.get('content-type')).toBeNull()
    await expect(request.text()).resolves.toBe('')
  })
})

describe('响应归一', () => {
  it('列表拆出 data 与 list_metadata,raw 原样保留', async () => {
    mockWorkos(200, {
      data: [{ id: 'user_1' }],
      list_metadata: { before: null, after: 'user_1' },
    })
    await expect((await call('list_users', {})).json()).resolves.toEqual({
      content: {
        users: [{ id: 'user_1' }],
        list_metadata: { before: null, after: 'user_1' },
        raw: { data: [{ id: 'user_1' }], list_metadata: { before: null, after: 'user_1' } },
      },
    })
  })

  it('单对象响应无论有没有包一层同名键都能取出', async () => {
    mockWorkos(200, { user: { id: 'user_1', email: 'ada@example.com' } })
    await expect((await call('get_user', { id: 'user_1' })).json())
      .resolves.toMatchObject({ content: { user: { id: 'user_1' } } })

    // 没包壳时把整个 payload 当作对象本身(上游同此)。
    mockWorkos(200, { id: 'org_1', name: 'Acme' })
    await expect((await call('get_organization', { id: 'org_1' })).json())
      .resolves.toMatchObject({ content: { organization: { id: 'org_1', name: 'Acme' } } })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:email 不是邮箱 → 400 且不打上游', async () => {
    const mock = mockWorkos(200, {})
    const res = await call('create_user', { email: 'not-an-email' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('入参校验真的生效:limit 超上限 → 400 且不打上游', async () => {
    const mock = mockWorkos(200, {})
    const res = await call('list_organizations', { limit: 1000 })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 error.message / message', async () => {
    mockWorkos(401, { message: 'Unauthorized' })
    const denied = await call('list_users', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Unauthorized',
    })

    mockWorkos(429, { error: { message: 'Too many requests' } })
    await expect((await call('list_users', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockWorkos(404, { error_description: 'User not found' })
    await expect((await call('get_user', { id: 'user_missing' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'User not found' })

    mockWorkos(500, { message: 'WorkOS is down' })
    await expect((await call('list_users', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockWorkos(200, {})
    const res = await call('list_users', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
