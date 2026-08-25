import { describe, expect, it, vi } from 'vitest'
import { createProviderHarness } from '../support/providerHarness'
import { createZhihuPlugin } from '../../src/zhihu/index'
import { zhihuActions } from '../../src/zhihu/schema'

/**
 * Zhihu 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 大驼峰 query 键的映射、HTTP 200 里那层业务码 `Code`、zhida 恒发 stream:false。
 */

const API_KEY = 'zhihu_access_secret'
const plugin = createZhihuPlugin()

const {
  call,
  envelope,
  sent,
  mockJson: mockZhihu,
} = createProviderHarness({
  mountPath: 'search/zhihu',
  plugin,
  upstreamAuth: API_KEY,
})

describe('契约面', () => {
  it('List 出全部 4 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(zhihuActions).length)
    expect(tools).toHaveLength(4)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求成形', () => {
  it('zhihu_search:小驼峰入参映射成大驼峰 query,凭证走 Bearer', async () => {
    const mock = mockZhihu(200, { Code: 0, Message: 'ok', Data: { HasMore: false, Items: [] } })
    const res = await call('zhihu_search', { query: '知乎', count: 3 })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://developer.zhihu.com/api/v1/content/zhihu_search')
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(url.searchParams.get('Query')).toBe('知乎')
    expect(url.searchParams.get('Count')).toBe('3')
    await expect(res.json()).resolves.toMatchObject({
      content: { Code: 0, Data: { HasMore: false } },
    })
  })

  it('global_search:省略的可选参数不出现在 query 里', async () => {
    const mock = mockZhihu(200, { Code: 0, Data: { Items: [] } })
    await call('global_search', { query: 'rust', searchDB: 'realtime' })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/v1/content/global_search')
    expect(url.searchParams.get('Query')).toBe('rust')
    expect(url.searchParams.get('SearchDB')).toBe('realtime')
    expect(url.searchParams.has('Count')).toBe(false)
    expect(url.searchParams.has('Filter')).toBe(false)
  })

  it('hot_list:Limit 进 query,且带上时间戳头', async () => {
    const mock = mockZhihu(200, { Code: 0, Data: { Total: 1, Items: [{ Title: '热榜' }] } })
    const res = await call('hot_list', { limit: 1 })

    const request = sent(mock)
    expect(new URL(request.url).searchParams.get('Limit')).toBe('1')
    expect(Number(request.headers.get('x-request-timestamp'))).toBeGreaterThan(0)
    await expect(res.json()).resolves.toMatchObject({
      content: { Data: { Items: [{ Title: '热榜' }] } },
    })
  })

  it('zhida:POST /v1/chat/completions,body 恒带 stream:false', async () => {
    const mock = mockZhihu(200, { id: 'c1', choices: [{ index: 0, finish_reason: 'stop' }] })
    const res = await call('zhida', {
      model: 'zhida-fast-1p5',
      messages: [{ role: 'user', content: '你好' }],
    })

    const request = sent(mock)
    expect(request.url).toBe('https://developer.zhihu.com/v1/chat/completions')
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      model: 'zhida-fast-1p5',
      messages: [{ role: 'user', content: '你好' }],
      stream: false,
    })
    await expect(res.json()).resolves.toMatchObject({ content: { id: 'c1' } })
  })
})

describe('业务码 Code(HTTP 200 也可能是失败)', () => {
  it('Code 为 0 时原样透出', async () => {
    mockZhihu(200, { Code: 0, Message: '', Data: { Total: 0, Items: [] } })
    const res = await call('hot_list', {})
    expect(res.status).toBe(200)
  })

  it.each([
    [10001, 400, 'invalid_argument'],
    [20001, 401, 'permission_denied'],
    [30001, 429, 'rate_limited'],
  ])('Code %i 在 HTTP 200 里也归一成 %i', async (code, status, tbCode) => {
    mockZhihu(200, { Code: code, Message: '业务失败' })
    const res = await call('hot_list', {})
    expect(res.status).toBe(status)
    await expect(res.json()).resolves.toMatchObject({ code: tbCode, message: '业务失败' })
  })

  it('Code 为 30001 时标 retryable', async () => {
    mockZhihu(200, { Code: 30001, Message: '限流' })
    await expect((await call('hot_list', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('表外的非 0 业务码当上游故障', async () => {
    mockZhihu(200, { Code: 99999, Message: '未知' })
    const res = await call('hot_list', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:query 给空串 → 400 且不打上游', async () => {
    const mock = mockZhihu(200, {})
    const res = await call('zhihu_search', { query: '' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('count 超出 1..10 → 400 且不打上游', async () => {
    const mock = mockZhihu(200, {})
    expect((await call('zhihu_search', { query: 'x', count: 11 })).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('strictObject 挡住未知字段 → 400 且不打上游', async () => {
    const mock = mockZhihu(200, {})
    expect((await call('hot_list', { Limit: 3 })).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('zhida 缺 model / messages → 400 且不打上游(生成的 schema 漏了必填)', async () => {
    const mock = mockZhihu(200, {})
    const noModel = await call('zhida', { messages: [{ role: 'user', content: '你好' }] })
    expect(noModel.status).toBe(400)
    expect(((await noModel.json()) as { message: string }).message).toContain('model')

    const noMessages = await call('zhida', { model: 'zhida-agent' })
    expect(noMessages.status).toBe(400)
    expect(((await noMessages.json()) as { message: string }).message).toContain('messages')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 Message', async () => {
    mockZhihu(401, { Message: 'invalid access secret' })
    const unauthorized = await call('hot_list', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'invalid access secret',
    })

    mockZhihu(429, { Message: 'too many requests' })
    const limited = await call('hot_list', {})
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({
      code: 'rate_limited',
      retryable: true,
    })

    mockZhihu(500, {})
    await expect((await call('hot_list', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('上游回非 JSON → unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>502</html>', { status: 200 }))))
    const res = await call('hot_list', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ message: '知乎返回了非法 JSON' })
  })

  it('传输层失败归一成 unavailable,而非裸 Error 抹成 internal 500', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('socket hang up'))))
    const res = await call('hot_list', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      message: '知乎请求失败: socket hang up',
    })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockZhihu(200, {})
    const res = await call('hot_list', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
