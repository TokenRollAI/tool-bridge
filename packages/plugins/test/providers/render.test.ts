import { describe, expect, it, vi } from 'vitest'
import { createProviderHarness } from '../support/providerHarness'
import { createRenderPlugin } from '../../src/render/index'
import { renderActions } from '../../src/render/schema'

/**
 * Render 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 多值过滤的逗号拼接、每项自带 cursor 的列表剥壳、202 无体的 queued 确认、
 * deployMode 的跨字段互斥。
 */

const API_KEY = 'rnd_deadbeef'
const plugin = createRenderPlugin()

const {
  call,
  envelope,
  sent,
  stubFetch,
} = createProviderHarness({
  mountPath: 'infra/render',
  plugin,
  upstreamAuth: API_KEY,
})

function mockRender(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  return stubFetch(() => Promise.resolve(new Response(
    status === 202 || status === 204 ? null : JSON.stringify(payload),
    { status, headers: { 'content-type': 'application/json' } },
  )))
}

describe('契约面', () => {
  it('List 出全部 10 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(renderActions).length)
    expect(tools).toHaveLength(10)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('get_current_user')).toBe('read')
    expect(effectOf('list_services')).toBe('read')
    expect(effectOf('trigger_deploy')).toBe('write')
    expect(effectOf('suspend_service')).toBe('write')
  })
})

describe('请求成形', () => {
  it('多值过滤逗号拼接进一个 query 值,凭证走 Bearer', async () => {
    const mock = mockRender(200, [])
    await call('list_services', {
      type: ['web_service', 'cron_job'],
      ownerId: ['own_1'],
      includePreviews: false,
      limit: 20,
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.render.com/v1/services')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(url.searchParams.get('type')).toBe('web_service,cron_job')
    expect(url.searchParams.get('ownerId')).toBe('own_1')
    expect(url.searchParams.get('includePreviews')).toBe('false')
    expect(url.searchParams.get('limit')).toBe('20')
    expect(url.searchParams.has('name')).toBe(false)
  })

  it('生命周期操作打 POST 且路径参数被编码,返回归一确认', async () => {
    const mock = mockRender(204, null)
    const res = await call('suspend_service', { serviceId: 'srv/a' })
    const request = sent(mock)
    expect(request.url).toBe('https://api.render.com/v1/services/srv%2Fa/suspend')
    expect(request.method).toBe('POST')
    await expect(res.json()).resolves.toEqual({
      content: { ok: true, serviceId: 'srv/a', action: 'suspend' },
    })
  })

  it('rollback 把 deployId 放进 JSON body', async () => {
    const mock = mockRender(200, { id: 'dep_2' })
    await call('rollback_deploy', { serviceId: 'srv_1', deployId: 'dep_1' })
    const request = sent(mock)
    expect(request.url).toBe('https://api.render.com/v1/services/srv_1/rollback')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({ deployId: 'dep_1' })
  })

  it('trigger_deploy 即使没给 clearCache 也显式发 do_not_clear', async () => {
    const mock = mockRender(200, { id: 'dep_1' })
    await call('trigger_deploy', { serviceId: 'srv_1', commitId: 'abc123' })
    await expect(sent(mock).json()).resolves.toEqual({
      clearCache: 'do_not_clear',
      commitId: 'abc123',
    })
  })
})

describe('响应归一', () => {
  it('列表剥掉每项外壳,nextCursor 取最后一项的 cursor', async () => {
    mockRender(200, [
      { service: { id: 'srv_1' }, cursor: 'c1' },
      { service: { id: 'srv_2' }, cursor: 'c2' },
    ])
    await expect((await call('list_services', {})).json()).resolves.toEqual({
      content: { services: [{ id: 'srv_1' }, { id: 'srv_2' }], nextCursor: 'c2' },
    })
  })

  it('列表形状不对 → unavailable(不把坏数据当空结果吞掉)', async () => {
    mockRender(200, { owners: [] })
    await expect((await call('list_workspaces', {})).json())
      .resolves.toMatchObject({ code: 'unavailable' })
  })

  it('trigger_deploy 收到 202(无响应体)时回 queued 确认', async () => {
    mockRender(202, null)
    await expect((await call('trigger_deploy', { serviceId: 'srv_1' })).json())
      .resolves.toEqual({ content: { queued: true, serviceId: 'srv_1' } })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:limit 超上限 → 400 且不打上游', async () => {
    const mock = mockRender(200, [])
    const res = await call('list_services', { limit: 500 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('deployMode 与 commitId 互斥,在本地就挡下', async () => {
    const mock = mockRender(200, {})
    const res = await call('trigger_deploy', {
      serviceId: 'srv_1',
      deployMode: 'deploy_only',
      commitId: 'abc123',
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('deployMode')
    expect(mock).not.toHaveBeenCalled()
  })

  it('schema 里 serviceId 是 optional,但缺它拼不出路径 → 400 且不打上游', async () => {
    const mock = mockRender(200, {})
    const res = await call('get_service', {})
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 message/errors', async () => {
    mockRender(401, { message: 'Unauthorized' })
    const denied = await call('get_current_user', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Unauthorized',
    })

    mockRender(429, { message: 'Rate limit exceeded' })
    await expect((await call('get_current_user', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    // 上游把 404 压成 400;收口后按语义映射成 not_found。
    mockRender(404, { errors: [{ message: 'service not found' }] })
    await expect((await call('get_service', { serviceId: 'srv_missing' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'service not found' })

    mockRender(500, { message: 'Render is down' })
    await expect((await call('get_current_user', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockRender(200, {})
    const res = await call('get_current_user', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
