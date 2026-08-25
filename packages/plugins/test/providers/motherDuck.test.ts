import { describe, expect, it } from 'vitest'
import { createMotherDuckPlugin } from '../../src/mother_duck/index'
import { createProviderHarness } from '../support/providerHarness'
import { motherDuckActions } from '../../src/mother_duck/schema'

/**
 * MotherDuck 迁移产物的 wire 级验收。重点在 Admin API 的路径拼装、token 归一,
 * 以及 delete_token 那条"成功回空体"的分支(把它当错误就会把成功报成失败)。
 */

const API_KEY = 'md_token_deadbeef'
const plugin = createMotherDuckPlugin()

const {
  call,
  envelope,
  sent,
  mockJson: mockMotherDuck,
} = createProviderHarness({
  mountPath: 'data/motherduck',
  plugin,
  upstreamAuth: API_KEY,
})

describe('契约面', () => {
  it('List 出全部 8 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(motherDuckActions).length)
    expect(tools).toHaveLength(8)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('list_active_accounts')).toBe('read')
    expect(effectOf('create_token')).toBe('write')
    expect(effectOf('delete_user')).toBe('destructive')
    expect(effectOf('delete_token')).toBe('destructive')
  })
})

describe('请求构造', () => {
  it('create_token 打到用户的 tokens 端点,body 只带非空字段', async () => {
    const mock = mockMotherDuck(200, { id: 'tok_1', name: 'ci', token: 'secret', read_only: false })
    const res = await call('create_token', { username: 'ada', name: 'ci', ttl: 3600 })

    const request = sent(mock)
    expect(request.url).toBe('https://api.motherduck.com/v1/users/ada/tokens')
    expect(request.method).toBe('POST')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('content-type')).toBe('application/json')
    expect(request.headers.get('user-agent')).toBeNull()
    await expect(request.json()).resolves.toEqual({ name: 'ci', ttl: 3600 })
    await expect(res.json()).resolves.toMatchObject({
      content: { token: { id: 'tok_1', name: 'ci', token: 'secret', read_only: false } },
    })
  })

  it('set_user_duckling_config 走 PUT,config 包在 body 里', async () => {
    const mock = mockMotherDuck(200, { read_write: { instance_size: 'jumbo' } })
    const res = await call('set_user_duckling_config', {
      username: 'ada',
      config: { read_write: { instance_size: 'jumbo', cooldown_seconds: 600 } },
    })

    const request = sent(mock)
    expect(request.url).toBe('https://api.motherduck.com/v1/users/ada/instances')
    expect(request.method).toBe('PUT')
    await expect(request.json()).resolves.toEqual({
      config: { read_write: { instance_size: 'jumbo', cooldown_seconds: 600 } },
    })
    await expect(res.json()).resolves.toMatchObject({
      content: { config: { read_write: { instance_size: 'jumbo' } } },
    })
  })

  it('路径参数被 URL 编码', async () => {
    const mock = mockMotherDuck(200, { tokens: [] })
    await call('list_tokens', { username: 'a/b' })
    expect(sent(mock).url).toBe('https://api.motherduck.com/v1/users/a%2Fb/tokens')
  })

  it('delete_token 成功时上游回空体,不能当成错误', async () => {
    const mock = mockMotherDuck(200, {})
    const res = await call('delete_token', { username: 'ada', token_id: 'tok_1' })
    expect(sent(mock).method).toBe('DELETE')
    expect(sent(mock).url).toBe('https://api.motherduck.com/v1/users/ada/tokens/tok_1')
    await expect(res.json()).resolves.toEqual({ content: { success: true } })
  })

  it('delete_user 在上游不回 username 时回落到入参', async () => {
    mockMotherDuck(200, {})
    await expect((await call('delete_user', { username: 'ada' })).json())
      .resolves.toEqual({ content: { username: 'ada' } })
  })
})

describe('校验与错误', () => {
  it('入参校验生效:ttl 低于下限 → 400 且不打上游', async () => {
    const mock = mockMotherDuck(200, {})
    const res = await call('create_token', { username: 'ada', name: 'ci', ttl: 1 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('config 里的未知 instance_size → 400 且不打上游', async () => {
    const mock = mockMotherDuck(200, {})
    const res = await call('set_user_duckling_config', {
      username: 'ada',
      config: { read_write: { instance_size: 'colossal' } },
    })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('accounts/tokens 不是数组 → unavailable(上游违约)', async () => {
    mockMotherDuck(200, { accounts: 'nope' })
    await expect((await call('list_active_accounts', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('上游错误按状态归一', async () => {
    mockMotherDuck(401, { message: 'invalid token' })
    const unauth = await call('list_active_accounts', {})
    expect(unauth.status).toBe(401)
    await expect(unauth.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'invalid token',
    })

    mockMotherDuck(429, { error: 'too many requests' })
    await expect((await call('list_active_accounts', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    // 上游把 409 压成 400;迁移后保留 conflict。
    mockMotherDuck(409, { message: 'user already exists' })
    await expect((await call('create_user', { username: 'ada' })).json())
      .resolves.toMatchObject({ code: 'conflict', message: 'user already exists' })

    mockMotherDuck(500, { message: 'boom' })
    await expect((await call('list_active_accounts', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockMotherDuck(200, {})
    const res = await call('list_active_accounts', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
