import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWolframAlphaApiPlugin } from '../../src/wolfram_alpha_api/index'
import { wolframAlphaApiActions } from '../../src/wolfram_alpha_api/schema'

/**
 * Wolfram|Alpha 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 凭证进 query 而非 header、响应是纯文本、**HTTP 200 也可能是凭证错误**,
 * 以及 recognizer 那几个大小写混杂的字段名(抄错一个字母就静默丢字段)。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'WOLFRAM-DEADBEEF'
const plugin = createWolframAlphaApiPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'compute/wolfram',
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

/** Wolfram 回的是纯文本(recognizer 那条也只是把 JSON 当文本回)。 */
function mockWolfram(status: number, body: string): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(body, {
    status,
    headers: { 'content-type': 'text/plain' },
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
  it('~describe 报成单个 tools/v1 export', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    await expect(res.json()).resolves.toEqual({
      protocolVersion: 'plugin/v2',
      exports: [{ id: 'actions', profile: 'tools/v1', description: 'Wolfram|Alpha' }],
    })
  })

  it('List 出全部 3 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(wolframAlphaApiActions).length)
    expect(tools).toHaveLength(3)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'get_short_answer',
      'get_spoken_result',
      'validate_query',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求成形', () => {
  it('get_short_answer:凭证进 query(不是 header),问题走 i,超时转成字符串', async () => {
    const mock = mockWolfram(200, '4 kilometers')
    const res = await call('get_short_answer', { query: 'how far is the moon', units: 'metric', timeout: 5 })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('GET')
    expect(url.origin + url.pathname).toBe('https://api.wolframalpha.com/v1/result')
    // 凭证在 URL 里,不是 header —— 这是 Wolfram API 本身的设计。
    expect(url.searchParams.get('appid')).toBe(API_KEY)
    expect(request.headers.get('authorization')).toBeNull()
    expect(Object.fromEntries(url.searchParams)).toEqual({
      appid: API_KEY,
      i: 'how far is the moon',
      units: 'metric',
      timeout: '5',
    })

    await expect(res.json()).resolves.toEqual({
      content: { query: 'how far is the moon', answer: '4 kilometers' },
    })
  })

  it('get_spoken_result 打 /v1/spoken,省略的可选参数不出现在 query 里', async () => {
    const mock = mockWolfram(200, 'The answer is 42.')
    const res = await call('get_spoken_result', { query: '6*7' })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v1/spoken')
    expect([...url.searchParams.keys()].sort()).toEqual(['appid', 'i'])
    await expect(res.json()).resolves.toEqual({
      content: { query: '6*7', result: 'The answer is 42.' },
    })
  })

  it('validate_query 打的是 queryrecognizer 端点(另一个域名),mode 缺省补 default', async () => {
    const mock = mockWolfram(200, JSON.stringify({ query: [{ accepted: 'true' }] }))
    await call('validate_query', { query: 'integrate x^2' })

    const url = new URL(sent(mock).url)
    expect(url.origin + url.pathname).toBe('https://www.wolframalpha.com/queryrecognizer/query.jsp')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      appid: API_KEY,
      input: 'integrate x^2',
      mode: 'default',
      output: 'json',
    })
  })

  it('mode=voice 原样带上', async () => {
    const mock = mockWolfram(200, JSON.stringify({ query: [{ accepted: true }] }))
    const res = await call('validate_query', { query: 'weather', mode: 'voice' })
    expect(new URL(sent(mock).url).searchParams.get('mode')).toBe('voice')
    await expect(res.json()).resolves.toMatchObject({ content: { mode: 'voice' } })
  })
})

describe('响应整形', () => {
  it('recognizer 的字段名大小写混杂:timing 在顶层,significance 全小写,path 在 summarybox 里', async () => {
    mockWolfram(200, JSON.stringify({
      timing: '0.256',
      query: [{
        accepted: 'true',
        domain: 'Calculus',
        resultsignificancescore: 100,
        spellingCorrection: 'integrate x^2',
        summarybox: { path: '/summarybox/abc.png' },
        // 顶层的 timing 才是出参要的那个;query[0] 里这个同名字段是别的东西。
        timing: 999,
      }],
    }))
    const res = await call('validate_query', { query: 'integrate x^2' })
    await expect(res.json()).resolves.toEqual({
      content: {
        query: 'integrate x^2',
        mode: 'default',
        accepted: true,
        domain: 'Calculus',
        timingMs: 0.256,
        resultSignificanceScore: 100,
        spellingCorrection: 'integrate x^2',
        summaryBoxPath: '/summarybox/abc.png',
      },
    })
  })

  it('缺席的可空字段一律回 null(不是字段缺席),accepted 认字符串 "true"', async () => {
    mockWolfram(200, JSON.stringify({ query: [{ accepted: 'false' }] }))
    const res = await call('validate_query', { query: 'asdfgh' })
    await expect(res.json()).resolves.toEqual({
      content: {
        query: 'asdfgh',
        mode: 'default',
        accepted: false,
        domain: null,
        timingMs: null,
        resultSignificanceScore: null,
        spellingCorrection: null,
        summaryBoxPath: null,
      },
    })
  })

  it('recognizer 没给 query 列表 → unavailable(契约不符是上游的问题)', async () => {
    mockWolfram(200, JSON.stringify({ timing: 1 }))
    const res = await call('validate_query', { query: 'x' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('recognizer 回的不是 JSON → unavailable', async () => {
    mockWolfram(200, '<html>maintenance</html>')
    const res = await call('validate_query', { query: 'x' })
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('空正文 → unavailable(出参声明 answer 是必填字符串,空串顶不上)', async () => {
    mockWolfram(200, '')
    const res = await call('get_short_answer', { query: 'x' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:timeout 必须是正整数 → 400 且不打上游', async () => {
    const mock = mockWolfram(200, 'x')
    const res = await call('get_short_answer', { query: 'x', timeout: 0 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('纯空白的 query 能过 Zod 的 min(1),但在本地就挡下', async () => {
    const mock = mockWolfram(200, 'x')
    const res = await call('get_short_answer', { query: '  \t ' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('query')
    expect(mock).not.toHaveBeenCalled()
  })

  it('HTTP 200 + "Invalid appid" 是凭证错误,不是答案 —— 必须报错而不是把它当正文返回', async () => {
    mockWolfram(200, 'Error 1: Invalid appid')
    const res = await call('get_short_answer', { query: 'x' })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Error 1: Invalid appid',
    })
  })

  it('上游 4xx → invalid_argument,5xx → unavailable + retryable,429 → rate_limited', async () => {
    mockWolfram(400, 'No short answer available')
    const bad = await call('get_short_answer', { query: 'x' })
    expect(bad.status).toBe(400)
    await expect(bad.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'No short answer available',
    })

    vi.unstubAllGlobals()
    mockWolfram(429, 'Too many requests')
    await expect((await call('get_short_answer', { query: 'x' })).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockWolfram(503, 'Service unavailable')
    await expect((await call('get_short_answer', { query: 'x' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('501 是"这个查询看不懂"而不是"没实现" → invalid_argument,不标可重试', async () => {
    mockWolfram(501, 'Wolfram|Alpha did not understand your input')
    const res = await call('get_spoken_result', { query: 'asdfgh' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'Wolfram|Alpha did not understand your input',
    })
  })

  it('错误体是空的时候退回状态码消息', async () => {
    mockWolfram(418, '   ')
    const res = await call('get_short_answer', { query: 'x' })
    await expect(res.json()).resolves.toMatchObject({ message: 'Wolfram|Alpha 返回 HTTP 418' })
  })

  it('没配 authRef → unavailable 且不打上游(凭证在 URL 里,不能拿空串去拼)', async () => {
    const mock = mockWolfram(200, 'x')
    const res = await call('get_short_answer', { query: 'x' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
