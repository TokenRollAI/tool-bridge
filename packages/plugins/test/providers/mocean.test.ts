import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMoceanPlugin } from '../../src/mocean/index'
import { moceanActions } from '../../src/mocean/schema'

/**
 * Mocean 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * mocean- 前缀参数、GET/POST 两种承载方式、必带的 resp-format=json、
 * 以及**带内 status 码**这条错误路径(HTTP 200 也可能是失败)。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'mocean_token_deadbeef'
const plugin = createMoceanPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'comms/mocean',
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

function mockMocean(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
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
    expect(tools).toHaveLength(Object.keys(moceanActions).length)
    expect(tools).toHaveLength(5)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求拼装', () => {
  it('GET 参数进 query,必带 resp-format=json,数字字符串被解析', async () => {
    const mock = mockMocean(200, { status: '0', value: '12.5' })
    const res = await call('get_balance', {})

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://rest.moceanapi.com/rest/2/account/balance')
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(url.searchParams.get('mocean-resp-format')).toBe('json')

    // 上游把 status/value 回成字符串,出参声明的是数字。
    await expect(res.json()).resolves.toEqual({ content: { status: 0, value: 12.5 } })
  })

  it('list_pricing 的过滤器带 mocean- 前缀', async () => {
    const mock = mockMocean(200, {
      status: 0,
      destinations: [{ country: 'MY', operator: 'Maxis', mcc: '502', mnc: '12', price: 0.05, currency: 'USD' }],
    })
    const res = await call('list_pricing', { type: 'sms', mcc: '502', mnc: '12' })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/rest/2/account/pricing')
    expect(url.searchParams.get('mocean-type')).toBe('sms')
    expect(url.searchParams.get('mocean-mcc')).toBe('502')
    expect(url.searchParams.get('mocean-mnc')).toBe('12')

    // price 上游回数字,出参声明的是字符串。
    await expect(res.json()).resolves.toMatchObject({
      content: { destinations: [{ price: '0.05', currency: 'USD' }] },
    })
  })

  it('send_sms:POST form-encoded,给了回调地址才带 dlr-mask', async () => {
    const mock = mockMocean(200, { messages: [{ status: 0, receiver: '60123456789', msgid: 'msg_1' }] })
    const res = await call('send_sms', {
      from: 'Acme',
      to: '60123456789',
      text: 'hello',
      deliveryReportUrl: 'https://hooks.example.com/dlr',
    })

    const request = sent(mock)
    expect(request.url).toBe('https://rest.moceanapi.com/rest/2/sms')
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded;charset=UTF-8')
    const body = new URLSearchParams(await request.text())
    expect(body.get('mocean-resp-format')).toBe('json')
    expect(body.get('mocean-from')).toBe('Acme')
    expect(body.get('mocean-to')).toBe('60123456789')
    expect(body.get('mocean-text')).toBe('hello')
    expect(body.get('mocean-dlr-mask')).toBe('1')
    expect(body.get('mocean-dlr-url')).toBe('https://hooks.example.com/dlr')

    await expect(res.json()).resolves.toEqual({
      content: { messages: [{ status: 0, receiver: '60123456789', messageId: 'msg_1' }] },
    })
  })

  it('没给回调地址就不带 dlr-mask(不该无端要求上游回执)', async () => {
    const mock = mockMocean(200, { messages: [] })
    await call('send_sms', { from: 'Acme', to: '60123456789', text: 'hi' })
    const body = new URLSearchParams(await sent(mock).text())
    expect(body.has('mocean-dlr-mask')).toBe(false)
    expect(body.has('mocean-dlr-url')).toBe(false)
  })

  it('lookup_number:字段别名与枚举外的 ported 值', async () => {
    mockMocean(200, {
      status: 0,
      message_id: 12345,
      to: '60123456789',
      current_carrier: { country: 'MY', carrier: 'Maxis', network_code: '50212' },
      ported: 'MAYBE',
    })
    const res = await call('lookup_number', { to: '60123456789' })
    // msgid 缺失时回落到 message_id;carrier 别名取到 name;枚举外的 ported 被省略。
    await expect(res.json()).resolves.toEqual({
      content: {
        status: 0,
        messageId: '12345',
        to: '60123456789',
        currentCarrier: { country: 'MY', name: 'Maxis', networkCode: '50212' },
      },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:send_sms 缺 text → 400 且不打上游', async () => {
    const mock = mockMocean(200, {})
    const res = await call('send_sms', { from: 'Acme', to: '60123456789' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('mcc 与 mnc 必须同时给(schema 表达不了的跨字段约束)', async () => {
    const mock = mockMocean(200, {})
    const res = await call('list_pricing', { mcc: '502' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('mnc')
    expect(mock).not.toHaveBeenCalled()
  })

  it('HTTP 200 + 带内 status:1 是鉴权失败,不能当数据收下', async () => {
    mockMocean(200, { status: 1, err_msg: 'Authentication failed' })
    const res = await call('get_balance', {})
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Authentication failed',
    })
  })

  it('带内 status:32 归一成可重试的限流', async () => {
    mockMocean(200, { status: 32, err_msg: 'Rate limit exceeded' })
    await expect((await call('get_balance', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('HTTP 层的错误状态同样归一', async () => {
    mockMocean(401, { err_msg: 'Invalid token' })
    expect((await call('get_balance', {})).status).toBe(401)

    mockMocean(429, { err_msg: 'Slow down' })
    await expect((await call('get_balance', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockMocean(500, { err_msg: 'Mocean is down' })
    await expect((await call('get_balance', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockMocean(200, { status: 0, value: 1 })
    const res = await call('get_balance', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
