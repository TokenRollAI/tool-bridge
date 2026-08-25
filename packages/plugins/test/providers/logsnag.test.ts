import { describe, expect, it, vi } from 'vitest'
import { createProviderHarness } from '../support/providerHarness'
import { createLogsnagPlugin } from '../../src/logsnag/index'
import { logsnagActions } from '../../src/logsnag/schema'

/**
 * LogSnag 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 入参整体即请求体(project 不进 URL)、insight 端点的 POST/PATCH 之分、
 * 空响应体时 payload 应缺席、错误消息在 message/error/detail 三个键之间的兜底。
 */

const API_KEY = 'logsnag_test_token'
const plugin = createLogsnagPlugin()

const {
  call,
  envelope,
  sent,
  mockJson: mockLogsnag,
  stubFetch,
} = createProviderHarness({
  mountPath: 'observability/logsnag',
  plugin,
  upstreamAuth: API_KEY,
})

/** 上游回空体(LogSnag 的 ack 常常没有 body)。 */
function mockLogsnagEmpty(status: number): ReturnType<typeof vi.fn> {
  return stubFetch(() => Promise.resolve(new Response(null, { status })))
}

describe('契约面', () => {
  it('List 出全部 4 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(logsnagActions).length)
    expect(tools).toHaveLength(4)
    expect(tools.map(t => t.name).sort()).toEqual([
      'identify_user',
      'mutate_insight',
      'publish_event',
      'publish_insight',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求整形', () => {
  it('publish_event:入参整体即 JSON body,凭证走 Bearer', async () => {
    const mock = mockLogsnag(200, { status: 'ok' })
    const res = await call('publish_event', {
      project: 'acme',
      channel: 'waitlist',
      event: 'User Joined',
      description: '**welcome**',
      icon: '🎉',
      notify: true,
      tags: { plan: 'pro', seats: 3, trial: false },
      parser: 'markdown',
      user_id: 'u_1',
      timestamp: 1_700_000_000,
    })

    const request = sent(mock)
    expect(request.url).toBe('https://api.logsnag.com/v1/log')
    expect(request.method).toBe('POST')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('content-type')).toBe('application/json')
    expect(request.headers.get('accept')).toBe('application/json')
    // 平台不注入 UA,迁移时删掉了上游的 user-agent 头。
    expect(request.headers.get('user-agent')).toBeNull()
    await expect(request.json()).resolves.toEqual({
      project: 'acme',
      channel: 'waitlist',
      event: 'User Joined',
      description: '**welcome**',
      icon: '🎉',
      notify: true,
      tags: { plan: 'pro', seats: 3, trial: false },
      parser: 'markdown',
      user_id: 'u_1',
      timestamp: 1_700_000_000,
    })
    await expect(res.json()).resolves.toEqual({
      content: { ok: true, status: 200, payload: { status: 'ok' } },
    })
  })

  it('省略的可选字段不出现在 body 里', async () => {
    const mock = mockLogsnag(200, {})
    await call('publish_event', { project: 'acme', channel: 'waitlist', event: 'Ping' })
    await expect(sent(mock).json()).resolves.toEqual({
      project: 'acme',
      channel: 'waitlist',
      event: 'Ping',
    })
  })

  it('identify_user 打 /identify', async () => {
    const mock = mockLogsnag(200, {})
    await call('identify_user', {
      project: 'acme',
      user_id: 'u_1',
      properties: { plan: 'pro', credits: 42 },
    })
    const request = sent(mock)
    expect(request.url).toBe('https://api.logsnag.com/v1/identify')
    expect(request.method).toBe('POST')
    await expect(request.json()).resolves.toEqual({
      project: 'acme',
      user_id: 'u_1',
      properties: { plan: 'pro', credits: 42 },
    })
  })

  it('insight 的两个 action 打同一端点,靠 POST/PATCH 区分', async () => {
    const publish = mockLogsnag(200, {})
    await call('publish_insight', { project: 'acme', title: 'MRR', value: '$1,234', icon: '💰' })
    expect(sent(publish).url).toBe('https://api.logsnag.com/v1/insight')
    expect(sent(publish).method).toBe('POST')

    vi.unstubAllGlobals()
    const mutate = mockLogsnag(200, {})
    await call('mutate_insight', { project: 'acme', title: 'MRR', value: { $inc: -5 } })
    const request = sent(mutate)
    expect(request.url).toBe('https://api.logsnag.com/v1/insight')
    expect(request.method).toBe('PATCH')
    await expect(request.json()).resolves.toEqual({
      project: 'acme',
      title: 'MRR',
      value: { $inc: -5 },
    })
  })

  it('上游回空体时 payload 键缺席(不是 null)', async () => {
    mockLogsnagEmpty(202)
    const res = await call('publish_event', { project: 'acme', channel: 'c', event: 'e' })
    const body = (await res.json()) as { content: Record<string, unknown> }
    expect(body.content).toEqual({ ok: true, status: 202 })
    expect('payload' in body.content).toBe(false)
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:project 给空串 → 400 且不打上游', async () => {
    const mock = mockLogsnag(200, {})
    const res = await call('publish_event', { project: '', channel: 'c', event: 'e' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('mutate_insight 的 value 必须是 {$inc:number} → 400 且不打上游', async () => {
    const mock = mockLogsnag(200, {})
    const res = await call('mutate_insight', { project: 'acme', title: 'MRR', value: 5 })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 message/error/detail', async () => {
    mockLogsnag(401, { message: 'Invalid token' })
    const unauthorized = await call('publish_event', { project: 'a', channel: 'c', event: 'e' })
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid token',
    })

    vi.unstubAllGlobals()
    mockLogsnag(429, { error: 'Too many requests' })
    const limited = await call('publish_event', { project: 'a', channel: 'c', event: 'e' })
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({
      code: 'rate_limited',
      message: 'Too many requests',
      retryable: true,
    })

    vi.unstubAllGlobals()
    mockLogsnag(404, { detail: 'No such channel' })
    await expect((await call('publish_event', { project: 'a', channel: 'c', event: 'e' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'No such channel' })

    vi.unstubAllGlobals()
    mockLogsnag(500, {})
    await expect((await call('publish_event', { project: 'a', channel: 'c', event: 'e' })).json())
      .resolves.toMatchObject({
        code: 'unavailable',
        message: 'LogSnag request failed with 500',
        retryable: true,
      })
  })

  it('非 JSON 的错误体按纯文本取消息(LogSnag 边缘错误会回 HTML/文本)', async () => {
    const fn = vi.fn(() => Promise.resolve(new Response('upstream exploded', {
      status: 502,
      headers: { 'content-type': 'text/plain' },
    })))
    vi.stubGlobal('fetch', fn)
    await expect((await call('publish_event', { project: 'a', channel: 'c', event: 'e' })).json())
      .resolves.toMatchObject({ code: 'unavailable', message: 'upstream exploded' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockLogsnag(200, {})
    const res = await call('publish_event', { project: 'a', channel: 'c', event: 'e' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
