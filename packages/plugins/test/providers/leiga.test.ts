import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLeigaPlugin } from '../../src/leiga/index'
import { leigaActions } from '../../src/leiga/schema'

/**
 * Leiga 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * `{code,msg,data}` 信封的成功判定(HTTP 200 也可能是失败)、accessToken 头、
 * base URL 里 /openapi/api 前缀不能被 `new URL` 吃掉、GET query 与 POST body 的分工。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'leiga_deadbeef'
const plugin = createLeigaPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'pm/leiga',
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

function mockLeiga(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

const PROJECT = { id: 12, pname: 'Core', pkey: 'CORE', archived: 0 }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 6 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(leigaActions).length)
    expect(tools).toHaveLength(6)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('全部 action 都是 read', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string }>
    expect(tools.every(t => t.effect === 'read')).toBe(true)
  })
})

describe('请求成形', () => {
  it('list_projects:GET + query,凭证走 accessToken 头,base 路径前缀保留', async () => {
    const mock = mockLeiga(200, { code: '0', data: [PROJECT] })
    const res = await call('list_projects', { pkey: 'CORE', archived: 0 })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://app.leiga.com/openapi/api/project/list')
    expect(request.method).toBe('GET')
    expect(request.headers.get('accesstoken')).toBe(API_KEY)
    expect(url.searchParams.get('pkey')).toBe('CORE')
    // archived=0 是有效值,不能被真值判断吃掉。
    expect(url.searchParams.get('archived')).toBe('0')
    expect(url.searchParams.has('pname')).toBe(false)

    await expect(res.json()).resolves.toMatchObject({
      content: { total: 1, projects: [{ id: 12, pname: 'Core', pkey: 'CORE', archived: 0 }] },
    })
  })

  it('list_issues:POST + JSON body,省略的可选字段不进 body', async () => {
    const mock = mockLeiga(200, {
      code: '0',
      data: { total: 3, list: [{ issueNo: 'CORE-1', summary: 'Fix it' }] },
    })
    const res = await call('list_issues', {
      projectId: 12,
      pageNumber: 1,
      pageSize: 20,
      statusTypes: [1, 2],
    })

    const request = sent(mock)
    expect(new URL(request.url).pathname).toBe('/openapi/api/issue/page')
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      projectId: 12,
      pageNumber: 1,
      pageSize: 20,
      statusTypes: [1, 2],
    })

    await expect(res.json()).resolves.toMatchObject({
      content: { total: 3, issues: [{ issueNo: 'CORE-1', summary: 'Fix it' }] },
    })
  })

  it('get_project:数字 projectId 进 query', async () => {
    const mock = mockLeiga(200, { code: '0', data: PROJECT })
    await call('get_project', { projectId: 12 })
    expect(new URL(sent(mock).url).searchParams.get('projectId')).toBe('12')
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:pageSize 给字符串 → 400 且不打上游', async () => {
    const mock = mockLeiga(200, {})
    const res = await call('list_issues', { projectId: 12, pageNumber: 1, pageSize: 'many' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('get_project 缺 projectId → 400 且不打上游(schema 里它是 optional)', async () => {
    const mock = mockLeiga(200, {})
    const res = await call('get_project', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('projectId')
    expect(mock).not.toHaveBeenCalled()
  })

  it('HTTP 200 但 code 非 0 → 按 code 归一(Leiga 的信封失败)', async () => {
    mockLeiga(200, { code: '404', msg: 'project not found' })
    await expect((await call('get_project', { projectId: 999 })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'project not found' })

    // code 不像 HTTP 状态时一律按 400。
    mockLeiga(200, { code: 'E_BAD', msg: 'bad request' })
    await expect((await call('list_projects', {})).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'bad request' })
  })

  it('上游错误按状态归一,消息取自 msg', async () => {
    mockLeiga(401, { msg: 'invalid accessToken' })
    const unauth = await call('list_projects', {})
    expect(unauth.status).toBe(401)
    await expect(unauth.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'invalid accessToken',
    })

    mockLeiga(429, { msg: 'too many requests' })
    await expect((await call('list_projects', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockLeiga(500, { msg: 'Leiga is down' })
    await expect((await call('list_projects', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockLeiga(200, { code: '0', data: [] })
    const res = await call('list_projects', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
