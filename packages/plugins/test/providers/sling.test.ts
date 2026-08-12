import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSlingPlugin } from '../../src/sling/index'
import { slingActions } from '../../src/sling/schema'

/**
 * Sling 迁移产物的 wire 级验收。重点在裸 token 授权头、多值过滤器的逗号拼接、
 * `pageSize` → `pagesize` 的键改名,以及纯文本错误体的消息提取。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'sling_token_deadbeef'
const plugin = createSlingPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'hr/sling',
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

function mockSling(status: number, payload: unknown, contentType = 'application/json'): ReturnType<typeof vi.fn> {
  const body = contentType === 'application/json' ? JSON.stringify(payload) : String(payload)
  const fn = vi.fn(() => Promise.resolve(new Response(body, {
    status,
    headers: { 'content-type': contentType },
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
  it('List 出全部 14 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(slingActions).length)
    expect(tools).toHaveLength(14)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('全部 action 都是 read(这个 provider 只有查询能力)', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string }>
    expect(tools.every(t => t.effect === 'read')).toBe(true)
  })
})

describe('请求成形', () => {
  it('凭证是裸 token(无 Bearer 前缀),响应套进具名键', async () => {
    const mock = mockSling(200, { user: { id: 1 }, orgId: 9 })
    const res = await call('get_current_session', {})

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(API_KEY)
    expect(request.url).toBe('https://api.getsling.com/v1/account/session')
    await expect(res.json()).resolves.toEqual({
      content: { session: { user: { id: 1 }, orgId: 9 } },
    })
  })

  it('多值过滤器逗号拼接,不是重复同名键', async () => {
    const mock = mockSling(200, [])
    await call('list_calendar_events', {
      orgId: 5,
      userId: 7,
      dates: '2026-06-24/2026-06-30',
      locationIds: [1, 2, 3],
      eventTypes: ['shift', 'timeoff'],
      skipUnscheduled: true,
      page: 0,
    })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v1/calendar/5/users/7')
    expect(url.searchParams.get('dates')).toBe('2026-06-24/2026-06-30')
    expect(url.searchParams.get('locationIds')).toBe('1,2,3')
    expect(url.searchParams.get('eventTypes')).toBe('shift,timeoff')
    expect(url.searchParams.get('skipUnscheduled')).toBe('true')
    expect(url.searchParams.get('page')).toBe('0')
    expect(url.searchParams.has('positionIds')).toBe(false)
  })

  it('list_tasks 的 pageSize 送出时改名成官方的 pagesize', async () => {
    const mock = mockSling(200, [])
    await call('list_tasks', { pageSize: 25, filter: 'open', since: 100 })
    const url = new URL(sent(mock).url)
    expect(url.searchParams.get('pagesize')).toBe('25')
    expect(url.searchParams.has('pageSize')).toBe(false)
    expect(url.searchParams.get('filter')).toBe('open')
    expect(url.searchParams.get('since')).toBe('100')
  })

  it('路径 id 被 URL 编码', async () => {
    const mock = mockSling(200, {})
    await call('list_shift_coworkers', { shiftId: 'sh/1' })
    expect(new URL(sent(mock).url).pathname).toBe('/v1/shifts/sh%2F1/coworkers')
  })

  it('空响应体归一成 {},出参形状仍稳定', async () => {
    mockSling(200, '', 'text/plain')
    const res = await call('get_current_shift', {})
    await expect(res.json()).resolves.toEqual({ content: { shift: {} } })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:list_calendar_events 缺必填 dates → 400 且不打上游', async () => {
    const mock = mockSling(200, [])
    const res = await call('list_calendar_events', { orgId: 1, userId: 2 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('get_user 缺 userId → 400 且不打上游(schema 把它标成了可选)', async () => {
    const mock = mockSling(200, {})
    const res = await call('get_user', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('userId')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,纯文本错误体也取得出消息', async () => {
    mockSling(401, { message: 'Invalid token' })
    const denied = await call('list_users', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid token',
    })

    mockSling(429, 'Too Many Requests', 'text/plain')
    await expect((await call('list_users', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true, message: 'Too Many Requests' })

    mockSling(404, { error: 'shift not found' })
    await expect((await call('get_shift', { shiftId: 'missing' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'shift not found' })

    mockSling(502, {})
    await expect((await call('list_users', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('成功响应不是合法 JSON → unavailable(上游破契约,不是入参错)', async () => {
    mockSling(200, '<html>oops</html>', 'text/html')
    const res = await call('list_users', {})
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockSling(200, [])
    const res = await call('list_users', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
