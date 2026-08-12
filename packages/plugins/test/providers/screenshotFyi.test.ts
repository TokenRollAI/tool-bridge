import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createScreenshotFyiPlugin } from '../../src/screenshot_fyi/index'
import { screenshotFyiActions } from '../../src/screenshot_fyi/schema'

/**
 * screenshot.fyi 迁移产物的 wire 级验收。断言都经真实 envelope,不直调内部函数。
 *
 * 这个 provider 只有一个 action,所以"两个代表性调用"落在**同一 action 的两种形状**上:
 * 全参数(每个可选参数都要正确 stringify 进 query)与最小参数(省略的不能冒出来)。
 * 迁移在这里最容易丢的是 boolean → 'true'/'false' 的显式转换,以及 `false` 被当成缺省丢掉。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'sk_screenshot_test'
const TARGET = 'https://example.com/pricing'
const plugin = createScreenshotFyiPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'media/screenshot-fyi',
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

function call(args: unknown, opts?: { auth?: string | null }): Promise<Response> {
  return envelope({ tool: 'Call', arguments: { name: 'take_screenshot', args } }, opts)
}

function mockUpstream(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(
    typeof payload === 'string' ? payload : JSON.stringify(payload),
    { status, headers: { 'content-type': 'application/json' } },
  )))
  vi.stubGlobal('fetch', fn)
  return fn
}

/** 取上游收到的那个请求。 */
function sent(mock: ReturnType<typeof vi.fn>): Request {
  return (mock.mock.calls[0] as [Request])[0]
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('契约面', () => {
  it('List 出全部 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(screenshotFyiActions).length)
    expect(tools.map(t => t.name)).toEqual(['take_screenshot'])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
    // 截图要在上游侧渲染并落一份文件,不是纯读。
    expect(tools[0]?.effect).toBe('write')
  })
})

describe('请求构造', () => {
  it('全参数:凭证进 accessKey query,布尔转成字面 true/false', async () => {
    const mock = mockUpstream(200, { url: 'https://cdn.screenshot.fyi/shot-1.png' })
    const res = await call({
      url: TARGET,
      width: 1280,
      height: 720,
      fullPage: true,
      darkMode: false,
      disableCookieBanners: true,
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      content: { url: 'https://cdn.screenshot.fyi/shot-1.png' },
    })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.headers.get('accept')).toBe('application/json')
    const url = new URL(request.url)
    expect(url.origin).toBe('https://www.screenshot.fyi')
    expect(url.pathname).toBe('/api/take')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      accessKey: API_KEY,
      url: TARGET,
      width: '1280',
      height: '720',
      fullPage: 'true',
      // false 是**显式选择**(强制关掉暗色),不是"没给",不能被当成缺省丢掉。
      darkMode: 'false',
      disableCookieBanners: 'true',
    })
  })

  it('最小参数:省略的可选参数不出现在 query 里', async () => {
    const mock = mockUpstream(200, { url: 'https://cdn.screenshot.fyi/shot-2.png' })
    await call({ url: TARGET })
    const url = new URL(sent(mock).url)
    expect([...url.searchParams.keys()].sort()).toEqual(['accessKey', 'url'])
  })

  it('平台不注入 user-agent(迁移时刻意去掉了上游那个头)', async () => {
    const mock = mockUpstream(200, { url: 'https://cdn.screenshot.fyi/shot-3.png' })
    await call({ url: TARGET })
    expect(sent(mock).headers.get('user-agent')).toBeNull()
  })
})

describe('校验与错误', () => {
  it('入参校验生效:url 不是 URL → 400 且不打上游', async () => {
    const mock = mockUpstream(200, { url: 'https://cdn.screenshot.fyi/x.png' })
    const res = await call({ url: 'not-a-url' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('入参校验生效:width 为 0 违反 minimum → 400 且不打上游', async () => {
    const mock = mockUpstream(200, { url: 'https://cdn.screenshot.fyi/x.png' })
    const res = await call({ url: TARGET, width: 0 })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游 401 → permission_denied;429 → rate_limited 且 retryable', async () => {
    mockUpstream(401, { error: 'Invalid access key' })
    const denied = await call({ url: TARGET })
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid access key',
    })

    mockUpstream(429, { error: 'Rate limit exceeded' })
    const limited = await call({ url: TARGET })
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('错误消息把顶层 error 与 details[0].message 拼起来(缺参数时真话在 details 里)', async () => {
    mockUpstream(400, { error: 'Invalid request', details: [{ message: 'width must be positive' }] })
    await expect((await call({ url: TARGET })).json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'Invalid request: width must be positive',
    })
  })

  it('上游 200 但没给 url → unavailable(不把空结果当成功透出)', async () => {
    mockUpstream(200, { status: 'queued' })
    const res = await call({ url: TARGET })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('上游回非 JSON → unavailable', async () => {
    mockUpstream(200, '<html>gateway error</html>')
    expect((await call({ url: TARGET })).status).toBe(503)
  })

  it('没配 authRef → unavailable,消息说清怎么修,且不打上游', async () => {
    const mock = mockUpstream(200, { url: 'https://cdn.screenshot.fyi/x.png' })
    const res = await call({ url: TARGET }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })

  it('渲染挂死 → 30s 后中止并归一成 unavailable,而不是一直吊着', async () => {
    // 不等真的 30 秒:替掉 AbortSignal.timeout 拿到一个自己能拨的信号。这样既断言了
    // 超时**确实按 30s 挂上去**,也断言了信号一路穿到出站请求、中止后被映射成 504。
    const controller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    vi.stubGlobal('fetch', vi.fn((request: Request) => new Promise<Response>((_resolve, reject) => {
      request.signal.addEventListener('abort', () => {
        reject(request.signal.reason as Error)
      })
      controller.abort(new DOMException('aborted due to timeout', 'TimeoutError'))
    })))

    const res = await call({ url: TARGET })
    expect(timeout).toHaveBeenCalledWith(30_000)
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: 'screenshot.fyi 30s 内没有返回截图',
    })
  })
})
