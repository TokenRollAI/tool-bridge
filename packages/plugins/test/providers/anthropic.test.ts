import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createAnthropicPlugin } from '../../src/anthropic/index'
import { anthropicActions } from '../../src/anthropic/schema'

/**
 * Anthropic 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 每请求必带的 `anthropic-version` 头、请求体的原样透传、流式拦截、
 * schema 没标 required 但 executor 里有断言的 `model_id`,以及错误归一。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'sk-ant-api03-deadbeef'
const plugin = createAnthropicPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'ai/anthropic',
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

/** 用原始文本回应,便于钉住非 JSON 响应的处理。 */
function mockRaw(status: number, body: string): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

function mockAnthropic(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  return mockRaw(status, JSON.stringify(payload))
}

/** 取上游收到的那个请求。 */
function sent(mock: ReturnType<typeof vi.fn>): Request {
  return (mock.mock.calls[0] as [Request])[0]
}

const MESSAGE_ARGS = {
  model: 'claude-sonnet-4-5',
  max_tokens: 128,
  messages: [{ role: 'user', content: 'hi' }],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('~describe 报成单个 tools/v1 export,并带上凭证探针', async () => {
    const res = await createAnthropicPlugin().fetch(new Request('https://plugin.test/~describe'), {} as never)
    await expect(res.json()).resolves.toEqual({
      protocolVersion: 'plugin/v2',
      exports: [{
        id: 'actions',
        profile: 'tools/v1',
        description: 'Anthropic',
        credentialProbe: 'list_models',
      }],
    })
  })

  it('探针 list_models 只读且无必填入参(平台挂载时会空参调它)', () => {
    const spec = anthropicActions.list_models
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })

  it('List 出全部 4 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(anthropicActions).length)
    expect(tools).toHaveLength(4)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'count_message_tokens',
      'create_message',
      'get_model',
      'list_models',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求拼装', () => {
  it('list_models:分页参数进 query,凭证走 x-api-key 头,GET 无请求体', async () => {
    const mock = mockAnthropic(200, { data: [], has_more: false })
    await call('list_models', { after_id: 'model_abc', limit: 20 })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('GET')
    expect(url.origin).toBe('https://api.anthropic.com')
    expect(url.pathname).toBe('/v1/models')
    expect(request.headers.get('x-api-key')).toBe(API_KEY)
    expect(await request.text()).toBe('')
    expect(Object.fromEntries(url.searchParams)).toEqual({ after_id: 'model_abc', limit: '20' })
  })

  it('未给的分页参数不出现在 query 里(免得把默认值写死成显式值)', async () => {
    const mock = mockAnthropic(200, { data: [] })
    await call('list_models', {})
    expect([...new URL(sent(mock).url).searchParams.keys()]).toEqual([])
  })

  it('每个请求都带 anthropic-version —— 漏了会被上游 400 拒', async () => {
    const list = mockAnthropic(200, { data: [] })
    await call('list_models', {})
    expect(sent(list).headers.get('anthropic-version')).toBe('2023-06-01')

    vi.unstubAllGlobals()
    const message = mockAnthropic(200, { id: 'msg_1' })
    await call('create_message', MESSAGE_ARGS)
    expect(sent(message).headers.get('anthropic-version')).toBe('2023-06-01')
  })

  it('create_message:入参原样成为请求体,未知字段一并透传(schema 是 looseObject)', async () => {
    const mock = mockAnthropic(200, { id: 'msg_1', content: [] })
    await call('create_message', {
      ...MESSAGE_ARGS,
      system: 'be terse',
      temperature: 0.2,
      stream: false,
      // 上游新出的字段无须改代码就能用,这条钉住透传行为。
      context_management: { edits: [] },
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/v1/messages')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      model: 'claude-sonnet-4-5',
      max_tokens: 128,
      messages: [{ role: 'user', content: 'hi' }],
      system: 'be terse',
      temperature: 0.2,
      stream: false,
      context_management: { edits: [] },
    })
  })

  it('count_message_tokens 打 count_tokens 端点,响应原样透出', async () => {
    const mock = mockAnthropic(200, { input_tokens: 42 })
    const res = await call('count_message_tokens', {
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(new URL(sent(mock).url).pathname).toBe('/v1/messages/count_tokens')
    await expect(res.json()).resolves.toEqual({ content: { input_tokens: 42 } })
  })

  it('get_model 的 model_id 进路径且被 URL 编码', async () => {
    const mock = mockAnthropic(200, { id: 'claude-3/opus' })
    await call('get_model', { model_id: 'claude-3/opus' })
    expect(new URL(sent(mock).url).pathname).toBe('/v1/models/claude-3%2Fopus')
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:max_tokens 为 0 → 400 且不打上游', async () => {
    const mock = mockAnthropic(200, {})
    const res = await call('create_message', { ...MESSAGE_ARGS, max_tokens: 0 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('model_id 在 schema 里是 optional(忠实反映上游),必填断言留在 api 层', async () => {
    // Zod 放行 {},上游 executor 的 requiredString 才是真正的闸门 —— 这处最容易迁丢。
    expect(() => anthropicActions.get_model.inputSchema.parse({})).not.toThrow()

    const mock = mockAnthropic(200, {})
    const missing = await call('get_model', {})
    expect(missing.status).toBe(400)
    await expect(missing.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: expect.stringContaining('model_id'),
    })

    // 纯空白同样过 Zod,但打到上游就是一次必然 404 的请求。
    const blank = await call('get_model', { model_id: '   ' })
    expect(blank.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('stream=true 在本地拦下 —— 连接器消费不了 SSE', async () => {
    const mock = mockAnthropic(200, {})
    const res = await call('create_message', { ...MESSAGE_ARGS, stream: true })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: expect.stringContaining('stream'),
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 error.message', async () => {
    mockAnthropic(400, { type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens too large' } })
    const bad = await call('create_message', MESSAGE_ARGS)
    expect(bad.status).toBe(400)
    await expect(bad.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'max_tokens too large',
    })

    vi.unstubAllGlobals()
    mockAnthropic(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })
    const unauthorized = await call('list_models', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'invalid x-api-key',
    })

    vi.unstubAllGlobals()
    mockAnthropic(429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } })
    const limited = await call('list_models', {})
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockAnthropic(529, { type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } })
    await expect((await call('list_models', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true, message: 'overloaded' })
  })

  it('错误体不是 JSON 时退回原文,原文也空则退回状态说明', async () => {
    mockRaw(502, '<html>bad gateway</html>')
    await expect((await call('list_models', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', message: '<html>bad gateway</html>' })

    vi.unstubAllGlobals()
    mockRaw(500, '')
    await expect((await call('list_models', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', message: 'anthropic request failed with 500' })
  })

  it('2xx 上回非 JSON → unavailable + retryable(上游坏了,不是调用方的错)', async () => {
    mockRaw(200, 'not json at all')
    const res = await call('list_models', {})
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: 'anthropic returned malformed JSON',
    })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockAnthropic(200, {})
    const res = await call('list_models', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
