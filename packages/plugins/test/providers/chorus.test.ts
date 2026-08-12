import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createChorusPlugin } from '../../src/chorus/index'
import { chorusActions } from '../../src/chorus/schema'

/**
 * Chorus 迁移产物的 wire 级验收。重点:raw Authorization(无 Bearer 前缀)、
 * 两套 API 的 Accept 头之别、camelCase → snake_case / 方括号参数的映射、JSON:API 的 data 拆包。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'chorus_test_deadbeef'
const plugin = createChorusPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'sales/chorus',
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

function mockChorus(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(
    typeof payload === 'string' ? payload : JSON.stringify(payload),
    { status, headers: { 'content-type': 'application/json' } },
  )))
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
  it('List 出全部 6 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(chorusActions).length)
    expect(tools).toHaveLength(6)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求整形', () => {
  it('get_current_user 走 JSON:API Accept,凭证是 raw Authorization,响应从 data 拆包', async () => {
    const mock = mockChorus(200, { data: { id: 'u1', type: 'user', attributes: { email: 'a@b.c' } } })
    const res = await call('get_current_user', {})

    const request = sent(mock)
    expect(request.url).toBe('https://chorus.ai/api/v1/users/me')
    // Bearer 前缀会让 Chorus 直接 401 —— 它收 raw token。
    expect(request.headers.get('authorization')).toBe(API_KEY)
    expect(request.headers.get('accept')).toBe('application/vnd.api+json')

    await expect(res.json()).resolves.toEqual({
      content: { user: { id: 'u1', type: 'user', attributes: { email: 'a@b.c' } } },
    })
  })

  it('list_engagements 走普通 JSON Accept,camelCase 映射成 snake_case,数组折成逗号串', async () => {
    const mock = mockChorus(200, {
      engagements: [{ engagement_id: 'e1' }],
      continuation_key: 'ck_next',
    })
    const res = await call('list_engagements', {
      engagementIds: ['e1', 'e2'],
      teamIds: [10, 20],
      dispositionConnected: false,
      minDuration: 0,
      participantsEmail: 'rep@example.com',
    })

    const request = sent(mock)
    expect(request.headers.get('accept')).toBe('application/json')
    const url = new URL(request.url)
    expect(url.pathname).toBe('/v3/engagements')
    expect(url.searchParams.get('engagement_id')).toBe('e1,e2')
    expect(url.searchParams.get('team_id')).toBe('10,20')
    // false 与 0 都是有意义的过滤值,不能被 falsy 判断吃掉。
    expect(url.searchParams.get('disposition_connected')).toBe('false')
    expect(url.searchParams.get('min_duration')).toBe('0')
    expect(url.searchParams.get('participants_email')).toBe('rep@example.com')
    expect(url.searchParams.has('compliance')).toBe(false)

    await expect(res.json()).resolves.toEqual({
      content: { engagements: [{ engagement_id: 'e1' }], continuationKey: 'ck_next' },
    })
  })

  it('list_engagements 没有下一页时 continuationKey 明确为 null', async () => {
    mockChorus(200, { engagements: [] })
    await expect((await call('list_engagements', {})).json())
      .resolves.toEqual({ content: { engagements: [], continuationKey: null } })
  })

  it('list_scorecards 用 JSON:API 的方括号参数名', async () => {
    const mock = mockChorus(200, { data: [] })
    await call('list_scorecards', {
      recipientIds: [1, 2],
      initiativeId: 7,
      pageSize: 50,
      pageNumber: 2,
    })

    const url = new URL(sent(mock).url)
    expect(url.searchParams.get('filter[recipients]')).toBe('1,2')
    expect(url.searchParams.get('filter[initiative]')).toBe('7')
    expect(url.searchParams.get('page[size]')).toBe('50')
    expect(url.searchParams.get('page[number]')).toBe('2')
    expect(url.searchParams.has('filter[reviewers]')).toBe(false)
  })

  it('get_conversation / get_team 的路径参数被 URL 编码', async () => {
    const conversations = mockChorus(200, { data: { id: 'c/1' } })
    await call('get_conversation', { id: 'c/1', fields: ['name', 'owner'] })
    const url = new URL(sent(conversations).url)
    expect(url.pathname).toBe('/api/v1/conversations/c%2F1')
    expect(url.searchParams.get('fields')).toBe('name,owner')
    vi.unstubAllGlobals()

    const teams = mockChorus(200, { data: { id: 't 1' } })
    await call('get_team', { id: 't 1' })
    expect(new URL(sent(teams).url).pathname).toBe('/api/v1/teams/t%201')
  })
})

describe('校验与错误', () => {
  it('入参校验生效:pageSize 超上限 → 400 且不打上游', async () => {
    const mock = mockChorus(200, {})
    const res = await call('list_scorecards', { pageSize: 200 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('get_team 的 id 在生成的 schema 里是 optional,缺失时在拼路径前被挡下', async () => {
    const mock = mockChorus(200, { data: {} })
    const res = await call('get_team', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('id')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,JSON:API 的 errors[0].detail 也能读出来', async () => {
    mockChorus(401, { errors: [{ title: 'Unauthorized', detail: 'invalid api token' }] })
    await expect((await call('list_teams', {})).json())
      .resolves.toMatchObject({ code: 'permission_denied', message: 'invalid api token' })

    mockChorus(429, { message: 'too many requests' })
    await expect((await call('list_teams', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockChorus(404, { detail: 'team not found' })
    await expect((await call('get_team', { id: 't9' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'team not found' })

    mockChorus(503, '<html>gateway</html>')
    await expect((await call('list_teams', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', message: '<html>gateway</html>', retryable: true })
  })

  it('JSON:API 响应缺 data → unavailable(是上游坏了)', async () => {
    mockChorus(200, { meta: {} })
    await expect((await call('list_teams', {})).json())
      .resolves.toMatchObject({ code: 'unavailable' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockChorus(200, { data: [] })
    const res = await call('list_teams', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
