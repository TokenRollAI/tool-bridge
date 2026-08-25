import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createProviderHarness } from '../support/providerHarness'
import { createClerkPlugin } from '../../src/clerk/index'
import { clerkActions } from '../../src/clerk/schema'

/**
 * Clerk 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 数组过滤器重复同名 query 键、list 的双形状响应归一、路径参数不重复进 body、
 * ban/lock 四个动作各自打对末段、错误消息取自 `errors[0].long_message`。
 */

const API_KEY = 'sk_test_deadbeef'
const plugin = createClerkPlugin()

const {
  call,
  envelope,
  sent,
  mockJson: mockClerk,
} = createProviderHarness({
  mountPath: 'auth/clerk',
  plugin,
  upstreamAuth: API_KEY,
})

describe('契约面', () => {
  it('List 出全部 11 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(clerkActions).length)
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
    expect(effectOf('list_users')).toBe('read')
    expect(effectOf('count_users')).toBe('read')
    expect(effectOf('get_user')).toBe('read')
    expect(effectOf('delete_user')).toBe('destructive')
    expect(effectOf('ban_user')).toBe('write')
  })
})

describe('查询编码与响应归一', () => {
  it('数组过滤器重复同名键,标量走一次 set,凭证走 Bearer', async () => {
    const mock = mockClerk(200, { data: [{ id: 'user_1' }], total_count: 7 })
    const res = await call('list_users', {
      email_address: ['a@example.com', 'b@example.com'],
      query: 'ada',
      order_by: '-created_at',
      limit: 20,
      offset: 40,
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.clerk.com/v1/users')
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('accept')).toBe('application/json')
    // GET 没有 body,不该带 content-type。
    expect(request.headers.get('content-type')).toBeNull()
    expect(url.searchParams.getAll('email_address')).toEqual(['a@example.com', 'b@example.com'])
    expect(url.searchParams.get('query')).toBe('ada')
    expect(url.searchParams.get('order_by')).toBe('-created_at')
    expect(url.searchParams.get('limit')).toBe('20')
    expect(url.searchParams.get('offset')).toBe('40')
    // 没给的过滤器不该出现在 URL 里。
    expect(url.searchParams.has('username')).toBe(false)
    expect(url.searchParams.has('external_id')).toBe(false)

    await expect(res.json()).resolves.toEqual({
      content: { users: [{ id: 'user_1' }], total_count: 7 },
    })
  })

  it('list_users 收裸数组响应,total_count 按条数兜底', async () => {
    mockClerk(200, [{ id: 'user_1' }, { id: 'user_2' }])
    const res = await call('list_users', {})
    await expect(res.json()).resolves.toEqual({
      content: { users: [{ id: 'user_1' }, { id: 'user_2' }], total_count: 2 },
    })
  })

  it('list_users 拿到既非数组也非 data 信封的响应 → unavailable', async () => {
    mockClerk(200, { unexpected: true })
    const res = await call('list_users', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('count_users 打 /users/count,且不带分页参数', async () => {
    const mock = mockClerk(200, { object: 'total_count', total_count: 42 })
    const res = await call('count_users', { username: ['ada'] })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v1/users/count')
    expect(url.searchParams.getAll('username')).toEqual(['ada'])
    await expect(res.json()).resolves.toEqual({
      content: { object: 'total_count', total_count: 42 },
    })
  })
})

describe('请求体与路径参数', () => {
  it('create_user 发 JSON body,省略的可选字段不出现', async () => {
    const mock = mockClerk(200, { id: 'user_1', object: 'user' })
    const res = await call('create_user', {
      email_address: ['ada@example.com'],
      first_name: 'Ada',
      public_metadata: { plan: 'pro' },
    })

    const request = sent(mock)
    expect(request.url).toBe('https://api.clerk.com/v1/users')
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      email_address: ['ada@example.com'],
      first_name: 'Ada',
      public_metadata: { plan: 'pro' },
    })
    await expect(res.json()).resolves.toEqual({
      content: { user: { id: 'user_1', object: 'user' } },
    })
  })

  it('update_user 走 PATCH,user_id 被 URL 编码且不重复进 body', async () => {
    const mock = mockClerk(200, { id: 'user_a/b' })
    await call('update_user', { user_id: 'user_a/b', first_name: 'New' })
    const request = sent(mock)
    expect(request.url).toBe('https://api.clerk.com/v1/users/user_a%2Fb')
    expect(request.method).toBe('PATCH')
    await expect(request.json()).resolves.toEqual({ first_name: 'New' })
  })

  it('update_user_metadata 打 /metadata 子路径', async () => {
    const mock = mockClerk(200, { id: 'user_1' })
    await call('update_user_metadata', { user_id: 'user_1', public_metadata: { tier: 'gold' } })
    const request = sent(mock)
    expect(request.url).toBe('https://api.clerk.com/v1/users/user_1/metadata')
    expect(request.method).toBe('PATCH')
    await expect(request.json()).resolves.toEqual({ public_metadata: { tier: 'gold' } })
  })

  it('delete_user 走 DELETE,响应挂在 deleted_object 下', async () => {
    const mock = mockClerk(200, { id: 'user_1', object: 'user', deleted: true })
    const res = await call('delete_user', { user_id: 'user_1' })
    const request = sent(mock)
    expect(request.url).toBe('https://api.clerk.com/v1/users/user_1')
    expect(request.method).toBe('DELETE')
    await expect(res.json()).resolves.toEqual({
      content: { deleted_object: { id: 'user_1', object: 'user', deleted: true } },
    })
  })

  it('get_user 走 GET,响应挂在 user 下', async () => {
    const mock = mockClerk(200, { id: 'user_1', banned: false })
    const res = await call('get_user', { user_id: 'user_1' })
    expect(sent(mock).url).toBe('https://api.clerk.com/v1/users/user_1')
    expect(sent(mock).method).toBe('GET')
    await expect(res.json()).resolves.toEqual({ content: { user: { id: 'user_1', banned: false } } })
  })

  it.each([
    ['ban_user', 'ban'],
    ['unban_user', 'unban'],
    ['lock_user', 'lock'],
    ['unlock_user', 'unlock'],
  ])('%s 打 POST /users/{id}/%s 且不带 body', async (action, segment) => {
    const mock = mockClerk(200, { id: 'user_1' })
    const res = await call(action, { user_id: 'user_1' })
    const request = sent(mock)
    expect(request.url).toBe(`https://api.clerk.com/v1/users/user_1/${segment}`)
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBeNull()
    await expect(res.json()).resolves.toEqual({ content: { user: { id: 'user_1' } } })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:user_id 给空串 → 400 且不打上游', async () => {
    const mock = mockClerk(200, {})
    const res = await call('get_user', { user_id: '' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('strictObject 挡住未知字段 → 400 且不打上游', async () => {
    const mock = mockClerk(200, {})
    const res = await call('list_users', { limit: 10, not_a_filter: 'x' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('limit 超出 1..500 → 400 且不打上游', async () => {
    const mock = mockClerk(200, {})
    expect((await call('list_users', { limit: 501 })).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 errors[0].long_message', async () => {
    mockClerk(404, { errors: [{ code: 'resource_not_found', long_message: 'No user with id user_missing' }] })
    const missing = await call('get_user', { user_id: 'user_missing' })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({
      code: 'not_found',
      message: 'No user with id user_missing',
    })

    mockClerk(401, { errors: [{ message: 'Invalid authentication' }] })
    const unauthorized = await call('list_users', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid authentication',
    })

    mockClerk(429, { errors: [{ code: 'rate_limit_exceeded' }] })
    const limited = await call('list_users', {})
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({
      code: 'rate_limited',
      retryable: true,
      message: 'rate_limit_exceeded',
    })

    mockClerk(500, {})
    await expect((await call('list_users', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('上游回非 JSON 错误体时也能拿到消息', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
      new Response('<html>gateway error</html>', { status: 502 }),
    )))
    const res = await call('list_users', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ message: '<html>gateway error</html>' })
  })

  it('传输层失败归一成 unavailable,而非裸 Error 抹成 internal 500', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('socket hang up'))))
    const res = await call('list_users', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      message: 'clerk 请求失败: socket hang up',
    })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockClerk(200, {})
    const res = await call('list_users', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('凭证探针(credentialProbe)', () => {
  it('~describe 报出探针工具名,平台据此在挂载时验凭证', async () => {
    const res = await createClerkPlugin().fetch(
      new Request('https://p.test/~describe'),
      {} as never,
    )
    const body = (await res.json()) as {
      exports: Array<{ credentialProbe?: string, id: string }>
    }
    expect(body.exports[0]?.credentialProbe).toBe('count_users')
  })

  it('探针指向的工具确实存在、只读、且无必填入参(平台挂载时会空参调它)', async () => {
    const spec = clerkActions.count_users
    expect(spec).toBeDefined()
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })
})
