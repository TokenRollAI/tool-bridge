import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLivesessionPlugin } from '../../src/livesession/index'
import { livesessionActions } from '../../src/livesession/schema'

/**
 * LiveSession 迁移产物的 wire 级验收。重点在入参 camelCase → query snake_case 的重命名,
 * 以及对上游响应的强类型校验(整数字段给了别的类型就该报 unavailable,而不是往下传 NaN)。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'ls_token_deadbeef'
const plugin = createLivesessionPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'analytics/livesession',
  exportId: 'actions',
}

const OK_PAYLOAD = {
  total: 2,
  page: { num: 0, size: 25 },
  sessions: [
    {
      id: 'sess_1',
      website_id: 'web_1',
      session_url: 'https://app.livesession.io/app/sessions/sess_1',
      creation_timestamp: 1710000000,
      duration: 42,
      device: 'desktop',
      visitor: { id: 'vis_1' },
    },
  ],
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

function mockLivesession(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 1 个 action,且带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{
      effect?: string
      inputSchema?: unknown
      name: string
      outputSchema?: unknown
    }>
    expect(tools).toHaveLength(Object.keys(livesessionActions).length)
    expect(tools).toHaveLength(1)
    expect(tools[0]?.name).toBe('list_sessions')
    expect(tools[0]?.effect).toBe('read')
    expect(tools[0]?.inputSchema).toBeDefined()
    expect(tools[0]?.outputSchema).toBeDefined()
  })
})

describe('请求构造', () => {
  it('camelCase 入参映射成 LiveSession 的 snake_case query', async () => {
    const mock = mockLivesession(200, OK_PAYLOAD)
    await call('list_sessions', {
      page: 1,
      size: 50,
      email: 'ada@example.com',
      visitorId: 'vis_1',
      timezone: 'Europe/Warsaw',
      dateFrom: 'TODAY',
      dateTo: '2026-01-15T08:00:00Z',
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.livesession.io/v1/sessions')
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.get('size')).toBe('50')
    expect(url.searchParams.get('email')).toBe('ada@example.com')
    expect(url.searchParams.get('visitor_id')).toBe('vis_1')
    expect(url.searchParams.get('tz')).toBe('Europe/Warsaw')
    expect(url.searchParams.get('date_from')).toBe('TODAY')
    expect(url.searchParams.get('date_to')).toBe('2026-01-15T08:00:00Z')
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('user-agent')).toBeNull()
  })

  it('省略的可选参数不进 query', async () => {
    const mock = mockLivesession(200, OK_PAYLOAD)
    await call('list_sessions', {})
    expect(new URL(sent(mock).url).search).toBe('')
  })

  it('响应被归一成 camelCase,raw 保留完整体', async () => {
    mockLivesession(200, OK_PAYLOAD)
    await expect((await call('list_sessions', {})).json()).resolves.toMatchObject({
      content: {
        total: 2,
        page: { num: 0, size: 25 },
        sessions: [{
          id: 'sess_1',
          websiteId: 'web_1',
          sessionUrl: 'https://app.livesession.io/app/sessions/sess_1',
          creationTimestamp: 1710000000,
          duration: 42,
          device: 'desktop',
          visitor: { id: 'vis_1' },
        }],
        raw: { total: 2 },
      },
    })
  })

  it('缺失的可空字段归一成 null,而不是被丢掉', async () => {
    mockLivesession(200, { total: 1, page: { num: 0, size: 25 }, sessions: [{ id: 'sess_1' }] })
    await expect((await call('list_sessions', {})).json()).resolves.toMatchObject({
      content: {
        sessions: [{
          id: 'sess_1',
          websiteId: null,
          sessionUrl: null,
          creationTimestamp: null,
          duration: null,
          device: null,
          visitor: null,
        }],
      },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验生效:size 超过 100 → 400 且不打上游', async () => {
    const mock = mockLivesession(200, OK_PAYLOAD)
    const res = await call('list_sessions', { size: 500 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('email 不是邮箱 / dateFrom 不是合法值 → 400 且不打上游', async () => {
    const mock = mockLivesession(200, OK_PAYLOAD)
    expect((await call('list_sessions', { email: 'not-an-email' })).status).toBe(400)
    expect((await call('list_sessions', { dateFrom: 'SOMEDAY' })).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游把整数字段给成别的类型 → unavailable(上游违约)', async () => {
    mockLivesession(200, { total: '2', page: { num: 0, size: 25 }, sessions: [] })
    await expect((await call('list_sessions', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })

    mockLivesession(200, { total: 1, page: { num: 0, size: 25 }, sessions: [{ id: 42 }] })
    await expect((await call('list_sessions', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('上游错误按状态归一,两种错误体形状都认', async () => {
    mockLivesession(401, { error: 'invalid token' })
    const unauth = await call('list_sessions', {})
    expect(unauth.status).toBe(401)
    await expect(unauth.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'invalid token',
    })

    mockLivesession(429, { error: { message: 'rate limit exceeded' } })
    await expect((await call('list_sessions', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', message: 'rate limit exceeded', retryable: true })

    mockLivesession(404, { message: 'not found' })
    await expect((await call('list_sessions', {})).json())
      .resolves.toMatchObject({ code: 'not_found' })

    mockLivesession(500, { error: 'boom' })
    await expect((await call('list_sessions', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockLivesession(200, OK_PAYLOAD)
    const res = await call('list_sessions', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
