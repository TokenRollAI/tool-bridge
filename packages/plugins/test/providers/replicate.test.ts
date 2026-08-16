import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createReplicatePlugin } from '../../src/replicate/index'
import { replicateActions } from '../../src/replicate/schema'

/**
 * Replicate 迁移产物的 wire 级验收。重点钉住几处"迁移最容易迁丢"的地方:
 * schema 说可选但拼进路径的字段必须在本地被拦下、create_prediction 的两个**请求头**参数、
 * 分页 results → 领域名的改名、以及上游把 403/404 压成别的码这件事在这里被分开。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'r8_testdeadbeef'
const plugin = createReplicatePlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'ai/replicate',
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

function mockReplicate(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

/** 一页分页响应。 */
function page(results: unknown[], next: string | null = null): Record<string, unknown> {
  return { results, next, previous: null }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 11 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(replicateActions).length)
    expect(tools).toHaveLength(11)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'cancel_prediction',
      'create_prediction',
      'get_account',
      'get_collection',
      'get_model',
      'get_model_version',
      'get_prediction',
      'list_collections',
      'list_model_versions',
      'list_models',
      'list_predictions',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('~describe 报成单个 tools/v1 export,并带上探针工具名', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    await expect(res.json()).resolves.toEqual({
      protocolVersion: 'plugin/v2',
      exports: [{
        auth: { kind: 'single', required: true },
        id: 'actions',
        profile: 'tools/v1',
        description: 'Replicate',
        credentialProbe: 'get_account',
      }],
    })
  })

  it('探针指向的工具确实存在、只读、且无必填入参(平台挂载时会空参调它)', () => {
    const spec = replicateActions.get_account
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })
})

describe('请求拼装', () => {
  it('get_account:GET /v1/account,凭证走 Authorization: Bearer', async () => {
    const mock = mockReplicate(200, { username: 'acme', type: 'organization' })
    const res = await call('get_account', {})

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.url).toBe('https://api.replicate.com/v1/account')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('accept')).toBe('application/json')
    // GET 不该带 content-type(上游只在有 body 时才设)。
    expect(request.headers.get('content-type')).toBeNull()
    await expect(res.json()).resolves.toEqual({
      content: { account: { username: 'acme', type: 'organization' } },
    })
  })

  it('list_models:驼峰入参映射成蛇形 query', async () => {
    const mock = mockReplicate(200, page([]))
    await call('list_models', { sortBy: 'model_created_at', sortDirection: 'desc' })
    expect(Object.fromEntries(new URL(sent(mock).url).searchParams)).toEqual({
      sort_by: 'model_created_at',
      sort_direction: 'desc',
    })
  })

  it('路径段被 URL 编码,且先去空白', async () => {
    const mock = mockReplicate(200, { id: 'v1' })
    await call('get_model_version', { owner: ' acme ', model: 'my model', versionId: 'a/b' })
    expect(new URL(sent(mock).url).pathname).toBe('/v1/models/acme/my%20model/versions/a%2Fb')
  })

  it('create_prediction:waitSeconds → Prefer 头,cancelAfter → Cancel-After 头,都不进 body', async () => {
    const mock = mockReplicate(201, { id: 'p1', status: 'starting' })
    await call('create_prediction', {
      version: 'abc123',
      input: { prompt: 'a cat' },
      waitSeconds: 30,
      cancelAfter: ' 5m ',
      webhook: 'https://hooks.example/replicate',
      webhookEventsFilter: ['start', 'completed'],
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/v1/predictions')
    expect(request.headers.get('prefer')).toBe('wait=30')
    expect(request.headers.get('cancel-after')).toBe('5m')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      version: 'abc123',
      input: { prompt: 'a cat' },
      webhook: 'https://hooks.example/replicate',
      webhook_events_filter: ['start', 'completed'],
    })
  })

  it('create_prediction 不给可选项时既不发头也不发对应 body 字段', async () => {
    const mock = mockReplicate(201, { id: 'p1' })
    await call('create_prediction', { version: 'abc123', input: {} })

    const request = sent(mock)
    expect(request.headers.get('prefer')).toBeNull()
    expect(request.headers.get('cancel-after')).toBeNull()
    await expect(request.json()).resolves.toEqual({ version: 'abc123', input: {} })
  })

  it('cancel_prediction 是 POST + 空 JSON body(少了它 content-type 也不会带)', async () => {
    const mock = mockReplicate(200, { id: 'p1', status: 'canceled' })
    await call('cancel_prediction', { predictionId: 'p1' })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/v1/predictions/p1/cancel')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({})
  })

  it('list_predictions 的空白时间戳不发出去(上游会把空串当成非法时间戳)', async () => {
    const mock = mockReplicate(200, page([]))
    await call('list_predictions', { createdAfter: '2024-01-01T00:00:00Z', source: 'web' })
    expect(Object.fromEntries(new URL(sent(mock).url).searchParams)).toEqual({
      created_after: '2024-01-01T00:00:00Z',
      source: 'web',
    })
  })
})

describe('响应整形', () => {
  it('分页把 results 改名成领域名,并保留 next / previous', async () => {
    mockReplicate(200, { results: [{ name: 'flux' }], next: 'https://api.replicate.com/v1/models?cursor=x' })
    await expect((await call('list_models', {})).json()).resolves.toEqual({
      content: {
        models: [{ name: 'flux' }],
        next: 'https://api.replicate.com/v1/models?cursor=x',
        previous: null,
      },
    })
  })

  it('每个列表 action 用自己的领域名(versions / collections / predictions)', async () => {
    mockReplicate(200, page([{ id: 'v1' }]))
    await expect((await call('list_model_versions', { owner: 'a', model: 'b' })).json())
      .resolves.toEqual({ content: { versions: [{ id: 'v1' }], next: null, previous: null } })

    vi.unstubAllGlobals()
    mockReplicate(200, page([{ slug: 'c' }]))
    await expect((await call('list_collections', {})).json())
      .resolves.toEqual({ content: { collections: [{ slug: 'c' }], next: null, previous: null } })

    vi.unstubAllGlobals()
    mockReplicate(200, page([{ id: 'p' }]))
    await expect((await call('list_predictions', {})).json())
      .resolves.toEqual({ content: { predictions: [{ id: 'p' }], next: null, previous: null } })
  })

  it('next / previous 不是字符串时记 null(上游会回 null,别原样透出别的类型)', async () => {
    mockReplicate(200, { results: [], next: 42, previous: null })
    await expect((await call('list_models', {})).json())
      .resolves.toMatchObject({ content: { next: null, previous: null } })
  })

  it('分页响应缺 results 数组 → unavailable + retryable(形状不符契约是上游的问题)', async () => {
    mockReplicate(200, { models: [] })
    const res = await call('list_models', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('空响应体记成 {}(cancel 之类可能不回内容)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 200 }))))
    await expect((await call('cancel_prediction', { predictionId: 'p1' })).json())
      .resolves.toEqual({ content: { prediction: {} } })
  })
})

describe('校验与错误', () => {
  it('schema 说可选、但要拼进路径的字段缺失时在本地就挡下,不打上游', async () => {
    for (const [name, args] of [
      ['get_model', { model: 'b' }],
      ['get_model_version', { owner: 'a', model: 'b' }],
      ['get_collection', {}],
      ['get_prediction', {}],
      ['cancel_prediction', {}],
    ] as const) {
      vi.unstubAllGlobals()
      const mock = mockReplicate(200, {})
      const res = await call(name, args)
      expect(res.status, `${name} 应当被本地拦下`).toBe(400)
      expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
      expect(mock, `${name} 不该打上游`).not.toHaveBeenCalled()
    }
  })

  it('纯空白的路径段等同缺失(上游 requiredString 是 trim 后判空)', async () => {
    const mock = mockReplicate(200, {})
    const res = await call('get_prediction', { predictionId: '   ' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('predictionId')
    expect(mock).not.toHaveBeenCalled()
  })

  it('入参校验真的生效:waitSeconds 越界 / 未声明字段 → 400 且不打上游', async () => {
    const mock = mockReplicate(200, {})
    expect((await call('create_prediction', { version: 'v', input: {}, waitSeconds: 120 })).status).toBe(400)
    expect((await call('list_models', { sortBy: 'nope' })).status).toBe(400)
    expect((await call('get_account', { nope: 1 })).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误的消息取自 detail,退回 title', async () => {
    mockReplicate(422, { detail: 'Invalid version or not permitted' })
    const invalid = await call('create_prediction', { version: 'v', input: {} })
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'Invalid version or not permitted',
    })

    vi.unstubAllGlobals()
    mockReplicate(400, { title: 'Bad request' })
    await expect((await call('create_prediction', { version: 'v', input: {} })).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'Bad request' })
  })

  it('403 与 404 各归各的码 —— 上游把 403 压成 401、404 压成 400(有意偏离)', async () => {
    mockReplicate(403, { detail: 'You do not have permission' })
    const forbidden = await call('get_model', { owner: 'a', model: 'b' })
    expect(forbidden.status).toBe(403)
    await expect(forbidden.json()).resolves.toMatchObject({ code: 'permission_denied' })

    vi.unstubAllGlobals()
    mockReplicate(404, { detail: 'The specified model does not exist' })
    const missing = await call('get_model', { owner: 'a', model: 'b' })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({
      code: 'not_found',
      message: 'The specified model does not exist',
    })
  })

  it('401 → permission_denied;429 与 5xx 可重试', async () => {
    mockReplicate(401, { detail: 'Invalid token' })
    expect((await call('get_account', {})).status).toBe(401)

    vi.unstubAllGlobals()
    mockReplicate(429, { detail: 'Too many requests' })
    await expect((await call('get_account', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockReplicate(500, {})
    await expect((await call('get_account', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true, message: 'Replicate 返回 HTTP 500' })
  })

  it('错误响应回纯文本时当成错误消息用(上游 readReplicateResponse 的兜底)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('upstream timeout', { status: 504 }))))
    await expect((await call('get_account', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', message: 'upstream timeout' })
  })

  it('2xx 上回非 JSON → unavailable + retryable,不当成 {detail} 载荷透出去(有意偏离)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>oops</html>', { status: 200 }))))
    const res = await call('get_account', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockReplicate(200, {})
    const res = await call('get_account', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
