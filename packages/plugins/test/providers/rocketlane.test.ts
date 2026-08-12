import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRocketlanePlugin } from '../../src/rocketlane/index'
import { rocketlaneActions } from '../../src/rocketlane/schema'

/**
 * Rocketlane 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 带点号的过滤器键名、数组值逗号拼接、`api-key` 头、list 信封的整形。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'rl_test_deadbeef'
const plugin = createRocketlanePlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'pm/rocketlane',
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

function mockRocketlane(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(rocketlaneActions).length)
    expect(tools).toHaveLength(6)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('全部 action 都是只读', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string }>
    expect(tools.every(t => t.effect === 'read')).toBe(true)
  })
})

describe('请求成形', () => {
  it('list_projects:过滤器键名带点号,数组逗号拼接,凭证走 api-key 头', async () => {
    const mock = mockRocketlane(200, { data: [{ projectId: 1 }], pagination: { hasMore: false } })
    const res = await call('list_projects', {
      pageSize: 20,
      projectNameContains: 'onboard',
      statusOneOf: ['ACTIVE', 'PAUSED'],
      includeFields: ['projectFee', 'billableHours'],
      startDateGt: '2026-01-01',
      customerIdEq: 7,
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.rocketlane.com/api/1.0/projects')
    expect(request.method).toBe('GET')
    expect(request.headers.get('api-key')).toBe(API_KEY)
    // 凭证走自定义头,不是 Authorization。
    expect(request.headers.get('authorization')).toBeNull()
    expect(url.searchParams.get('pageSize')).toBe('20')
    expect(url.searchParams.get('projectName.cn')).toBe('onboard')
    expect(url.searchParams.get('status.oneOf')).toBe('ACTIVE,PAUSED')
    expect(url.searchParams.get('includeFields')).toBe('projectFee,billableHours')
    expect(url.searchParams.get('startDate.gt')).toBe('2026-01-01')
    expect(url.searchParams.get('customerId.eq')).toBe('7')

    await expect(res.json()).resolves.toEqual({
      content: { projects: [{ projectId: 1 }], pagination: { hasMore: false } },
    })
  })

  it('省略的可选过滤器不出现在 query 里', async () => {
    const mock = mockRocketlane(200, { data: [], pagination: {} })
    await call('list_tasks', { pageSize: 5 })
    expect([...new URL(sent(mock).url).searchParams.keys()]).toEqual(['pageSize'])
  })

  it('list_tasks 的状态过滤器走 task.status 前缀(与 projects 不同形)', async () => {
    const mock = mockRocketlane(200, { data: [], pagination: {} })
    await call('list_tasks', { taskStatusEq: 'DONE', atRiskEq: true, projectIdEq: 3 })
    const params = new URL(sent(mock).url).searchParams
    expect(params.get('task.status.eq')).toBe('DONE')
    expect(params.get('atRisk.eq')).toBe('true')
    expect(params.get('projectId.eq')).toBe('3')
  })

  it('get_user:路径带数字 id,响应包成 {user}', async () => {
    const mock = mockRocketlane(200, { userId: 42, email: 'a@example.com' })
    const res = await call('get_user', { userId: 42, includeFields: ['role'] })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/1.0/users/42')
    expect(url.searchParams.get('includeFields')).toBe('role')
    await expect(res.json()).resolves.toEqual({
      content: { user: { userId: 42, email: 'a@example.com' } },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:projectId 为 0 → 400 且不打上游', async () => {
    const mock = mockRocketlane(200, {})
    const res = await call('get_project', { projectId: 0 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('strictObject 拒绝未声明字段(不静默丢弃调用方的意图)', async () => {
    const mock = mockRocketlane(200, {})
    const res = await call('list_users', { unknownFilter: 'x' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 errorMessage / errors[]', async () => {
    mockRocketlane(401, { errorMessage: 'Invalid API key' })
    const unauthorized = await call('list_users', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    vi.unstubAllGlobals()
    mockRocketlane(429, { errors: [{ message: 'Too many requests' }] })
    await expect((await call('list_users', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true, message: 'Too many requests' })

    vi.unstubAllGlobals()
    mockRocketlane(404, { message: 'Project not found' })
    await expect((await call('get_project', { projectId: 9 })).json())
      .resolves.toMatchObject({ code: 'not_found' })

    vi.unstubAllGlobals()
    // 上游 execute 分支把 5xx 压成 502;迁移后交回 upstreamError,5xx 一律 unavailable + retryable。
    mockRocketlane(500, {})
    await expect((await call('list_users', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('list 信封缺 data 时按上游破契约处理,而不是回一个空列表', async () => {
    mockRocketlane(200, { pagination: {} })
    await expect((await call('list_users', {})).json())
      .resolves.toMatchObject({ code: 'unavailable' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockRocketlane(200, {})
    const res = await call('list_users', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
