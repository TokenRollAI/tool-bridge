import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMeituanPlugin } from '../../src/meituan/index'
import { meituanActions } from '../../src/meituan/schema'

/**
 * Meituan 迁移产物的 wire 级验收。重点在这个 provider 独有的两件事:
 * 缺省值(city 落 北京、originQuery 落 query)、以及**业务码优先于 HTTP 状态**的错误归一
 * —— 上游会在 HTTP 200 里回失败,这是最容易迁丢的地方。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'mt_token_deadbeef'
const plugin = createMeituanPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'travel/meituan',
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

function mockMeituan(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

const ok = (content: string): { code: number, data: string } => ({ code: 0, data: content })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 1 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(meituanActions).length)
    expect(tools).toHaveLength(1)
    expect(tools[0]?.name).toBe('query_travel')
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求构造', () => {
  it('只给 query:city 落缺省北京、originQuery 落 query,凭证是裸 token 不带 Bearer', async () => {
    const mock = mockMeituan(200, ok('## 推荐航班'))
    const res = await call('query_travel', { query: '明天去上海的机票' })

    const request = sent(mock)
    expect(request.url).toBe('https://mcp-open-cater.meituan.com/v1/api/voyage/openapi/query')
    expect(request.method).toBe('POST')
    // 上游用的是裸 token,不是 `Bearer <token>`——加前缀会直接鉴权失败。
    expect(request.headers.get('authorization')).toBe(API_KEY)
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      city: '北京',
      query: '明天去上海的机票',
      originQuery: '明天去上海的机票',
      channel: 'meituan-developer',
    })
    await expect(res.json()).resolves.toEqual({ content: { content: '## 推荐航班' } })
  })

  it('wire 形状与 outputSchema 一致:result.content 是 {content},不是裸字符串', async () => {
    // 本 action 的输出字段恰好叫 content,与 ToolResult 的信封键同名。api.ts 自己搭信封
    // 绕开了 toToolResult 的"有 content 就当成品"判定;这条断言是那个绕法的守卫 ——
    // 若哪天 core 统一修掉这个碰撞、导致双层包裹,这里会红而不是静默返回错形状。
    mockMeituan(200, ok('## 正文'))
    const body = (await (await call('query_travel', { query: 'q' })).json()) as { content: unknown }
    expect(typeof body.content).toBe('object')
    expect(body.content).toEqual({ content: '## 正文' })
  })

  it('显式给 city/originQuery 时不被缺省值覆盖', async () => {
    const mock = mockMeituan(200, ok('## 杭州周边'))
    await call('query_travel', {
      query: '周末去哪玩',
      city: '杭州',
      originQuery: '我想知道这个周末杭州周边去哪玩比较好',
    })
    await expect(sent(mock).json()).resolves.toMatchObject({
      city: '杭州',
      query: '周末去哪玩',
      originQuery: '我想知道这个周末杭州周边去哪玩比较好',
    })
  })

  it('平台不注入 UA:不带 user-agent 头(上游那个头是它自己的运行时加的)', async () => {
    const mock = mockMeituan(200, ok('x'))
    await call('query_travel', { query: 'q' })
    expect(sent(mock).headers.get('user-agent')).toBeNull()
  })
})

describe('入参校验', () => {
  it('query 给数字 → 400 且不打上游', async () => {
    const mock = mockMeituan(200, ok('x'))
    const res = await call('query_travel', { query: 12345 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('query 缺失 → 400 且不打上游', async () => {
    const mock = mockMeituan(200, ok('x'))
    expect((await call('query_travel', { city: '北京' })).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('query 只有空白 → 400 且不打上游(schema 的 min(1) 拦不住,补在 handler 里)', async () => {
    const mock = mockMeituan(200, ok('x'))
    const res = await call('query_travel', { query: '   ' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('query')
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('错误归一', () => {
  it('HTTP 401 → permission_denied,消息取自 msg', async () => {
    mockMeituan(401, { code: 401, msg: '鉴权失败,请检查 Token' })
    const res = await call('query_travel', { query: 'q' })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: '鉴权失败,请检查 Token',
    })
  })

  it('HTTP 429 → rate_limited 且 retryable', async () => {
    mockMeituan(429, { code: 429, msg: '请求过于频繁' })
    const res = await call('query_travel', { query: 'q' })
    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toMatchObject({
      code: 'rate_limited',
      message: '请求过于频繁',
      retryable: true,
    })
  })

  it('HTTP 200 但业务码非 0 → 按业务码归一(上游把失败塞在 200 里)', async () => {
    const limited = mockMeituan(200, { code: 50200, msg: '触发限流' })
    const res = await call('query_travel', { query: 'q' })
    expect(limited).toHaveBeenCalled()
    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockMeituan(200, { code: 509, msg: '容量不足' })
    expect((await call('query_travel', { query: 'q' })).status).toBe(429)

    mockMeituan(200, { code: 401, msg: '无效的访问令牌' })
    expect((await call('query_travel', { query: 'q' })).status).toBe(401)
  })

  it('业务码不认识但正文带认证短语 → 401', async () => {
    mockMeituan(200, { code: 999, msg: '访问令牌已过期,请重新生成' })
    const res = await call('query_travel', { query: 'q' })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ code: 'permission_denied' })
  })

  it('业务码 403 / 4 归到 unavailable,不归 permission_denied(上游的取舍:它当作可重试的风控抖动)', async () => {
    mockMeituan(200, { code: 403, msg: '访问受限' })
    const forbidden = await call('query_travel', { query: 'q' })
    expect(forbidden.status).toBe(503)
    await expect(forbidden.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })

    // 403 分支排在认证短语判定之前,所以带"鉴权失败"的 403 也走 unavailable。
    mockMeituan(403, { code: 403, msg: '鉴权失败' })
    await expect((await call('query_travel', { query: 'q' })).json())
      .resolves.toMatchObject({ code: 'unavailable' })

    mockMeituan(200, { code: 4, msg: '参数异常' })
    expect((await call('query_travel', { query: 'q' })).status).toBe(503)
  })

  it('code=0 但 data 是认证失败提示 → unavailable(上游自相矛盾,不赖调用方凭证)', async () => {
    mockMeituan(200, { code: 0, data: '鉴权失败,请联系管理员' })
    const res = await call('query_travel', { query: 'q' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      message: '鉴权失败,请联系管理员',
      retryable: true,
    })
  })

  it('code=0 但没有正文 → unavailable', async () => {
    mockMeituan(200, { code: 0, data: '   ' })
    const res = await call('query_travel', { query: 'q' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('非法 JSON → unavailable,不把上游原文当结果透出', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>502 Bad Gateway</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }))))
    const res = await call('query_travel', { query: 'q' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable' })
  })

  it('传输层抛错 → unavailable 且可重试,不冒成 internal', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('socket hang up'))))
    const res = await call('query_travel', { query: 'q' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      message: expect.stringContaining('socket hang up') as unknown as string,
      retryable: true,
    })
  })

  it('读 body 途中断流 → unavailable(超时可能落在正文传输中,不能漏成 internal)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"code":0,'))
          controller.error(new Error('terminated'))
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))))
    const res = await call('query_travel', { query: 'q' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockMeituan(200, ok('x'))
    const res = await call('query_travel', { query: 'q' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
