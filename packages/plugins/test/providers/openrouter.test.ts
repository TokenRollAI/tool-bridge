import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createOpenrouterPlugin } from '../../src/openrouter/index'
import { openrouterActions } from '../../src/openrouter/schema'

/**
 * OpenRouter 迁移产物的 wire 级验收。重点钉住几处"迁移最容易迁丢"的地方:
 * `httpReferer`/`xTitle` 两个"伪入参"变成请求头而不进请求体、legacy `functions` /
 * `function_call` 现场翻译成 `tools` / `tool_choice`、`stream=true` 在本层就拒、
 * 以及只有显式要了 RSS 才接受非 JSON 响应。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'sk-or-v1-deadbeef'
const API_BASE = 'https://openrouter.ai/api/v1'
const plugin = createOpenrouterPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'llm/openrouter',
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

function mockOpenrouter(
  status: number,
  payload: unknown,
  contentType = 'application/json',
): ReturnType<typeof vi.fn> {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const fn = vi.fn(() => Promise.resolve(new Response(body, {
    status,
    headers: { 'content-type': contentType },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

function sent(mock: ReturnType<typeof vi.fn>): Request {
  return (mock.mock.calls[0] as [Request])[0]
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  return (await request.json()) as Record<string, unknown>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 13 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(openrouterActions).length)
    expect(tools).toHaveLength(13)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'create_chat_completion',
      'create_coinbase_charge',
      'create_message',
      'get_credits',
      'get_current_key',
      'get_generation',
      'get_models_count',
      'list_available_models',
      'list_embedding_models',
      'list_model_endpoints',
      'list_providers',
      'list_user_models',
      'list_zdr_endpoints',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('~describe 报单个 tools/v1 export,带探针工具名', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    const body = (await res.json()) as {
      exports: Array<{ credentialFields?: unknown, credentialProbe?: string, profile?: string }>
    }
    expect(body.exports).toHaveLength(1)
    expect(body.exports[0]?.profile).toBe('tools/v1')
    expect(body.exports[0]?.credentialProbe).toBe('get_current_key')
    expect(body.exports[0]?.credentialFields).toBeUndefined()
  })

  it('探针指向的工具确实存在、只读、且无必填入参(平台挂载时会空参调它)', () => {
    const spec = openrouterActions.get_current_key
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })

  it('手写 schema 接进了 action 表:chain_id 是三个字面量的联合', () => {
    const schema = z.toJSONSchema(openrouterActions.create_coinbase_charge.inputSchema, { io: 'input' }) as {
      properties?: { chain_id?: { anyOf?: Array<{ const?: number, description?: string }> } }
      required?: string[]
    }
    expect(schema.required?.sort()).toEqual(['amount', 'chain_id', 'sender'])
    expect(schema.properties?.chain_id?.anyOf?.map(branch => branch.const)).toEqual([1, 137, 8453])
    // 分支级 description(链名)是手写这份 schema 的全部理由,不能丢。
    expect(schema.properties?.chain_id?.anyOf?.map(branch => branch.description))
      .toEqual(['Ethereum mainnet.', 'Polygon.', 'Base.'])
  })
})

describe('请求头与请求体', () => {
  it('httpReferer / xTitle 变成请求头,不进请求体', async () => {
    const mock = mockOpenrouter(200, { id: 'gen-1' })
    await call('create_chat_completion', {
      model: 'openai/gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      httpReferer: '  https://app.example.com  ',
      xTitle: 'My App',
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.url).toBe(`${API_BASE}/chat/completions`)
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('content-type')).toBe('application/json')
    // 去空白后才发;发进 body 会被上游当成未知字段。
    expect(request.headers.get('http-referer')).toBe('https://app.example.com')
    expect(request.headers.get('x-title')).toBe('My App')
    await expect(jsonBody(request)).resolves.toEqual({
      model: 'openai/gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    })
  })

  it('GET 不发 content-type,也不带请求体', async () => {
    const mock = mockOpenrouter(200, { data: { label: 'k' } })
    await call('get_current_key', { xTitle: 'My App' })
    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.url).toBe(`${API_BASE}/key`)
    expect(request.headers.get('content-type')).toBeNull()
    expect(request.headers.get('x-title')).toBe('My App')
    expect(await request.text()).toBe('')
  })

  it('legacy functions / function_call 翻译成 tools / tool_choice,旧字段不发', async () => {
    const named = mockOpenrouter(200, { id: 'gen-1' })
    await call('create_chat_completion', {
      model: 'openai/gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      functions: [{ name: 'get_weather', parameters: { type: 'object' } }],
      function_call: { name: 'get_weather' },
    })
    await expect(jsonBody(sent(named))).resolves.toEqual({
      model: 'openai/gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'get_weather', parameters: { type: 'object' } } }],
      tool_choice: { type: 'function', function: { name: 'get_weather' } },
    })

    vi.unstubAllGlobals()
    const auto = mockOpenrouter(200, { id: 'gen-2' })
    await call('create_chat_completion', {
      model: 'openai/gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      function_call: 'auto',
    })
    await expect(jsonBody(sent(auto))).resolves.toMatchObject({ tool_choice: 'auto' })
  })

  it('已经给了 tools / tool_choice 就不翻译 legacy 字段(新的优先)', async () => {
    const mock = mockOpenrouter(200, { id: 'gen-1' })
    await call('create_chat_completion', {
      model: 'openai/gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'new_tool' } }],
      tool_choice: 'none',
      functions: [{ name: 'legacy_tool' }],
      function_call: { name: 'legacy_tool' },
    })
    await expect(jsonBody(sent(mock))).resolves.toEqual({
      model: 'openai/gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'new_tool' } }],
      tool_choice: 'none',
    })
  })

  it('create_message 打 Anthropic 兼容端点,入参原样进 body(去掉两个伪入参)', async () => {
    const mock = mockOpenrouter(200, { id: 'msg-1' })
    await call('create_message', {
      model: 'anthropic/claude-sonnet-4',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'hi' }],
      system: 'be brief',
      httpReferer: 'https://app.example.com',
    })
    expect(sent(mock).url).toBe(`${API_BASE}/messages`)
    await expect(jsonBody(sent(mock))).resolves.toEqual({
      model: 'anthropic/claude-sonnet-4',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'hi' }],
      system: 'be brief',
    })
  })

  it('入参名是驼峰、query 名是下划线;路径参数走 URL 编码', async () => {
    const models = mockOpenrouter(200, { data: [] })
    await call('list_available_models', {
      category: 'programming',
      supportedParameters: 'tools,temperature',
      outputModalities: 'text',
      useRssChatLinks: true,
    })
    const url = new URL(sent(models).url)
    expect(url.pathname).toBe('/api/v1/models')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      category: 'programming',
      supported_parameters: 'tools,temperature',
      output_modalities: 'text',
      use_rss_chat_links: 'true',
    })

    vi.unstubAllGlobals()
    const endpoints = mockOpenrouter(200, { data: {} })
    await call('list_model_endpoints', { author: 'meta llama', slug: 'llama-3.3/70b' })
    expect(sent(endpoints).url).toBe(`${API_BASE}/models/meta%20llama/llama-3.3%2F70b/endpoints`)
  })
})

describe('响应整形', () => {
  it('useRss=true 时接受 XML 响应并包成 {rss}', async () => {
    mockOpenrouter(200, '<rss version="2.0"><channel/></rss>', 'application/rss+xml; charset=utf-8')
    const res = await call('list_available_models', { useRss: true })
    await expect(res.json()).resolves.toEqual({
      content: { rss: '<rss version="2.0"><channel/></rss>' },
    })
  })

  it('没要 RSS 却回了非 JSON:那是上游坏了,归 unavailable + retryable', async () => {
    mockOpenrouter(200, '<rss version="2.0"/>', 'application/rss+xml')
    const res = await call('list_available_models', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('JSON 出参原样透出', async () => {
    mockOpenrouter(200, { data: { total_credits: 12.5, total_usage: 3.25 } })
    await expect((await call('get_credits', {})).json()).resolves.toEqual({
      content: { data: { total_credits: 12.5, total_usage: 3.25 } },
    })
  })
})

describe('校验与错误', () => {
  it('stream=true 在本层就拒:连接器只返回一次性响应', async () => {
    const mock = mockOpenrouter(200, {})
    const res = await call('create_chat_completion', {
      model: 'openai/gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    expect(mock).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const message = mockOpenrouter(200, {})
    expect((await call('create_message', {
      model: 'anthropic/claude-sonnet-4',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    })).status).toBe(400)
    expect(message).not.toHaveBeenCalled()
  })

  it('入参校验真的生效:缺必填与越界都在本地拦下', async () => {
    const missing = mockOpenrouter(200, {})
    expect((await call('create_chat_completion', { model: 'openai/gpt-4o' })).status).toBe(400)
    expect(missing).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const chain = mockOpenrouter(200, {})
    // chain_id 只认 1 / 137 / 8453 这三个链。
    const res = await call('create_coinbase_charge', { amount: 10, sender: '0xabc', chain_id: 42 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(chain).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 error.message', async () => {
    mockOpenrouter(401, { error: { type: 'authentication_error', code: 401, message: 'No auth credentials found' } })
    const unauthorized = await call('get_credits', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'No auth credentials found',
    })

    vi.unstubAllGlobals()
    mockOpenrouter(402, { error: { message: 'Insufficient credits' } })
    await expect((await call('create_chat_completion', {
      model: 'openai/gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    })).json()).resolves.toMatchObject({ code: 'invalid_argument', message: 'Insufficient credits' })

    vi.unstubAllGlobals()
    mockOpenrouter(429, { error: { message: 'Rate limit exceeded' } })
    const limited = await call('get_credits', {})
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockOpenrouter(502, '<html>bad gateway</html>', 'text/html')
    const down = await call('get_credits', {})
    expect(down.status).toBe(503)
    await expect(down.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      // 认不出错误体时按状态说话,不把上游正文回显给调用方。
      message: 'OpenRouter 返回 HTTP 502',
    })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockOpenrouter(200, {})
    const res = await call('get_credits', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
