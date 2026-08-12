import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCrustdataPlugin } from '../../src/crustdata/index'
import { crustdataActions } from '../../src/crustdata/schema'

/**
 * Crustdata 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * camelCase → snake_case 的键名映射、标识符数组的互斥校验、裸数组响应的整形、
 * 以及 autocomplete 的空串 query 不能被当作缺失剥掉。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'crustdata_live_key'
const plugin = createCrustdataPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'data/crustdata',
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

function mockCrustdata(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

/** identify / enrich 的上游响应样本(裸数组 + snake_case)。 */
const IDENTIFY_PAYLOAD = [{
  matched_on: 'openai.com',
  match_type: 'domain',
  matches: [{
    confidence_score: 0.98,
    company_data: { crustdata_company_id: 42, basic_info: { name: 'OpenAI', primary_domain: 'openai.com' } },
  }],
}]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 4 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(crustdataActions).length)
    expect(tools).toHaveLength(4)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求拼装与响应整形', () => {
  it('identify:POST JSON,camelCase 入参映射成 snake_case,响应整回 camelCase', async () => {
    const mock = mockCrustdata(200, IDENTIFY_PAYLOAD)
    const res = await call('identify_companies', {
      domains: ['openai.com'],
      fields: ['basic_info'],
      exactMatch: true,
    })

    const request = sent(mock)
    expect(request.url).toBe('https://api.crustdata.com/company/identify')
    expect(request.method).toBe('POST')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('x-api-version')).toBe('2025-11-01')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      domains: ['openai.com'],
      fields: ['basic_info'],
      exact_match: true,
    })

    await expect(res.json()).resolves.toEqual({
      content: {
        results: [{
          matchedOn: 'openai.com',
          matchType: 'domain',
          matches: [{
            confidenceScore: 0.98,
            companyData: {
              crustdata_company_id: 42,
              basic_info: { name: 'OpenAI', primary_domain: 'openai.com' },
            },
          }],
        }],
      },
    })
  })

  it('enrich 走 /company/enrich,professionalNetworkProfileUrls 映射成 snake_case', async () => {
    const mock = mockCrustdata(200, IDENTIFY_PAYLOAD)
    await call('enrich_companies', { professionalNetworkProfileUrls: ['https://example.com/co/openai'] })
    const request = sent(mock)
    expect(request.url).toBe('https://api.crustdata.com/company/enrich')
    await expect(request.json()).resolves.toEqual({
      professional_network_profile_urls: ['https://example.com/co/openai'],
    })
  })

  it('search:游标缺失时归一成 null(出参声明的是 nullable,不能省略键)', async () => {
    const mock = mockCrustdata(200, { companies: [{ crustdata_company_id: 7 }] })
    const res = await call('search_companies', {
      filters: { field: 'headcount', operator: '=>', value: 100 },
      sorts: [{ column: 'headcount', order: 'desc' }],
      limit: 10,
    })

    await expect(sent(mock).json()).resolves.toEqual({
      filters: { field: 'headcount', operator: '=>', value: 100 },
      sorts: [{ column: 'headcount', order: 'desc' }],
      limit: 10,
    })
    await expect(res.json()).resolves.toEqual({
      content: { companies: [{ crustdata_company_id: 7 }], nextCursor: null, totalCount: null },
    })
  })

  it('autocomplete:空串 query 照发(是"给我常见值"的显式输入,不是缺失)', async () => {
    const mock = mockCrustdata(200, { suggestions: [{ value: 'Software', extra: 'ignored' }] })
    const res = await call('autocomplete_companies', { field: 'industry', query: '' })

    const request = sent(mock)
    expect(request.url).toBe('https://api.crustdata.com/company/search/autocomplete')
    await expect(request.json()).resolves.toEqual({ field: 'industry', query: '' })
    // 出参只保留 value,上游多回的键被剥掉。
    await expect(res.json()).resolves.toEqual({ content: { suggestions: [{ value: 'Software' }] } })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:filters.operator 不在枚举内 → 400 且不打上游', async () => {
    const mock = mockCrustdata(200, {})
    const res = await call('search_companies', { filters: { field: 'headcount', operator: '>=' } })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('标识符数组必须恰好给一个:给两个 → 400 且不打上游', async () => {
    const mock = mockCrustdata(200, [])
    const res = await call('identify_companies', { domains: ['a.com'], names: ['A'] })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('标识符')
    expect(mock).not.toHaveBeenCalled()
  })

  it('标识符数组一个都不给 → 400 且不打上游', async () => {
    const mock = mockCrustdata(200, [])
    const res = await call('enrich_companies', { fields: ['basic_info'] })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 reason/error/message', async () => {
    mockCrustdata(401, { reason: 'Invalid token' })
    const unauthorized = await call('identify_companies', { domains: ['a.com'] })
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid token',
    })

    mockCrustdata(429, { error: 'Rate limit exceeded' })
    await expect((await call('identify_companies', { domains: ['a.com'] })).json())
      .resolves.toMatchObject({ code: 'rate_limited', message: 'Rate limit exceeded', retryable: true })

    mockCrustdata(500, { message: 'Crustdata is down' })
    await expect((await call('identify_companies', { domains: ['a.com'] })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('identify 回非数组 → unavailable(上游破契约,不是调用方的错)', async () => {
    mockCrustdata(200, { results: [] })
    const res = await call('identify_companies', { domains: ['a.com'] })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockCrustdata(200, [])
    const res = await call('identify_companies', { domains: ['a.com'] }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
