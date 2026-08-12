import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSatismeterPlugin } from '../../src/satismeter/index'
import { satismeterActions } from '../../src/satismeter/schema'

/**
 * SatisMeter 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * base URL 带 /api/v3 前缀的相对拼接、`{data, page}` 信封拆包成各自的字段名、
 * schema 标成 optional 但上游必填的 projectId/campaignId、以及 errors[0].title 取文案。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'satismeter_test_key'
const PROJECT = '5f000000000000000000000a'
const CAMPAIGN = '5f000000000000000000000b'
const plugin = createSatismeterPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'feedback/satismeter',
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

function mockSatismeter(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 6 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(satismeterActions).length)
    expect(tools).toHaveLength(6)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
      expect(tool.effect, `${tool.name} 的 effect`).toBe('read')
    }
  })
})

describe('请求组装与信封拆包', () => {
  it('get_project:/api/v3 前缀保留,data 拆包成 project', async () => {
    const mock = mockSatismeter(200, { data: { id: PROJECT, name: 'Acme' } })
    const res = await call('get_project', { projectId: PROJECT })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    const url = new URL(request.url)
    expect(url.origin).toBe('https://app.satismeter.com')
    expect(url.pathname).toBe(`/api/v3/projects/${PROJECT}`)
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('accept')).toBe('application/json')

    await expect(res.json()).resolves.toEqual({
      content: { project: { id: PROJECT, name: 'Acme' } },
    })
  })

  it('list_surveys:打 /campaigns,data 拆包成 surveys', async () => {
    const mock = mockSatismeter(200, { data: [{ id: CAMPAIGN, name: 'NPS' }] })
    const res = await call('list_surveys', { projectId: PROJECT })
    expect(new URL(sent(mock).url).pathname).toBe(`/api/v3/projects/${PROJECT}/campaigns`)
    await expect(res.json()).resolves.toEqual({
      content: { surveys: [{ id: CAMPAIGN, name: 'NPS' }] },
    })
  })

  it('list_survey_responses:时间窗与分页进 query,data/page 分别拆包', async () => {
    const mock = mockSatismeter(200, {
      data: [{ id: 'r1' }],
      page: { nextPageCursor: 'c2', hasNextPage: true, size: 20 },
    })
    const res = await call('list_survey_responses', {
      projectId: PROJECT,
      campaignId: CAMPAIGN,
      startDate: '2024-01-01T00:00:00+00:00',
      endDate: '2024-02-01T00:00:00+00:00',
      pageCursor: 'c1',
      pageSize: 20,
    })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe(`/api/v3/projects/${PROJECT}/campaigns/${CAMPAIGN}/responses`)
    expect(url.searchParams.get('startDate')).toBe('2024-01-01T00:00:00+00:00')
    expect(url.searchParams.get('endDate')).toBe('2024-02-01T00:00:00+00:00')
    expect(url.searchParams.get('pageCursor')).toBe('c1')
    expect(url.searchParams.get('pageSize')).toBe('20')

    await expect(res.json()).resolves.toEqual({
      content: {
        responses: [{ id: 'r1' }],
        page: { nextPageCursor: 'c2', hasNextPage: true, size: 20 },
      },
    })
  })

  it('省略的可选参数不出现在 query 里', async () => {
    const mock = mockSatismeter(200, { data: [], page: {} })
    await call('list_project_responses', { projectId: PROJECT })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe(`/api/v3/projects/${PROJECT}/responses`)
    expect([...url.searchParams.keys()]).toEqual([])
  })

  it('get_survey_statistics:只透传时间窗,data 拆包成 statistics', async () => {
    const mock = mockSatismeter(200, { data: { statistics: { responses: 12 } } })
    const res = await call('get_survey_statistics', {
      projectId: PROJECT,
      campaignId: CAMPAIGN,
      startDate: '2024-01-01T00:00:00+00:00',
    })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe(`/api/v3/projects/${PROJECT}/campaigns/${CAMPAIGN}/statistics`)
    expect([...url.searchParams.keys()]).toEqual(['startDate'])
    await expect(res.json()).resolves.toEqual({
      content: { statistics: { statistics: { responses: 12 } } },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:startDate 不是 ISO 时间戳 → 400 且不打上游', async () => {
    const mock = mockSatismeter(200, {})
    const res = await call('list_project_responses', { projectId: PROJECT, startDate: 'yesterday' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('pageSize 超出 1..100 → 400 且不打上游', async () => {
    const mock = mockSatismeter(200, {})
    const res = await call('list_project_responses', { projectId: PROJECT, pageSize: 500 })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('campaignId 缺失 → 400 且不打上游(schema 把它标成了 optional)', async () => {
    const mock = mockSatismeter(200, {})
    const res = await call('get_survey', { projectId: PROJECT })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('campaignId')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 errors[0].title', async () => {
    mockSatismeter(401, { errors: [{ title: 'Invalid API key' }] })
    const denied = await call('get_project', { projectId: PROJECT })
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    mockSatismeter(429, { errors: [{ title: 'Rate limit exceeded' }] })
    await expect((await call('get_project', { projectId: PROJECT })).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    // 上游把 404 压成 400,这里保留 not_found:project 不存在与参数不合法是两件事。
    mockSatismeter(404, { errors: [{ title: 'Project not found' }] })
    expect((await call('get_project', { projectId: PROJECT })).status).toBe(404)

    mockSatismeter(500, {})
    await expect((await call('get_project', { projectId: PROJECT })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('data 不是数组 → unavailable(上游契约破了,不是调用方的错)', async () => {
    mockSatismeter(200, { data: { not: 'an array' } })
    const res = await call('list_surveys', { projectId: PROJECT })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockSatismeter(200, {})
    const res = await call('get_project', { projectId: PROJECT }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
