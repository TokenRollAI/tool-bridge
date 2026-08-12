import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createV2exPlugin } from '../../src/v2ex/index'
import { v2exActions } from '../../src/v2ex/schema'

/**
 * V2EX 迁移产物的 wire 级验收。重点钉住几处"迁移最容易迁丢"的地方:
 * API 2.0 与 **legacy API** 的两套约定(后者不带凭证头、响应是裸数组没有信封)、
 * `{success, message, result}` 信封的拆解与 `success:false` 的归一、
 * 总数藏在 `message` 的 `"1/20"` 里、`duration` 是 query 而不是请求体、
 * 以及 DELETE 的空响应体算"接受"。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'v2ex_pat_deadbeef'
const plugin = createV2exPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'social/v2ex',
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

/**
 * `payload` 为 `null` 时构造**没有响应体**的响应。
 * 注意 204 必须传 `null` 而不是 `''` —— `new Response('', {status:204})` 在 undici 下直接 TypeError。
 */
function mockV2ex(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const body = payload === null ? null : (typeof payload === 'string' ? payload : JSON.stringify(payload))
  const fn = vi.fn(() => Promise.resolve(new Response(body, {
    status,
    headers: body === null ? {} : { 'content-type': 'application/json' },
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
  it('List 出全部 13 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(v2exActions).length)
    expect(tools).toHaveLength(13)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'boost_topic',
      'create_token',
      'delete_notification',
      'get_current_member',
      'get_current_token',
      'get_node',
      'get_topic',
      'list_hot_topics',
      'list_latest_topics',
      'list_node_topics',
      'list_notifications',
      'list_topic_replies',
      'set_topic_sticky',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('API 2.0:请求拼装', () => {
  it('get_current_member:打 /api/v2/member,凭证走 Bearer 头', async () => {
    const mock = mockV2ex(200, { success: true, result: { id: 1, username: 'alice' } })
    const res = await call('get_current_member', {})

    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('GET')
    expect(url.origin).toBe('https://www.v2ex.com')
    expect(url.pathname).toBe('/api/v2/member')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('accept')).toBe('application/json')
    // GET 不该带 content-type。
    expect(request.headers.get('content-type')).toBeNull()

    await expect(res.json()).resolves.toEqual({ content: { member: { id: 1, username: 'alice' } } })
  })

  it('分页参数 p 进 query;空串按"没给"处理', async () => {
    const mock = mockV2ex(200, { success: true, result: [] })
    await call('list_notifications', { p: 3 })
    expect(new URL(sent(mock).url).searchParams.get('p')).toBe('3')

    vi.unstubAllGlobals()
    const bare = mockV2ex(200, { success: true, result: [] })
    await call('list_notifications', {})
    expect([...new URL(sent(bare).url).searchParams.keys()]).toEqual([])
  })

  it('get_node 的 node_name 做 URL 编码,不会跳出路径段', async () => {
    const mock = mockV2ex(200, { success: true, result: { name: 'a/b' } })
    await call('get_node', { node_name: 'a/b' })
    expect(new URL(sent(mock).url).pathname).toBe('/api/v2/nodes/a%2Fb')
  })

  it('create_token 的请求体是 JSON,带 content-type', async () => {
    const mock = mockV2ex(200, { success: true, result: { token: 'new_tok' } })
    const res = await call('create_token', { scope: 'regular', expiration: 2592000 })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/api/v2/tokens')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({ scope: 'regular', expiration: 2592000 })
    await expect(res.json()).resolves.toEqual({ content: { token: 'new_tok' } })
  })

  it('set_topic_sticky 的 duration 走 query,POST 的 body 是空的', async () => {
    const mock = mockV2ex(200, { success: true })
    const res = await call('set_topic_sticky', { topic_id: 42, duration: '8hr' })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('POST')
    expect(url.pathname).toBe('/api/v2/topics/42/set-sticky')
    expect(url.searchParams.get('duration')).toBe('8hr')
    // duration 塞进 body 的话 V2EX 会当成没给,悄悄按默认的 15min 置顶。
    expect(await request.text()).toBe('')
    expect(request.headers.get('content-type')).toBeNull()
    await expect(res.json()).resolves.toEqual({ content: { success: true } })
  })

  it('boost_topic / delete_notification 的路径带上数字 id', async () => {
    const boost = mockV2ex(200, { success: true })
    await call('boost_topic', { topic_id: 7 })
    expect(new URL(sent(boost).url).pathname).toBe('/api/v2/topics/7/boost')

    vi.unstubAllGlobals()
    const remove = mockV2ex(200, { success: true })
    await call('delete_notification', { notification_id: 99 })
    expect(sent(remove).method).toBe('DELETE')
    expect(new URL(sent(remove).url).pathname).toBe('/api/v2/notifications/99')
  })
})

describe('legacy API:另一套约定', () => {
  it('list_hot_topics 打 /api/topics/hot.json,**不带** Authorization,响应是裸数组', async () => {
    const mock = mockV2ex(200, [{ id: 1, title: 'hot' }])
    const res = await call('list_hot_topics', {})

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.pathname).toBe('/api/topics/hot.json')
    // legacy 路径上游压根不调 buildV2exHeaders —— 这条断言就是钉"别顺手加 Bearer"。
    expect(request.headers.get('authorization')).toBeNull()
    expect(request.headers.get('accept')).toBe('application/json')

    await expect(res.json()).resolves.toEqual({ content: { topics: [{ id: 1, title: 'hot' }] } })
  })

  it('list_latest_topics 打 latest.json', async () => {
    const mock = mockV2ex(200, [])
    await call('list_latest_topics', {})
    expect(new URL(sent(mock).url).pathname).toBe('/api/topics/latest.json')
  })

  it('legacy 回了信封而不是数组 → unavailable(别把信封当结果透出去)', async () => {
    mockV2ex(200, { success: true, result: [] })
    const res = await call('list_hot_topics', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: expect.stringContaining('must be an array'),
    })
  })

  it('legacy 也要求先配好凭证(上游整个 provider 的 authType 是 api_key)', async () => {
    const mock = mockV2ex(200, [])
    const res = await call('list_hot_topics', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('信封拆解', () => {
  it('总数取自 message 的 "1/20",不是本页条数', async () => {
    mockV2ex(200, {
      success: true,
      message: '1/20',
      result: [{ id: 1 }, { id: 2 }],
    })
    await expect((await call('list_notifications', {})).json()).resolves.toEqual({
      content: { notifications: [{ id: 1 }, { id: 2 }], total: 20 },
    })
  })

  it('message 拿不到总数时退回本页条数', async () => {
    mockV2ex(200, { success: true, message: 'ok', result: [{ id: 1 }] })
    await expect((await call('list_notifications', {})).json())
      .resolves.toMatchObject({ content: { total: 1 } })

    vi.unstubAllGlobals()
    mockV2ex(200, { success: true, result: [] })
    await expect((await call('list_notifications', {})).json())
      .resolves.toMatchObject({ content: { total: 0 } })
  })

  it('HTTP 200 + success:false 不能当成功返回,归 invalid_argument(重试不会变)', async () => {
    mockV2ex(200, { success: false, message: 'node not found' })
    const res = await call('get_node', { node_name: 'nope' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'node not found',
    })
    // 关键:不能是可重试码,否则 agent 会对一个永远不会变的结果反复重试。
    expect(((await (await call('get_node', { node_name: 'nope' })).json()) as { retryable?: boolean }).retryable)
      .not.toBe(true)
  })

  it('result 键缺席 → unavailable(整形函数拿到 undefined 会静默出空)', async () => {
    mockV2ex(200, { success: true, message: 'ok' })
    const res = await call('get_topic', { topic_id: 1 })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      message: expect.stringContaining('missing result'),
    })
  })

  it('result 是 null 也算给了(与"键缺席"是两回事),但对象类 action 会拦下形状', async () => {
    mockV2ex(200, { success: true, result: null })
    await expect((await call('get_topic', { topic_id: 1 })).json())
      .resolves.toMatchObject({ code: 'unavailable', message: expect.stringContaining('must be an object') })
  })

  it('该回数组的 action 回了对象 → unavailable', async () => {
    mockV2ex(200, { success: true, result: { not: 'an array' } })
    await expect((await call('list_topic_replies', { topic_id: 1 })).json())
      .resolves.toMatchObject({ code: 'unavailable', message: expect.stringContaining('must be an array') })
  })

  it('顶层不是对象 → unavailable', async () => {
    mockV2ex(200, [1, 2, 3])
    await expect((await call('get_current_token', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', message: expect.stringContaining('must be an object') })
  })

  it('create_token 说成功却没带回 token → unavailable(那个值只有这一次能拿到)', async () => {
    mockV2ex(200, { success: true, result: { scope: 'regular' } })
    await expect((await call('create_token', { scope: 'regular', expiration: 2592000 })).json())
      .resolves.toMatchObject({ code: 'unavailable', message: expect.stringContaining('missing token') })
  })
})

describe('只关心"被接受了没有"的那几个 action', () => {
  it('DELETE 的空响应体算接受(V2EX 就是不回体)', async () => {
    mockV2ex(204, null)
    await expect((await call('delete_notification', { notification_id: 1 })).json())
      .resolves.toEqual({ content: { success: true } })
  })

  it('信封说 success:false → invalid_argument,不谎报 success:true', async () => {
    mockV2ex(200, { success: false, message: 'not your topic' })
    const res = await call('boost_topic', { topic_id: 1 })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'not your topic',
    })
  })

  it('既不是 success:true 也不是 false → unavailable(形状不对,不敢当成功)', async () => {
    mockV2ex(200, { message: 'hmm' })
    await expect((await call('set_topic_sticky', { topic_id: 1 })).json())
      .resolves.toMatchObject({ code: 'unavailable', message: expect.stringContaining('missing success=true') })
  })
})

describe('校验与上游错误', () => {
  it('缺必填的 topic_id → 400 且不打上游', async () => {
    const mock = mockV2ex(200, { success: true })
    const res = await call('boost_topic', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('duration 不在枚举里、expiration 不是允许的那几个值,都由 Zod 拦下', async () => {
    const mock = mockV2ex(200, { success: true })
    expect((await call('set_topic_sticky', { topic_id: 1, duration: '2hr' })).status).toBe(400)
    expect((await call('create_token', { scope: 'regular', expiration: 99 })).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游 4xx → invalid_argument,401 / 403 → permission_denied', async () => {
    mockV2ex(400, { message: 'bad request' })
    await expect((await call('get_topic', { topic_id: 1 })).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'bad request' })

    vi.unstubAllGlobals()
    mockV2ex(401, { message: 'invalid token' })
    const unauthorized = await call('get_topic', { topic_id: 1 })
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'invalid token',
    })

    vi.unstubAllGlobals()
    mockV2ex(403, { message: 'scope too narrow' })
    await expect((await call('get_topic', { topic_id: 1 })).json())
      .resolves.toMatchObject({ code: 'permission_denied' })
  })

  it('上游 404 → not_found,429 → rate_limited + retryable', async () => {
    mockV2ex(404, { message: 'topic not found' })
    const missing = await call('get_topic', { topic_id: 1 })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found' })

    vi.unstubAllGlobals()
    mockV2ex(429, { message: 'too many requests' })
    const limited = await call('get_topic', { topic_id: 1 })
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('上游 5xx → unavailable + retryable', async () => {
    mockV2ex(503, { message: 'V2EX is down' })
    const res = await call('get_topic', { topic_id: 1 })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('错误体不是 JSON 时用原文当消息', async () => {
    mockV2ex(502, '<html>bad gateway</html>')
    await expect((await call('get_topic', { topic_id: 1 })).json())
      .resolves.toMatchObject({ code: 'unavailable', message: '<html>bad gateway</html>' })
  })

  it('errors[].detail 也能当消息', async () => {
    mockV2ex(400, { errors: [{ detail: 'topic_id must be positive' }] })
    await expect((await call('get_topic', { topic_id: 1 })).json())
      .resolves.toMatchObject({ message: 'topic_id must be positive' })
  })

  it('没配 authRef → 报错且不打上游', async () => {
    const mock = mockV2ex(200, { success: true })
    const res = await call('get_current_member', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
