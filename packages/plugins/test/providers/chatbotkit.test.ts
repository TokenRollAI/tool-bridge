import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createChatbotkitPlugin } from '../../src/chatbotkit/index'
import { chatbotkitActions } from '../../src/chatbotkit/schema'

/**
 * ChatBotKit 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * `meta` 展开成 `meta[key]=v`、POST body 去掉路径参数后其余全发(looseObject 不能白名单)、
 * 双路径参数的拼接顺序、search_dataset 是 read 但走 POST。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'cbk_deadbeef'
const plugin = createChatbotkitPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'ai/chatbotkit',
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

function mockChatbotkit(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 27 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(chatbotkitActions).length)
    expect(tools).toHaveLength(27)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('fetch_usage')).toBe('read')
    expect(effectOf('list_bots')).toBe('read')
    // 走 POST 但语义只读。
    expect(effectOf('search_dataset')).toBe('read')
    expect(effectOf('create_bot')).toBe('write')
    expect(effectOf('detach_dataset_file')).toBe('write')
  })
})

describe('GET 模板', () => {
  it('fetch_usage:GET /usage/fetch,凭证走 Bearer', async () => {
    const mock = mockChatbotkit(200, { tokens: 123 })
    const res = await call('fetch_usage', {})

    const request = sent(mock)
    expect(request.url).toBe('https://api.chatbotkit.com/api/v1/usage/fetch')
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    await expect(res.json()).resolves.toEqual({ content: { tokens: 123 } })
  })

  it('list_bots:分页参数进 query,meta 展开成 meta[key]=v', async () => {
    const mock = mockChatbotkit(200, { items: [] })
    await call('list_bots', {
      take: 10,
      cursor: 'c1',
      order: 'desc',
      meta: { tier: 'pro', region: 'eu' },
    })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/v1/bot/list')
    expect(url.searchParams.get('take')).toBe('10')
    expect(url.searchParams.get('cursor')).toBe('c1')
    expect(url.searchParams.get('order')).toBe('desc')
    expect(url.searchParams.get('meta[tier]')).toBe('pro')
    expect(url.searchParams.get('meta[region]')).toBe('eu')
    // meta 本身不能作为裸参数出现。
    expect(url.searchParams.has('meta')).toBe(false)
  })

  it('fetch_bot:路径参数被 URL 编码', async () => {
    const mock = mockChatbotkit(200, { id: 'b1' })
    await call('fetch_bot', { botId: 'b/1' })
    expect(new URL(sent(mock).url).pathname).toBe('/api/v1/bot/b%2F1/fetch')
  })
})

describe('POST 模板', () => {
  it('create_bot:整个入参当 body(looseObject 的字段不能被白名单吃掉)', async () => {
    const mock = mockChatbotkit(200, { id: 'b1' })
    await call('create_bot', {
      name: 'Helper',
      model: 'gpt-4',
      // schema 是 looseObject,这个未声明的字段必须原样发出去。
      customUpstreamField: { nested: true },
    })

    const request = sent(mock)
    expect(request.url).toBe('https://api.chatbotkit.com/api/v1/bot/create')
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      name: 'Helper',
      model: 'gpt-4',
      customUpstreamField: { nested: true },
    })
  })

  it('update_bot:路径参数进路径,且不重复出现在 body 里', async () => {
    const mock = mockChatbotkit(200, { id: 'b1' })
    await call('update_bot', { botId: 'b1', name: 'Renamed' })

    const request = sent(mock)
    expect(new URL(request.url).pathname).toBe('/api/v1/bot/b1/update')
    await expect(request.json()).resolves.toEqual({ name: 'Renamed' })
  })

  it('attach_dataset_file:两个路径参数按 dataset → file 顺序拼,body 里都不留', async () => {
    const mock = mockChatbotkit(200, { id: 'a1' })
    await call('attach_dataset_file', { datasetId: 'd1', fileId: 'f1', type: 'source' })

    const request = sent(mock)
    expect(new URL(request.url).pathname).toBe('/api/v1/dataset/d1/file/f1/attach')
    await expect(request.json()).resolves.toEqual({ type: 'source' })
  })

  it('search_dataset:effect 是 read 但端点走 POST', async () => {
    const mock = mockChatbotkit(200, { items: [] })
    await call('search_dataset', { datasetId: 'd1', query: 'refunds' })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/api/v1/dataset/d1/search')
    await expect(request.json()).resolves.toEqual({ query: 'refunds' })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:缺必填 botId → 400 且不打上游', async () => {
    const mock = mockChatbotkit(200, {})
    const res = await call('fetch_bot', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('update_bot 缺 botId → 400 且不打上游(schema 里它是 optional)', async () => {
    const mock = mockChatbotkit(200, {})
    const res = await call('update_bot', { name: 'X' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('botId')
    expect(mock).not.toHaveBeenCalled()
  })

  it('take 给 0(schema 要求 >= 1)→ 400 且不打上游', async () => {
    const mock = mockChatbotkit(200, {})
    const res = await call('list_bots', { take: 0 })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 message', async () => {
    mockChatbotkit(404, { message: 'Bot not found' })
    await expect((await call('fetch_bot', { botId: 'nope' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'Bot not found' })

    mockChatbotkit(401, { message: 'Invalid token' })
    expect((await call('fetch_usage', {})).status).toBe(401)

    mockChatbotkit(429, { message: 'Rate limited' })
    await expect((await call('fetch_usage', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockChatbotkit(500, { message: 'ChatBotKit is down' })
    await expect((await call('fetch_usage', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockChatbotkit(200, {})
    const res = await call('fetch_usage', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
