import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCoresignalPlugin } from '../../src/coresignal/index'
import { coresignalActions } from '../../src/coresignal/schema'

/**
 * Coresignal 迁移产物的 wire 级验收。重点在:`apikey` 凭证头、preview 的 `page` 从
 * 过滤器里拆到 query、collect 的 fields 重复同名键、上游回非数组载荷时的 502。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'cs_test_key'
const plugin = createCoresignalPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'data/coresignal',
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

function mockCoresignal(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 3 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(coresignalActions).length)
    expect(tools).toHaveLength(3)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求形状', () => {
  it('search:过滤器整体进 POST body,凭证走 apikey 头,只回 ID', async () => {
    const mock = mockCoresignal(200, [11, 22])
    const res = await call('search_base_companies', { name: 'Acme', country: 'United States' })

    const request = sent(mock)
    expect(request.url).toBe('https://api.coresignal.com/cdapi/v2/company_base/search/filter')
    expect(request.method).toBe('POST')
    expect(request.headers.get('apikey')).toBe(API_KEY)
    expect(request.headers.get('authorization')).toBeNull()
    await expect(request.json()).resolves.toEqual({ name: 'Acme', country: 'United States' })
    await expect(res.json()).resolves.toEqual({ content: { ids: [11, 22] } })
  })

  it('preview:page 拆到 query,其余过滤器留在 body', async () => {
    const mock = mockCoresignal(200, [{ id: 7, name: 'Acme' }])
    const res = await call('preview_base_companies', { name: 'Acme', page: 3 })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.pathname).toBe('/cdapi/v2/company_base/search/filter/preview')
    expect(url.searchParams.get('page')).toBe('3')
    await expect(request.json()).resolves.toEqual({ name: 'Acme' })
    await expect(res.json()).resolves.toEqual({ content: { records: [{ id: 7, name: 'Acme' }] } })
  })

  it('collect:标识符进路径,fields 重复同名键', async () => {
    const mock = mockCoresignal(200, { id: 7, name: 'Acme' })
    await call('collect_base_company', { companyIdentifier: 'acme/inc', fields: ['name', 'website'] })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.pathname).toBe('/cdapi/v2/company_base/collect/acme%2Finc')
    expect(url.searchParams.getAll('fields')).toEqual(['name', 'website'])
    expect(request.method).toBe('GET')
  })
})

describe('校验与错误', () => {
  it('入参校验生效:collect 缺 companyIdentifier → 400 且不打上游', async () => {
    const mock = mockCoresignal(200, {})
    const res = await call('collect_base_company', { fields: ['name'] })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游回非数组载荷 → 502(契约破了,不是调用方的错)', async () => {
    mockCoresignal(200, { unexpected: true })
    const res = await call('search_base_companies', { name: 'Acme' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('上游错误按状态归一', async () => {
    mockCoresignal(401, { message: 'invalid api key' })
    const denied = await call('search_base_companies', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'invalid api key',
    })

    mockCoresignal(429, { error: 'quota exceeded' })
    await expect((await call('search_base_companies', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', message: 'quota exceeded', retryable: true })
  })

  it('没配 authRef → 503 且不打上游', async () => {
    const mock = mockCoresignal(200, [])
    const res = await call('search_base_companies', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
