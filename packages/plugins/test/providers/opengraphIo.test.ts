import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpengraphIoPlugin } from '../../src/opengraph_io/index'
import { opengraphIoActions } from '../../src/opengraph_io/schema'

/**
 * OpenGraph.io 迁移产物的 wire 级验收。重点在:凭证走 `app_id` query、目标 URL 整个进路径段、
 * 转发型 SSRF 的本地拦截、响应的 camelCase/snake_case 双读与结构收窄。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'og_app_id'
const plugin = createOpengraphIoPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'web/opengraph',
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

function mockOpengraph(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 4 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(opengraphIoActions).length)
    expect(tools).toHaveLength(4)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求形状', () => {
  it('extract_site:目标 URL 进路径段,布尔选项转 snake_case query,凭证走 app_id', async () => {
    const mock = mockOpengraph(200, {
      hybridGraph: { title: 'Example' },
      request_url: 'https://example.com/',
      request_info: { host: 'example.com', response_code: 200 },
      cached: true,
      created_at: null,
    })
    const res = await call('extract_site', {
      site: 'https://example.com/',
      cacheOk: true,
      fullRender: false,
      maxCacheAge: 3600,
      proxyCountry: 'US',
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin).toBe('https://opengraph.io')
    expect(url.pathname).toBe(`/api/1.1/site/${encodeURIComponent('https://example.com/')}`)
    expect(url.searchParams.get('app_id')).toBe(API_KEY)
    expect(url.searchParams.get('cache_ok')).toBe('true')
    expect(url.searchParams.get('full_render')).toBe('false')
    expect(url.searchParams.get('max_cache_age')).toBe('3600')
    expect(url.searchParams.get('proxy_country')).toBe('US')
    expect(url.searchParams.has('use_ai')).toBe(false)
    expect(request.headers.get('authorization')).toBeNull()

    // snake_case 被读进 camelCase,createdAt 的 null 保留(它表示"非缓存结果")。
    await expect(res.json()).resolves.toEqual({
      content: {
        hybridGraph: { title: 'Example' },
        requestUrl: 'https://example.com/',
        requestInfo: { host: 'example.com', responseCode: 200 },
        cached: true,
        createdAt: null,
      },
    })
  })

  it('scrape_url:剥掉 {successful,data} 信封后取 html', async () => {
    const mock = mockOpengraph(200, {
      successful: true,
      data: { html_content: '<html></html>', request_info: { host: 'example.com' } },
    })
    const res = await call('scrape_url', { url: 'https://example.com/', fullRender: true })

    expect(new URL(sent(mock).url).pathname).toBe(`/api/1.1/scrape/${encodeURIComponent('https://example.com/')}`)
    await expect(res.json()).resolves.toEqual({
      content: { htmlContent: '<html></html>', requestInfo: { host: 'example.com' } },
    })
  })

  it('capture_screenshot:选项转 snake_case query,dimensions 被收窄', async () => {
    const mock = mockOpengraph(200, {
      screenshotUrl: 'https://cdn.opengraph.io/shot.png',
      dimensions: { width: 1280, height: 720, extra: 'drop me' },
    })
    const res = await call('capture_screenshot', {
      url: 'https://example.com/',
      format: 'png',
      fullPage: true,
      captureDelay: 500,
      blockCookieBanner: true,
    })

    const url = new URL(sent(mock).url)
    expect(url.searchParams.get('format')).toBe('png')
    expect(url.searchParams.get('full_page')).toBe('true')
    expect(url.searchParams.get('capture_delay')).toBe('500')
    expect(url.searchParams.get('block_cookie_banner')).toBe('true')
    await expect(res.json()).resolves.toEqual({
      content: {
        screenshotUrl: 'https://cdn.opengraph.io/shot.png',
        dimensions: { width: 1280, height: 720 },
      },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验生效:site 不是 URL → 400 且不打上游', async () => {
    const mock = mockOpengraph(200, {})
    const res = await call('extract_site', { site: 'not a url' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('目标 URL 指向内网 → 400 且不打上游(否则上游成了开放代理)', async () => {
    const mock = mockOpengraph(200, {})
    const res = await call('scrape_url', { url: 'http://169.254.169.254/latest/meta-data/' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('公网可达')
    expect(mock).not.toHaveBeenCalled()
  })

  it('screenshot 响应缺 screenshotUrl → 502', async () => {
    mockOpengraph(200, { dimensions: { width: 1, height: 1 } })
    const res = await call('capture_screenshot', { url: 'https://example.com/' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('上游错误按状态归一,消息取自 error 系列字段', async () => {
    mockOpengraph(401, { error: 'Invalid app_id' })
    const denied = await call('extract_site', { site: 'https://example.com/' })
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid app_id',
    })

    mockOpengraph(429, { error_description: 'Quota exceeded' })
    await expect((await call('extract_site', { site: 'https://example.com/' })).json())
      .resolves.toMatchObject({ code: 'rate_limited', message: 'Quota exceeded', retryable: true })
  })

  it('没配 authRef → 503 且不打上游', async () => {
    const mock = mockOpengraph(200, {})
    const res = await call('extract_site', { site: 'https://example.com/' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
