import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCallerapiPlugin } from '../../src/callerapi/index'
import { callerapiActions } from '../../src/callerapi/schema'

/**
 * CallerAPI 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 凭证走 x-auth 头、hlr 无论给没给都发、HTTP 200 但 body 里 status 是 error/unauthorized
 * 也算失败、402(额度耗尽)按限流归一而非参数错。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'callerapi_test_key'
const plugin = createCallerapiPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'data/callerapi',
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

function mockCallerapi(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 2 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(callerapiActions).length)
    expect(tools).toHaveLength(2)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('全部 action 都是只读', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    for (const tool of tools) expect(tool.effect, tool.name).toBe('read')
  })
})

describe('凭证与参数', () => {
  it('get_user_information:凭证走 x-auth 头,不是 Authorization', async () => {
    const mock = mockCallerapi(200, {
      status: 'success',
      email: 'ops@example.com',
      credits_left: 90,
    })
    const res = await call('get_user_information', {})

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.url).toBe('https://api.callerapi.com/api/me')
    expect(request.headers.get('x-auth')).toBe(API_KEY)
    expect(request.headers.get('authorization')).toBeNull()

    await expect(res.json()).resolves.toMatchObject({
      content: { email: 'ops@example.com', credits_left: 90 },
    })
  })

  it('get_phone_number_information:路径参数被编码,hlr 缺省也发 false', async () => {
    const mock = mockCallerapi(200, {
      status: 'success',
      data: { phone: '+15550100', is_spam: false, spam_score: 3 },
    })
    const res = await call('get_phone_number_information', { phone: '+1 555/0100' })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/lookup/%2B1%20555%2F0100')
    // 上游无论调用方给没给都发这个参数,缺省 false。
    expect(url.searchParams.get('hlr')).toBe('false')

    await expect(res.json()).resolves.toMatchObject({
      content: { data: { phone: '+15550100', spam_score: 3 } },
    })
  })

  it('hlr 给 true 时发 true', async () => {
    const mock = mockCallerapi(200, { status: 'success', data: {} })
    await call('get_phone_number_information', { phone: '+15550100', hlr: true })
    expect(new URL(sent(mock).url).searchParams.get('hlr')).toBe('true')
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:phone 给数字 → 400 且不打上游', async () => {
    const mock = mockCallerapi(200, {})
    const res = await call('get_phone_number_information', { phone: 15550100 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('phone 是纯空白 → 400 且不打上游(schema 的 min(1) 挡不住)', async () => {
    const mock = mockCallerapi(200, {})
    const res = await call('get_phone_number_information', { phone: '   ' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('phone')
    expect(mock).not.toHaveBeenCalled()
  })

  it('HTTP 200 但 body 里 status 是 unauthorized → permission_denied', async () => {
    mockCallerapi(200, { status: 'unauthorized' })
    const res = await call('get_user_information', {})
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ code: 'permission_denied' })
  })

  it('HTTP 200 但 body 里带 error 字段 → unavailable', async () => {
    mockCallerapi(200, { status: 'error', error: 'Lookup failed' })
    await expect((await call('get_phone_number_information', { phone: '+15550100' })).json())
      .resolves.toMatchObject({ code: 'unavailable', message: 'Lookup failed' })
  })

  it('402(额度耗尽)按限流归一,而不是当成参数错', async () => {
    mockCallerapi(402, { error: 'Not enough credits' })
    await expect((await call('get_phone_number_information', { phone: '+15550100' })).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true, message: 'Not enough credits' })
  })

  it('上游错误按状态归一', async () => {
    mockCallerapi(401, { error: 'Invalid API key' })
    const denied = await call('get_user_information', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    mockCallerapi(429, { error: 'Too many requests' })
    await expect((await call('get_user_information', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockCallerapi(500, { error: 'CallerAPI is down' })
    await expect((await call('get_user_information', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockCallerapi(200, {})
    const res = await call('get_user_information', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
