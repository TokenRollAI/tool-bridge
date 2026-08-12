import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRealphonevalidationPlugin } from '../../src/realphonevalidation/index'
import { realphonevalidationActions } from '../../src/realphonevalidation/schema'

/**
 * RealPhoneValidation 迁移产物的 wire 级验收。重点在两个上游怪异:凭证进 query,
 * 以及"HTTP 200 但 status 字段表示失败"的分流(含 403 = 限流而非无权)。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'rpv_test_token'
const plugin = createRealphonevalidationPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'data/realphonevalidation',
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

function mockRpv(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 2 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(realphonevalidationActions).length)
    expect(tools).toHaveLength(2)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('两个 action 都消耗配额,effect 是 write 而非 read', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string }>
    expect(tools.every(tool => tool.effect === 'write')).toBe(true)
  })
})

describe('请求构造', () => {
  it('凭证与号码都进 query,输出格式固定为 json', async () => {
    const mock = mockRpv(200, { status: 'connected', error_text: '', phone_type: 'Mobile' })
    await call('validate_phone_standard', { phone: '7275555555' })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.realvalidation.com/rpvWebService/Turbo.php')
    expect(url.searchParams.get('output')).toBe('json')
    expect(url.searchParams.get('phone')).toBe('7275555555')
    // 上游没有 header 形式的凭证,只能进 query。
    expect(url.searchParams.get('token')).toBe(API_KEY)
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBeNull()
  })

  it('v3 打的是 TurboV3.php,并多返回三个富化字段', async () => {
    const mock = mockRpv(200, {
      status: 'connected',
      error_text: {},
      phone_type: 'Mobile',
      caller_name: 'Ada Lovelace',
      carrier: 'Verizon',
      caller_type: 'Consumer',
    })
    const res = await call('validate_phone_v3', { phone: '7275555555' })
    expect(new URL(sent(mock).url).pathname).toBe('/rpvWebService/TurboV3.php')
    await expect(res.json()).resolves.toEqual({
      content: {
        status: 'connected',
        // error_text 是空对象时归成 null。
        error_text: null,
        phone_type: 'Mobile',
        caller_name: 'Ada Lovelace',
        carrier: 'Verizon',
        caller_type: 'Consumer',
      },
    })
  })

  it('standard 不返回富化字段', async () => {
    mockRpv(200, { status: 'connected', phone_type: 'Landline', caller_name: 'ignored' })
    await expect((await call('validate_phone_standard', { phone: '7275555555' })).json())
      .resolves.toEqual({ content: { status: 'connected', error_text: null, phone_type: 'Landline' } })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:号码不是 10 位数字 → 400 且不打上游', async () => {
    const mock = mockRpv(200, {})
    const res = await call('validate_phone_standard', { phone: '+1 727 555 5555' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('HTTP 200 但 status 表示失败时也归成对应的错误码', async () => {
    mockRpv(200, { status: 'unauthorized', error_text: 'token is not valid' })
    const denied = await call('validate_phone_standard', { phone: '7275555555' })
    expect(denied.status).toBe(403)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'token is not valid',
    })
    vi.unstubAllGlobals()

    mockRpv(200, { status: 'invalid-phone', error_text: 'bad phone number' })
    await expect((await call('validate_phone_standard', { phone: '0000000000' })).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'bad phone number' })
    vi.unstubAllGlobals()

    mockRpv(200, { status: 'server-unavailable', error_text: 'try later' })
    await expect((await call('validate_phone_standard', { phone: '7275555555' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('HTTP 403 在这个上游表示限流,不是无权', async () => {
    mockRpv(403, {})
    const res = await call('validate_phone_standard', { phone: '7275555555' })
    await expect(res.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('HTTP 401 / 429 / 5xx 按常规归一', async () => {
    mockRpv(401, { error_text: 'missing token' })
    expect((await call('validate_phone_standard', { phone: '7275555555' })).status).toBe(401)
    vi.unstubAllGlobals()

    mockRpv(429, { error_text: 'slow down' })
    await expect((await call('validate_phone_standard', { phone: '7275555555' })).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })
    vi.unstubAllGlobals()

    mockRpv(500, {})
    await expect((await call('validate_phone_standard', { phone: '7275555555' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockRpv(200, {})
    const res = await call('validate_phone_standard', { phone: '7275555555' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
