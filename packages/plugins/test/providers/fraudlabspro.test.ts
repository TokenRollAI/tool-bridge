import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFraudlabsproPlugin } from '../../src/fraudlabspro/index'
import { fraudlabsproActions } from '../../src/fraudlabspro/schema'

/**
 * FraudLabs Pro 迁移产物的 wire 级验收。重点在两处最容易迁丢的地方:
 * 凭证作为普通参数(GET 进 query、POST 进 body,不是 header),
 * 以及 HTTP 200 + 错误体的失败判定。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'FLP_TEST_KEY'
const plugin = createFraudlabsproPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'risk/fraudlabspro',
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

function mockFlp(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

function sent(mock: ReturnType<typeof vi.fn>): Request {
  return (mock.mock.calls[0] as [Request])[0]
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 3 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(fraudlabsproActions).length)
    expect(tools).toHaveLength(3)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('get_order_result')).toBe('read')
    expect(effectOf('screen_order')).toBe('write')
    expect(effectOf('feedback_order')).toBe('write')
  })
})

describe('请求成形', () => {
  it('screen_order:POST,凭证与 format 进 body,驼峰入参换成下划线线上名', async () => {
    const mock = mockFlp(200, { fraudlabspro_id: 'flp_1', fraudlabspro_score: 12 })
    const res = await call('screen_order', {
      ip: '203.0.113.9',
      userOrderId: 'ORD-1',
      firstName: 'Ada',
      amount: 99.5,
    })

    const request = sent(mock)
    expect(request.url).toBe('https://api.fraudlabspro.com/v2/order/screen')
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      key: API_KEY,
      format: 'json',
      ip: '203.0.113.9',
      user_order_id: 'ORD-1',
      first_name: 'Ada',
      amount: 99.5,
    })

    await expect(res.json()).resolves.toMatchObject({
      content: { fraudlabspro_id: 'flp_1', fraudlabspro_score: 12 },
    })
  })

  it('get_order_result:GET,凭证与 format 进 query', async () => {
    const mock = mockFlp(200, { fraudlabspro_id: 'flp_1', fraudlabspro_status: 'APPROVE' })
    await call('get_order_result', { id: 'flp_1' })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.fraudlabspro.com/v2/order/result')
    expect(request.method).toBe('GET')
    expect(url.searchParams.get('key')).toBe(API_KEY)
    expect(url.searchParams.get('format')).toBe('json')
    expect(url.searchParams.get('id')).toBe('flp_1')
    // 凭证不走 header,别顺手加了。
    expect(request.headers.get('authorization')).toBeNull()
  })

  it('省略的可选字段不进 body', async () => {
    const mock = mockFlp(200, { status: 'OK' })
    await call('feedback_order', { id: 'flp_1', action: 'APPROVE' })
    await expect(sent(mock).json()).resolves.toEqual({
      key: API_KEY,
      format: 'json',
      id: 'flp_1',
      action: 'APPROVE',
    })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:缺必填 ip → 400 且不打上游', async () => {
    const mock = mockFlp(200, {})
    const res = await call('screen_order', { email: 'a@example.com' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('action 给枚举外的值 → 400 且不打上游', async () => {
    const mock = mockFlp(200, {})
    const res = await call('feedback_order', { id: 'flp_1', action: 'MAYBE' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('HTTP 200 + 错误体也算失败(FraudLabs Pro 的常态)', async () => {
    mockFlp(200, { error: 'INVALID API LICENSE KEY' })
    const res = await call('get_order_result', { id: 'flp_1' })
    // 消息提到 license key → 归凭证问题,不是调用方参数错。
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ code: 'permission_denied' })

    mockFlp(200, { status: 'ERROR', error_message: 'Order id not found' })
    await expect((await call('get_order_result', { id: 'nope' })).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'Order id not found' })

    // 额度耗尽的消息里带 "limit",状态仍是 200,必须归成可重试的限流。
    mockFlp(200, { success: false, error_message: 'Monthly query limit exceeded' })
    await expect((await call('get_order_result', { id: 'flp_1' })).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('上游错误按状态归一', async () => {
    mockFlp(401, { error_message: 'Unauthorized' })
    expect((await call('get_order_result', { id: 'flp_1' })).status).toBe(401)

    mockFlp(429, { error_message: 'Too many requests' })
    await expect((await call('get_order_result', { id: 'flp_1' })).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockFlp(500, { error_message: 'FraudLabs Pro is down' })
    await expect((await call('get_order_result', { id: 'flp_1' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockFlp(200, {})
    const res = await call('get_order_result', { id: 'flp_1' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
