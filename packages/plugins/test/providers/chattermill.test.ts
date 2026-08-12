import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createChattermillPlugin } from '../../src/chattermill/index'
import { chattermillActions } from '../../src/chattermill/schema'

/**
 * Chattermill 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 资源族模板里路径段与结果键不一致(`data_sources` → `dataSources`)、
 * 驼峰过滤器换成下划线线上名、单条资源的两种信封、写入类结果取不到时给 null。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'cm_deadbeef'
const plugin = createChattermillPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'cx/chattermill',
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

function mockChattermill(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 22 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(chattermillActions).length)
    expect(tools).toHaveLength(22)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('list_projects')).toBe('read')
    expect(effectOf('get_metric')).toBe('read')
    expect(effectOf('create_response')).toBe('write')
    expect(effectOf('update_response')).toBe('write')
    expect(effectOf('delete_response')).toBe('destructive')
  })
})

describe('请求成形', () => {
  it('list_projects:GET /v1/projects,凭证走 Bearer', async () => {
    const mock = mockChattermill(200, { projects: [{ key: 'p1' }] })
    const res = await call('list_projects', {})

    const request = sent(mock)
    expect(request.url).toBe('https://api.chattermill.com/v1/projects')
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)

    await expect(res.json()).resolves.toMatchObject({
      content: { projects: [{ key: 'p1' }], raw: { projects: [{ key: 'p1' }] } },
    })
  })

  it('list_responses:驼峰过滤器换成下划线线上名', async () => {
    const mock = mockChattermill(200, { responses: [] })
    await call('list_responses', {
      project: 'proj-1',
      perPage: 50,
      dataType: 'nps',
      userMetaProperty: 'tier',
      scoreFrom: 0,
    })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v1/proj-1/responses')
    expect(url.searchParams.get('per_page')).toBe('50')
    expect(url.searchParams.get('data_type')).toBe('nps')
    expect(url.searchParams.get('user_meta_property')).toBe('tier')
    // scoreFrom=0 是有效值,但上游 queryParams 把 0 String 化后保留(只丢空串/null)。
    expect(url.searchParams.get('score_from')).toBe('0')
    expect(url.searchParams.has('perPage')).toBe(false)
  })

  it('资源族:路径段与结果键不一致时两边都对(data_sources → dataSources)', async () => {
    const mock = mockChattermill(200, { data_sources: [{ id: 'ds1' }] })
    const res = await call('list_data_sources', { project: 'proj-1' })

    expect(new URL(sent(mock).url).pathname).toBe('/v1/proj-1/data_sources')
    await expect(res.json()).resolves.toMatchObject({
      content: { dataSources: [{ id: 'ds1' }] },
    })
  })

  it('资源族 get:单条结果被包在同名键下', async () => {
    const mock = mockChattermill(200, { theme: { id: 't1', name: 'Delivery' } })
    const res = await call('get_theme', { project: 'proj-1', id: 't 1' })

    expect(new URL(sent(mock).url).pathname).toBe('/v1/proj-1/themes/t%201')
    await expect(res.json()).resolves.toMatchObject({
      content: { theme: { id: 't1', name: 'Delivery' } },
    })
  })

  it('单条资源没有信封时把整个响应当那条资源', async () => {
    mockChattermill(200, { id: 'p1', name: 'Proj' })
    await expect((await call('get_project', { id: 'p1' })).json())
      .resolves.toMatchObject({ content: { project: { id: 'p1', name: 'Proj' } } })
  })

  it('create_response:POST + {response: ...} 包一层', async () => {
    const mock = mockChattermill(200, { response: { id: 'r1' } })
    const res = await call('create_response', {
      project: 'proj-1',
      response: { comment: 'good', score: 9 },
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      response: { comment: 'good', score: 9 },
    })
    await expect(res.json()).resolves.toMatchObject({ content: { response: { id: 'r1' } } })
  })

  it('写入类结果取不到 response 时给 null(而非空对象)', async () => {
    mockChattermill(200, { ok: true })
    const body = (await (await call('update_response', {
      project: 'proj-1',
      responseId: 'r1',
      response: { score: 3 },
    })).json()) as { content: { response: unknown } }
    expect(body.content.response).toBeNull()
  })

  it('delete_response:DELETE,responseId 回原始入参(非编码后的路径段)', async () => {
    const mock = mockChattermill(200, {})
    const res = await call('delete_response', { project: 'proj-1', responseId: 'r/1' })

    const request = sent(mock)
    expect(request.method).toBe('DELETE')
    expect(new URL(request.url).pathname).toBe('/v1/proj-1/responses/r%2F1')
    await expect(res.json()).resolves.toMatchObject({
      content: { deleted: true, responseId: 'r/1' },
    })
  })

  it('列表键缺失时给空数组,不报错(空结果不是故障)', async () => {
    mockChattermill(200, { somethingElse: 1 })
    await expect((await call('list_tags', { project: 'proj-1' })).json())
      .resolves.toMatchObject({ content: { tags: [] } })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:缺必填 project → 400 且不打上游', async () => {
    const mock = mockChattermill(200, {})
    const res = await call('list_tags', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('list_responses 缺 project → 400 且不打上游(schema 里它是 optional)', async () => {
    const mock = mockChattermill(200, {})
    const res = await call('list_responses', { page: 1 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('project')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 message', async () => {
    mockChattermill(404, { message: 'Project not found' })
    await expect((await call('get_project', { id: 'nope' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'Project not found' })

    mockChattermill(401, { message: 'Invalid token' })
    expect((await call('list_projects', {})).status).toBe(401)

    mockChattermill(429, { message: 'Slow down' })
    await expect((await call('list_projects', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockChattermill(500, { message: 'Chattermill is down' })
    await expect((await call('list_projects', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockChattermill(200, { projects: [] })
    const res = await call('list_projects', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
