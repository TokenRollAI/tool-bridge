import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTldvPlugin } from '../../src/tldv/index'
import { tldvActions } from '../../src/tldv/schema'

/**
 * tl;dv 迁移产物的 wire 级验收。重点在:版本段拼接(`/v1alpha1` 前缀)、
 * `x-api-key` 凭证头、schema 标可选但实际必填的 `meetingId`、错误归一。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'tldv_test_key'
const plugin = createTldvPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'meetings/tldv',
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

function mockTldv(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 5 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(tldvActions).length)
    expect(tools).toHaveLength(5)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求形状', () => {
  it('list_meetings:版本段进路径,过滤器进 query,凭证走 x-api-key', async () => {
    const mock = mockTldv(200, { page: 1, total: 0, results: [] })
    await call('list_meetings', { query: 'standup', limit: 10, onlyParticipated: true, meetingType: 'internal' })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin).toBe('https://pasta.tldv.io')
    expect(url.pathname).toBe('/v1alpha1/meetings')
    expect(url.searchParams.get('query')).toBe('standup')
    expect(url.searchParams.get('limit')).toBe('10')
    expect(url.searchParams.get('onlyParticipated')).toBe('true')
    expect(url.searchParams.get('meetingType')).toBe('internal')
    // 省略的可选过滤器不该出现在 query 上。
    expect(url.searchParams.has('page')).toBe(false)
    expect(request.method).toBe('GET')
    expect(request.headers.get('x-api-key')).toBe(API_KEY)
    expect(request.headers.get('authorization')).toBeNull()
  })

  it('import_meeting:POST + JSON body,省略字段不出现', async () => {
    const mock = mockTldv(200, { success: true, jobId: 'job_1' })
    const res = await call('import_meeting', {
      name: 'Kickoff',
      url: 'https://cdn.example.com/rec.mp4',
      participants: ['a@example.com'],
    })

    const request = sent(mock)
    expect(request.url).toBe('https://pasta.tldv.io/v1alpha1/meetings/import')
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      name: 'Kickoff',
      url: 'https://cdn.example.com/rec.mp4',
      participants: ['a@example.com'],
    })
    await expect(res.json()).resolves.toMatchObject({ content: { success: true, jobId: 'job_1' } })
  })

  it('get_transcript:meetingId 被 URL 编码后拼进子路径', async () => {
    const mock = mockTldv(200, { id: 't_1', meetingId: 'm/1', data: [] })
    await call('get_transcript', { meetingId: 'm/1' })
    expect(sent(mock).url).toBe('https://pasta.tldv.io/v1alpha1/meetings/m%2F1/transcript')
  })
})

describe('校验与错误', () => {
  it('入参校验生效:limit 超上限 → 400 且不打上游', async () => {
    const mock = mockTldv(200, {})
    const res = await call('list_meetings', { limit: 500 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('meetingId 缺失 → 400 且不打上游(schema 标它可选,只能在 handler 里挡)', async () => {
    const mock = mockTldv(200, {})
    const res = await call('get_meeting', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('meetingId')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自错误体', async () => {
    mockTldv(401, { message: 'Invalid API key' })
    const denied = await call('list_meetings', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    mockTldv(429, { error: 'Too many requests' })
    await expect((await call('list_meetings', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockTldv(404, { detail: 'meeting not found' })
    await expect((await call('get_meeting', { meetingId: 'm_1' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'meeting not found' })
  })

  it('没配 authRef → 503 且不打上游', async () => {
    const mock = mockTldv(200, {})
    const res = await call('list_meetings', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
