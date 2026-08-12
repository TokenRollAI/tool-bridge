import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApifyPlugin } from '../../src/apify/index'
import { apifyActions } from '../../src/apify/schema'

/**
 * Apify 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * `{data}` 包裹的条件式拆包(dataset items 是裸数组)、布尔 query 参数传 1/0、
 * run_actor 即使没给 input 也发空对象体、以及 memoryMbytes → memory 的参数改名。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'apify_api_token'
const plugin = createApifyPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'scraping/apify',
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

function mockApify(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 5 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(apifyActions).length)
    expect(tools).toHaveLength(5)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
    expect(tools.find(t => t.name === 'run_actor')?.effect).toBe('write')
    expect(tools.find(t => t.name === 'get_run')?.effect).toBe('read')
  })
})

describe('请求组装与 data 拆包', () => {
  it('get_current_user:打 /v2/users/me,data 拆包成 user', async () => {
    const mock = mockApify(200, { data: { id: 'u1', username: 'ada' } })
    const res = await call('get_current_user', {})

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(new URL(request.url).toString()).toBe('https://api.apify.com/v2/users/me')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('accept')).toBe('application/json')

    await expect(res.json()).resolves.toEqual({
      content: { user: { id: 'u1', username: 'ada' } },
    })
  })

  it('没有 data 包裹时整个响应就是结果', async () => {
    mockApify(200, { id: 'act1', name: 'web-scraper' })
    const res = await call('get_actor', { actorId: 'apify~web-scraper' })
    await expect(res.json()).resolves.toEqual({
      content: { actor: { id: 'act1', name: 'web-scraper' } },
    })
  })

  it('actorId 里的 ~ 与 / 被 URL 编码成一个路径段', async () => {
    const mock = mockApify(200, { data: {} })
    await call('get_actor', { actorId: 'apify/web-scraper' })
    expect(new URL(sent(mock).url).pathname).toBe('/v2/acts/apify%2Fweb-scraper')
  })

  it('run_actor:input 作为 body,memoryMbytes/timeoutSecs 改名进 query', async () => {
    const mock = mockApify(201, { data: { id: 'run1', status: 'RUNNING' } })
    const res = await call('run_actor', {
      actorId: 'apify~web-scraper',
      input: { startUrls: [{ url: 'https://example.com' }] },
      build: 'latest',
      memoryMbytes: 2048,
      timeoutSecs: 120,
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    const url = new URL(request.url)
    expect(url.pathname).toBe('/v2/acts/apify~web-scraper/runs')
    expect(url.searchParams.get('build')).toBe('latest')
    expect(url.searchParams.get('memory')).toBe('2048')
    expect(url.searchParams.get('timeout')).toBe('120')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({ startUrls: [{ url: 'https://example.com' }] })

    await expect(res.json()).resolves.toEqual({
      content: { run: { id: 'run1', status: 'RUNNING' } },
    })
  })

  it('run_actor:没给 input 也发一个空对象体', async () => {
    const mock = mockApify(201, { data: {} })
    await call('run_actor', { actorId: 'apify~web-scraper' })
    const request = sent(mock)
    await expect(request.json()).resolves.toEqual({})
    expect([...new URL(request.url).searchParams.keys()]).toEqual([])
  })

  it('get_dataset_items:布尔参数传 1/0,响应是裸数组', async () => {
    const mock = mockApify(200, [{ url: 'https://example.com' }])
    const res = await call('get_dataset_items', {
      datasetId: 'ds1',
      limit: 10,
      offset: 5,
      clean: true,
      skipHidden: false,
    })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v2/datasets/ds1/items')
    expect(url.searchParams.get('limit')).toBe('10')
    expect(url.searchParams.get('offset')).toBe('5')
    expect(url.searchParams.get('clean')).toBe('1')
    expect(url.searchParams.get('skipHidden')).toBe('0')

    await expect(res.json()).resolves.toEqual({
      content: { items: [{ url: 'https://example.com' }] },
    })
  })

  it('get_run:waitForFinishSeconds 改名成 waitForFinish', async () => {
    const mock = mockApify(200, { data: { id: 'run1' } })
    await call('get_run', { runId: 'run1', waitForFinishSeconds: 30 })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v2/actor-runs/run1')
    expect(url.searchParams.get('waitForFinish')).toBe('30')
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:runId 缺失 → 400 且不打上游', async () => {
    const mock = mockApify(200, {})
    const res = await call('get_run', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('waitForFinishSeconds 超出 0..60 → 400 且不打上游', async () => {
    const mock = mockApify(200, {})
    const res = await call('get_run', { runId: 'run1', waitForFinishSeconds: 600 })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('actorId 缺失 → 400 且不打上游(schema 把 get_actor 的它标成了 optional)', async () => {
    const mock = mockApify(200, {})
    const res = await call('get_actor', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('actorId')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 error.message', async () => {
    mockApify(401, { error: { type: 'token-not-provided', message: 'Authentication token is not valid' } })
    const denied = await call('get_current_user', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Authentication token is not valid',
    })

    mockApify(429, { error: { message: 'Rate limit exceeded' } })
    await expect((await call('get_current_user', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    // 上游把执行阶段的 404 也压成 401,这里保留 not_found:actor 不存在不是凭证问题。
    mockApify(404, { error: { type: 'record-not-found', message: 'Actor was not found' } })
    const missing = await call('get_actor', { actorId: 'nope~nope' })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found' })

    mockApify(500, { error: { message: 'Apify is down' } })
    await expect((await call('get_current_user', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('dataset items 不是数组 → unavailable(上游契约破了,不是调用方的错)', async () => {
    mockApify(200, { data: [] })
    const res = await call('get_dataset_items', { datasetId: 'ds1' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockApify(200, {})
    const res = await call('get_current_user', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
