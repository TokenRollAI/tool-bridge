import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHackerrankWorkPlugin } from '../../src/hackerrank_work/index'
import { hackerrankWorkActions } from '../../src/hackerrank_work/schema'

/**
 * HackerRank Work 迁移产物的 wire 级验收。重点在 `/x/api/v3` 前缀不被冲掉、
 * 顶层平铺的分页字段被收拢、additional_fields 的逗号拼接,以及 errors 数组里的错误文案。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'hr_test_key'
const plugin = createHackerrankWorkPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'hiring/hackerrank',
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

function mockHackerrank(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

const LIST_PAYLOAD = {
  data: [{ id: 't1', name: 'Backend Screen' }],
  page_total: 1,
  offset: 0,
  total: 12,
  previous: '',
  next: 'https://www.hackerrank.com/x/api/v3/tests?offset=1',
  first: '',
  last: '',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 5 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(hackerrankWorkActions).length)
    expect(tools).toHaveLength(5)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('列表与分页', () => {
  it('凭证走 Bearer,/x/api/v3 前缀保住,分页字段被收拢', async () => {
    const mock = mockHackerrank(200, LIST_PAYLOAD)
    const res = await call('list_tests', { limit: 10, offset: 0 })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    const url = new URL(request.url)
    expect(url.pathname).toBe('/x/api/v3/tests')
    expect(url.searchParams.get('limit')).toBe('10')
    expect(url.searchParams.get('offset')).toBe('0')

    await expect(res.json()).resolves.toEqual({
      content: {
        tests: [{ id: 't1', name: 'Backend Screen' }],
        pagination: {
          page_total: 1,
          offset: 0,
          previous: '',
          next: 'https://www.hackerrank.com/x/api/v3/tests?offset=1',
          first: '',
          last: '',
          // 上游可能回数字,出参统一成字符串。
          total: '12',
        },
      },
    })
  })

  it('省略分页参数时不带对应 query', async () => {
    const mock = mockHackerrank(200, LIST_PAYLOAD)
    await call('list_tests', {})
    const url = new URL(sent(mock).url)
    expect(url.searchParams.has('limit')).toBe(false)
    expect(url.searchParams.has('offset')).toBe(false)
  })

  it('search_test_candidates 把 test_id 编码进路径、search 进 query', async () => {
    const mock = mockHackerrank(200, { ...LIST_PAYLOAD, data: [{ id: 'c1', email: 'a@b.com' }] })
    const res = await call('search_test_candidates', { test_id: 'a/b', search: 'ada', limit: 5 })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/x/api/v3/tests/a%2Fb/candidates/search')
    expect(url.searchParams.get('search')).toBe('ada')
    expect(url.searchParams.get('limit')).toBe('5')
    await expect(res.json()).resolves.toMatchObject({
      content: { candidates: [{ id: 'c1', email: 'a@b.com' }] },
    })
  })
})

describe('详情端点', () => {
  it('additional_fields 逗号拼接,响应的 data 包装被剥掉', async () => {
    const mock = mockHackerrank(200, { data: { id: 't1', name: 'Screen' } })
    const res = await call('get_test', { id: 't1', additional_fields: ['questions', 'tags'] })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/x/api/v3/tests/t1')
    expect(url.searchParams.get('additional_fields')).toBe('questions,tags')
    await expect(res.json()).resolves.toEqual({ content: { test: { id: 't1', name: 'Screen' } } })
  })

  it('详情响应没有 data 包装时原样当资源', async () => {
    mockHackerrank(200, { id: 'c1', full_name: 'Ada' })
    const res = await call('get_test_candidate', { test_id: 't1', candidate_id: 'c1' })
    await expect(res.json()).resolves.toEqual({
      content: { candidate: { id: 'c1', full_name: 'Ada' } },
    })
  })

  it('get_test_candidate 两个 id 都进路径', async () => {
    const mock = mockHackerrank(200, { data: { id: 'c1' } })
    await call('get_test_candidate', { test_id: 't1', candidate_id: 'c/1' })
    expect(new URL(sent(mock).url).pathname).toBe('/x/api/v3/tests/t1/candidates/c%2F1')
  })
})

describe('校验与错误', () => {
  it('入参校验生效:test_id 为空串 → 400 且不打上游', async () => {
    const mock = mockHackerrank(200, LIST_PAYLOAD)
    const res = await call('list_test_candidates', { test_id: '' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('offset 为负 → 400 且不打上游', async () => {
    const mock = mockHackerrank(200, LIST_PAYLOAD)
    const res = await call('list_tests', { offset: -1 })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('列表响应缺 data → 上游故障', async () => {
    mockHackerrank(200, { page_total: 0, offset: 0 })
    await expect((await call('list_tests', {})).json())
      .resolves.toMatchObject({ code: 'unavailable' })
  })

  it('上游错误按状态归一,消息可来自 errors 数组', async () => {
    mockHackerrank(401, { message: 'Invalid API key' })
    await expect((await call('list_tests', {})).json())
      .resolves.toMatchObject({ code: 'permission_denied', message: 'Invalid API key' })

    mockHackerrank(429, { errors: [{ message: 'Rate limit exceeded' }] })
    await expect((await call('list_tests', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true, message: 'Rate limit exceeded' })

    mockHackerrank(400, { errors: ['test_id is invalid'] })
    await expect((await call('list_tests', {})).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'test_id is invalid' })
  })

  it('没配 authRef → 503 且不打上游', async () => {
    const mock = mockHackerrank(200, LIST_PAYLOAD)
    const res = await call('list_tests', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
