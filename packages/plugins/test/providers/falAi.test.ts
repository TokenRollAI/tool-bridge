import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createFalAiPlugin } from '../../src/fal_ai/index'
import { falAiActions } from '../../src/fal_ai/schema'

/**
 * fal.ai 迁移产物的 wire 级验收。重点钉住几处"迁移最容易迁丢"的地方:
 * 两个 host 的分工、`Key ` 而非 `Bearer` 的凭证前缀、modelId 的路径编码(上游在这里
 * 有 bug,见 api.ts)、`logs: 0` 这个"值为假但要发"的参数、以及 SSE 的切分与汇总。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
/** 真实 FAL_KEY 的形状:`key_id:key_secret`,但对插件是单个不透明字符串。 */
const API_KEY = 'falkeyid:falkeysecret'
const plugin = createFalAiPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'ai/fal',
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

function mockFal(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

/** SSE 端点回的是 text/event-stream,不是 JSON。 */
function mockSse(status: number, body: string): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(body, {
    status,
    headers: { 'content-type': 'text/event-stream' },
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
  it('List 出全部 8 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(falAiActions).length)
    expect(tools).toHaveLength(8)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'cancel_queue_request',
      'estimate_pricing',
      'get_jwks',
      'get_models',
      'get_pricing',
      'get_queue_request_result',
      'queue_get_status',
      'queue_get_status_stream',
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
        id: 'actions',
        profile: 'tools/v1',
        description: 'fal.ai',
        credentialProbe: 'get_models',
      }],
    })
  })

  it('探针指向的工具确实存在、只读、且无必填入参(平台挂载时会空参调它)', () => {
    const spec = falAiActions.get_models
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })
})

describe('请求拼装', () => {
  it('get_models:打 api.fal.ai,凭证是 `Key <FAL_KEY>` 而不是 Bearer', async () => {
    const mock = mockFal(200, { models: [], has_more: false, next_cursor: null })
    await call('get_models', { q: 'flux', limit: 5, status: 'active', category: 'text-to-image' })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('GET')
    expect(url.origin).toBe('https://api.fal.ai')
    expect(url.pathname).toBe('/v1/models')
    expect(request.headers.get('authorization')).toBe(`Key ${API_KEY}`)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'flux',
      limit: '5',
      status: 'active',
      category: 'text-to-image',
    })
  })

  it('expand / endpointId 的数组形态展开成重复的同名参数,单串原样发', async () => {
    const many = mockFal(200, { models: [] })
    await call('get_models', { expand: ['pricing', 'metadata'], endpointId: ['fal-ai/flux', 'fal-ai/sdxl'] })
    const manyUrl = new URL(sent(many).url)
    expect(manyUrl.searchParams.getAll('expand')).toEqual(['pricing', 'metadata'])
    expect(manyUrl.searchParams.getAll('endpoint_id')).toEqual(['fal-ai/flux', 'fal-ai/sdxl'])

    vi.unstubAllGlobals()
    const one = mockFal(200, { models: [] })
    await call('get_models', { expand: 'pricing' })
    expect(new URL(sent(one).url).searchParams.getAll('expand')).toEqual(['pricing'])
  })

  it('get_pricing 打 /v1/models/pricing;get_jwks 打 /.well-known/jwks.json', async () => {
    const pricing = mockFal(200, { prices: [{ endpoint_id: 'fal-ai/flux' }], has_more: false })
    await call('get_pricing', { endpointId: 'fal-ai/flux' })
    expect(new URL(sent(pricing).url).pathname).toBe('/v1/models/pricing')

    vi.unstubAllGlobals()
    const jwks = mockFal(200, { keys: [{ kid: 'a' }] })
    await call('get_jwks', {})
    const jwksUrl = new URL(sent(jwks).url)
    expect(jwksUrl.origin).toBe('https://api.fal.ai')
    expect(jwksUrl.pathname).toBe('/.well-known/jwks.json')
  })

  it('estimate_pricing 是 POST + JSON body', async () => {
    const mock = mockFal(200, { estimate_type: 'unit_price', total_cost: 1.5, currency: 'USD' })
    await call('estimate_pricing', {
      estimateType: 'unit_price',
      endpoints: { 'fal-ai/flux': { quantity: 10 } },
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/v1/models/pricing/estimate')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      estimate_type: 'unit_price',
      endpoints: { 'fal-ai/flux': { quantity: 10 } },
    })
  })

  it('队列 action 打 queue.fal.run,且 modelId 的斜杠保留成路径分隔符(上游在这里编成了 %2F)', async () => {
    const mock = mockFal(200, { status: 'IN_QUEUE' })
    await call('queue_get_status', { modelId: 'fal-ai/flux', requestId: 'req-1' })

    const url = new URL(sent(mock).url)
    expect(url.origin).toBe('https://queue.fal.run')
    expect(url.pathname).toBe('/fal-ai/flux/requests/req-1/status')
    // 真的是分隔符,不是转义后的字面量。
    expect(sent(mock).url).not.toContain('%2F')
  })

  it('段内的特殊字符照样转义(逐段编码不等于不编码)', async () => {
    const mock = mockFal(200, { status: 'IN_QUEUE' })
    await call('queue_get_status', { modelId: 'ns/model name', requestId: 'req/1' })
    expect(new URL(sent(mock).url).pathname).toBe('/ns/model%20name/requests/req%2F1/status')
  })

  it('logs: 0 是显式值要发出去;没给才不发', async () => {
    const zero = mockFal(200, { status: 'IN_QUEUE' })
    await call('queue_get_status', { modelId: 'fal-ai/flux', requestId: 'r', logs: 0 })
    expect(new URL(sent(zero).url).searchParams.get('logs')).toBe('0')

    vi.unstubAllGlobals()
    const absent = mockFal(200, { status: 'IN_QUEUE' })
    await call('queue_get_status', { modelId: 'fal-ai/flux', requestId: 'r' })
    expect([...new URL(sent(absent).url).searchParams.keys()]).toEqual([])
  })

  it('get_queue_request_result 不带 status 后缀;cancel 是 PUT + cancel 后缀', async () => {
    const result = mockFal(200, { status: 'COMPLETED', response: { images: [] } })
    await call('get_queue_request_result', { modelId: 'fal-ai/flux', requestId: 'r' })
    expect(new URL(sent(result).url).pathname).toBe('/fal-ai/flux/requests/r')
    expect(sent(result).method).toBe('GET')

    vi.unstubAllGlobals()
    const cancel = mockFal(200, { status: 'CANCELLATION_REQUESTED' })
    await call('cancel_queue_request', { modelId: 'fal-ai/flux', requestId: 'r' })
    expect(sent(cancel).method).toBe('PUT')
    expect(new URL(sent(cancel).url).pathname).toBe('/fal-ai/flux/requests/r/cancel')
  })
})

describe('响应整形', () => {
  it('分页三件套缺失时给稳定兜底:models=[] / hasMore=false / nextCursor=null', async () => {
    mockFal(200, {})
    await expect((await call('get_models', {})).json()).resolves.toEqual({
      content: { models: [], hasMore: false, nextCursor: null },
    })
  })

  it('queue_get_status:蛇形转驼峰,日志缺字段补空串,queue_position 缺失记 null', async () => {
    mockFal(200, {
      status: 'IN_PROGRESS',
      response_url: 'https://queue.fal.run/fal-ai/flux/requests/r',
      logs: [{ message: 'started', level: 'INFO' }, 'not-an-object'],
    })
    await expect((await call('queue_get_status', { modelId: 'fal-ai/flux', requestId: 'r' })).json())
      .resolves.toEqual({
        content: {
          status: 'IN_PROGRESS',
          responseUrl: 'https://queue.fal.run/fal-ai/flux/requests/r',
          queuePosition: null,
          // 非对象的日志项被丢掉,剩下那条补齐四个字段。
          logs: [{ message: 'started', level: 'INFO', source: '', timestamp: '' }],
        },
      })
  })

  it('SSE 流切成 updates,并从最后一条取 finalStatus / responseUrl', async () => {
    mockSse(200, [
      ': keepalive',
      '',
      'event: message',
      'data: {"status":"IN_QUEUE","queue_position":3}',
      '',
      'data: {"status":"COMPLETED","response_url":"https://queue.fal.run/x"}',
      '',
      '',
    ].join('\n'))

    const res = await call('queue_get_status_stream', { modelId: 'fal-ai/flux', requestId: 'r' })
    await expect(res.json()).resolves.toEqual({
      content: {
        updates: [
          { status: 'IN_QUEUE', queue_position: 3 },
          { status: 'COMPLETED', response_url: 'https://queue.fal.run/x' },
        ],
        finalStatus: 'COMPLETED',
        responseUrl: 'https://queue.fal.run/x',
      },
    })
  })

  it('SSE 里非 JSON 的 data 不被丢弃,留成 {event, data}', async () => {
    mockSse(200, 'event: ping\ndata: pong\n\n')
    await expect((await call('queue_get_status_stream', { modelId: 'm', requestId: 'r' })).json())
      .resolves.toEqual({
        content: { updates: [{ event: 'ping', data: 'pong' }], finalStatus: null, responseUrl: null },
      })
  })

  it('SSE 端点请求头带 accept: text/event-stream 与 Key 凭证', async () => {
    const mock = mockSse(200, '')
    await call('queue_get_status_stream', { modelId: 'fal-ai/flux', requestId: 'r', logs: 1 })
    const request = sent(mock)
    expect(request.headers.get('accept')).toBe('text/event-stream')
    expect(request.headers.get('authorization')).toBe(`Key ${API_KEY}`)
    expect(new URL(request.url).pathname).toBe('/fal-ai/flux/requests/r/status/stream')
    expect(new URL(request.url).searchParams.get('logs')).toBe('1')
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:logs 越界 → 400 且不打上游', async () => {
    const mock = mockFal(200, {})
    const res = await call('queue_get_status', { modelId: 'm', requestId: 'r', logs: 2 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('未声明的字段被 strictObject 拒掉(schema 是 strict,别悄悄放过错拼的参数)', async () => {
    const mock = mockFal(200, {})
    expect((await call('get_models', { limit: 1, nope: true })).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游 4xx 归 invalid_argument,消息取自 detail / message / error', async () => {
    mockFal(422, { detail: [{ loc: ['body', 'estimate_type'], msg: 'bad' }] })
    const invalid = await call('estimate_pricing', { estimateType: 'unit_price', endpoints: {} })
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toMatchObject({ code: 'invalid_argument' })

    vi.unstubAllGlobals()
    mockFal(400, { message: 'Request already completed' })
    await expect((await call('cancel_queue_request', { modelId: 'm', requestId: 'r' })).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'Request already completed' })

    vi.unstubAllGlobals()
    mockFal(401, { error: 'Invalid API key' })
    const unauthorized = await call('get_models', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })
  })

  it('404 归 not_found —— 上游把它压成 400,这里按共用归一表分开(有意偏离)', async () => {
    mockFal(404, { detail: 'Request not found' })
    const res = await call('get_queue_request_result', { modelId: 'fal-ai/flux', requestId: 'nope' })
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ code: 'not_found', message: 'Request not found' })
  })

  it('429 与 5xx 都是可重试的', async () => {
    mockFal(429, { message: 'Rate limit exceeded' })
    const limited = await call('get_models', {})
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockFal(503, {})
    await expect((await call('get_models', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('2xx 上回非 JSON → unavailable + retryable(而不是裸 SyntaxError 变成 internal 500)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>oops</html>', { status: 200 }))))
    const res = await call('get_models', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('错误响应回 HTML 时按状态归一,不报"响应不是 JSON"', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>502</html>', { status: 502 }))))
    await expect((await call('get_models', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', message: 'fal.ai 返回 HTTP 502' })
  })

  it('没配 authRef → unavailable 且不打上游(SSE 那条路径也一样)', async () => {
    const mock = mockFal(200, {})
    const res = await call('get_models', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const streamMock = mockSse(200, '')
    expect((await call('queue_get_status_stream', { modelId: 'm', requestId: 'r' }, { auth: null })).status)
      .toBe(503)
    expect(streamMock).not.toHaveBeenCalled()
  })
})
