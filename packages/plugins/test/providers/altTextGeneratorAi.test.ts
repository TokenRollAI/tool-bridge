import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAltTextGeneratorAiPlugin } from '../../src/alt_text_generator_ai/index'

/**
 * 迁移产物的 wire 级验收:断言都经真实 envelope,不直调内部函数。
 * 每个迁移完的 provider 都应有这么一份 —— 它证明的是"迁完还能用",
 * 而 schemaParity 证明的是"迁的过程没改契约",两者不可互相替代。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'wpkey_test'
const plugin = createAltTextGeneratorAiPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'ai/alt-text',
  exportId: 'actions',
}

function call(args: unknown, opts: { auth?: string | null } = {}): Promise<Response> {
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
    new Request('https://plugin.test/', {
      method: 'POST',
      headers,
      body: JSON.stringify({ tool: 'Call', arguments: { name: 'generate_alt_text', args } }),
    }),
    ENV as never,
  ))
}

function mockUpstream(status: number, body: string): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(body, { status })))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('alt_text_generator_ai(迁移产物)', () => {
  it('~describe 报成单个 tools/v1 export', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    await expect(res.json()).resolves.toEqual({
      protocolVersion: 'plugin/v2',
      exports: [{
        auth: { kind: 'single', required: true },
        id: 'actions',
        profile: 'tools/v1',
        description: 'Alt Text Generator AI',
      }],
    })
  })

  it('List 出的 spec 带 Zod 派生的 inputSchema 与 outputSchema', async () => {
    const res = await plugin.fetch(
      new Request('https://plugin.test/', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${PLUGIN_TOKEN}`,
          [HEADER_TB_CONTEXT]: encodeCallContext(CALLER),
        },
        body: JSON.stringify({ tool: 'List', arguments: {} }),
      }),
      ENV as never,
    )
    const tools = (await res.json()) as Array<{ effect?: string, inputSchema?: { properties?: object }, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(1)
    expect(tools[0]?.name).toBe('generate_alt_text')
    expect(tools[0]?.effect).toBe('read')
    expect(tools[0]?.inputSchema?.properties).toHaveProperty('imageUrl')
    expect(tools[0]?.outputSchema).toBeDefined()
  })

  it('调用成功:凭证进 body 的 wpkey,返回值原样透出', async () => {
    const upstream = mockUpstream(200, 'A cat sitting on a windowsill')
    const res = await call({ imageUrl: 'https://cdn.example.com/cat.jpg' })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ content: { altText: 'A cat sitting on a windowsill' } })

    const [request] = upstream.mock.calls[0] as [Request]
    expect(request.url).toBe('https://alttextgeneratorai.com/api/wp')
    await expect(request.json()).resolves.toEqual({
      image: 'https://cdn.example.com/cat.jpg',
      wpkey: API_KEY,
    })
  })

  it('上游回 JSON 字符串字面量也能解出(与迁移前行为一致)', async () => {
    mockUpstream(200, JSON.stringify('  A dog  '))
    await expect((await call({ imageUrl: 'https://cdn.example.com/dog.jpg' })).json())
      .resolves.toEqual({ content: { altText: 'A dog' } })
  })

  it('入参校验真的生效了:imageUrl 不是 URL → 400,且不打上游', async () => {
    const upstream = mockUpstream(200, 'x')
    const res = await call({ imageUrl: 'not-a-url' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(upstream).not.toHaveBeenCalled()
  })

  it('没配 authRef → unavailable,消息说清怎么修,且不打上游', async () => {
    const upstream = mockUpstream(200, 'x')
    const res = await call({ imageUrl: 'https://cdn.example.com/a.jpg' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(upstream).not.toHaveBeenCalled()
  })

  it('上游 401 → permission_denied;429 → rate_limited 且 retryable', async () => {
    mockUpstream(401, 'bad key')
    expect((await call({ imageUrl: 'https://cdn.example.com/a.jpg' })).status).toBe(401)
    mockUpstream(429, 'slow down')
    const limited = await call({ imageUrl: 'https://cdn.example.com/a.jpg' })
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('上游回空 → unavailable(不把空串当成合法 alt text)', async () => {
    mockUpstream(200, '   ')
    const res = await call({ imageUrl: 'https://cdn.example.com/a.jpg' })
    expect(res.status).toBe(503)
  })
})
