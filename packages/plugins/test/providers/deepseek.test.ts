import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createDeepseekPlugin } from '../../src/deepseek/index'
import { deepseekActions } from '../../src/deepseek/schema'

/**
 * DeepSeek 迁移产物的 wire 级验收。重点钉住几处"迁移最容易迁丢"的地方:
 * OpenAI 面与 Anthropic 面各自的 base URL 与认证头(同一把 key,头名不同)、
 * `stream: true` 的本地拒绝、以及错误文案的三级回退。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'sk-deadbeef'
const plugin = createDeepseekPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'ai/deepseek',
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

function mockDeepseek(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const fn = vi.fn(() => Promise.resolve(new Response(body, {
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
  it('List 出全部 4 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(deepseekActions).length)
    expect(tools).toHaveLength(4)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'create_anthropic_message',
      'create_chat_completion',
      'get_user_balance',
      'list_models',
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
        description: 'DeepSeek',
        credentialProbe: 'list_models',
      }],
    })
  })

  it('探针指向的工具确实存在、只读、且无必填入参(平台挂载时会空参调它)', () => {
    const spec = deepseekActions.list_models
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })
})

describe('请求拼装', () => {
  it('list_models:GET /models,凭证走 authorization: Bearer', async () => {
    const mock = mockDeepseek(200, { object: 'list', data: [{ id: 'deepseek-chat' }] })
    const res = await call('list_models', {})

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.url).toBe('https://api.deepseek.com/models')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('x-api-key')).toBeNull()
    await expect(res.json()).resolves.toEqual({
      content: { object: 'list', data: [{ id: 'deepseek-chat' }] },
    })
  })

  it('get_user_balance 打 /user/balance', async () => {
    const mock = mockDeepseek(200, { is_available: true, balance_infos: [] })
    await call('get_user_balance', {})
    expect(sent(mock).url).toBe('https://api.deepseek.com/user/balance')
  })

  it('create_chat_completion:POST /chat/completions,入参原样进 JSON body', async () => {
    const mock = mockDeepseek(200, { id: 'chat-1', choices: [] })
    const res = await call('create_chat_completion', {
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://api.deepseek.com/chat/completions')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
    })
    await expect(res.json()).resolves.toEqual({ content: { id: 'chat-1', choices: [] } })
  })

  it('create_anthropic_message 换 base URL 与认证头:/anthropic/v1/messages + x-api-key', async () => {
    const mock = mockDeepseek(200, { id: 'msg-1', content: [] })
    await call('create_anthropic_message', {
      model: 'deepseek-chat',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'hi' }],
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://api.deepseek.com/anthropic/v1/messages')
    // 同一把 key,但 Anthropic 面只认 x-api-key —— 发 authorization 会 401。
    expect(request.headers.get('x-api-key')).toBe(API_KEY)
    expect(request.headers.get('authorization')).toBeNull()
  })

  it('消息 content 为 null 时保留(compact 只丢 undefined,不丢 null)', async () => {
    const mock = mockDeepseek(200, { id: 'chat-1' })
    await call('create_chat_completion', {
      model: 'deepseek-chat',
      messages: [{ role: 'assistant', content: null }],
    })
    await expect(sent(mock).json()).resolves.toEqual({
      model: 'deepseek-chat',
      messages: [{ role: 'assistant', content: null }],
    })
  })
})

describe('校验与错误', () => {
  it('stream=true 在本地就挡下(这条链路不承载 SSE),两个 completion action 都是', async () => {
    const chat = mockDeepseek(200, {})
    const chatRes = await call('create_chat_completion', {
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    })
    expect(chatRes.status).toBe(400)
    await expect(chatRes.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    expect(chat).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const anthropic = mockDeepseek(200, {})
    const anthropicRes = await call('create_anthropic_message', {
      model: 'deepseek-chat',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    })
    expect(anthropicRes.status).toBe(400)
    expect(anthropic).not.toHaveBeenCalled()
  })

  it('stream=false 放行,并原样发给上游', async () => {
    const mock = mockDeepseek(200, { id: 'chat-1' })
    await call('create_chat_completion', {
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    })
    await expect(sent(mock).json()).resolves.toMatchObject({ stream: false })
  })

  it('入参校验真的生效:model 不在枚举里 → 400 且不打上游', async () => {
    const mock = mockDeepseek(200, {})
    const res = await call('create_chat_completion', {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游 4xx → invalid_argument,消息取自 error.message', async () => {
    mockDeepseek(400, { error: { type: 'invalid_request_error', message: 'messages must not be empty' } })
    const res = await call('list_models', {})
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'messages must not be empty',
    })
  })

  it('上游 401 → permission_denied,429 → rate_limited + retryable', async () => {
    mockDeepseek(401, { error: { message: 'Authentication Fails' } })
    const unauthorized = await call('list_models', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Authentication Fails',
    })

    vi.unstubAllGlobals()
    mockDeepseek(429, { error: { message: 'Rate limit reached' } })
    const limited = await call('list_models', {})
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('上游 5xx → unavailable + retryable', async () => {
    mockDeepseek(503, { error: { message: 'Server Overloaded' } })
    const res = await call('list_models', {})
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: 'Server Overloaded',
    })
  })

  it('错误体不是 JSON 时,原始 body 就是消息;body 也为空时才退到状态码文案', async () => {
    mockDeepseek(502, '<html>bad gateway</html>')
    await expect((await call('list_models', {})).json())
      .resolves.toMatchObject({ message: '<html>bad gateway</html>' })

    vi.unstubAllGlobals()
    mockDeepseek(500, '')
    await expect((await call('list_models', {})).json())
      .resolves.toMatchObject({ message: 'deepseek request failed with 500' })
  })

  it('2xx 上回非 JSON → unavailable + retryable(是上游坏了,不是调用方的错)', async () => {
    mockDeepseek(200, 'not json at all')
    const res = await call('list_models', {})
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: 'deepseek returned malformed JSON',
    })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockDeepseek(200, {})
    const res = await call('list_models', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
