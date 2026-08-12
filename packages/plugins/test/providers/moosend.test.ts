import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMoosendPlugin } from '../../src/moosend/index'
import { moosendActions } from '../../src/moosend/schema'

/**
 * Moosend 迁移产物的 wire 级验收。重点在两个"迁移最容易迁丢"的地方:
 * 凭证走 `apikey` query 参数、失败以 HTTP 200 + body 里 `Code`/`Error` 返回。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'moosend_test_key'
const plugin = createMoosendPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'email/moosend',
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

function mockMoosend(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

const OK_LISTS = {
  Code: 0,
  Error: null,
  Context: { Paging: { TotalResults: 1 }, MailingLists: [{ ID: 'l_1', Name: 'Newsletter' }] },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 4 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(moosendActions).length)
    expect(tools).toHaveLength(4)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求形状', () => {
  it('list_mailing_lists:凭证走 apikey query,过滤器同在 query,无 auth 头', async () => {
    const mock = mockMoosend(200, OK_LISTS)
    const res = await call('list_mailing_lists', { WithStatistics: false, SortBy: 'CreatedOn', SortMethod: 'DESC' })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin).toBe('https://api.moosend.com')
    expect(url.pathname).toBe('/v3/lists.json')
    expect(url.searchParams.get('apikey')).toBe(API_KEY)
    expect(url.searchParams.get('WithStatistics')).toBe('false')
    expect(url.searchParams.get('SortBy')).toBe('CreatedOn')
    expect(url.searchParams.get('SortMethod')).toBe('DESC')
    expect(request.headers.get('authorization')).toBeNull()
    expect(request.method).toBe('GET')
    await expect(res.json()).resolves.toMatchObject({ content: { Code: 0 } })
  })

  it('list_subscribers:列表 ID 与状态都进路径并被 URL 编码', async () => {
    const mock = mockMoosend(200, { Code: 0, Error: null, Context: { Paging: {}, Subscribers: [] } })
    await call('list_subscribers', { MailingListID: 'a/b', Status: 'Subscribed', Page: 2, PageSize: 50 })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v3/lists/a%2Fb/subscribers/Subscribed.json')
    expect(url.searchParams.get('Page')).toBe('2')
    expect(url.searchParams.get('PageSize')).toBe('50')
  })

  it('add_subscriber:POST + JSON body,MailingListID 只进路径不进 body', async () => {
    const mock = mockMoosend(200, { Code: 0, Error: null, Context: { ID: 's_1' } })
    await call('add_subscriber', {
      MailingListID: 'l_1',
      Email: 'ada@example.com',
      Name: 'Ada',
      Tags: ['vip'],
    })

    const request = sent(mock)
    expect(new URL(request.url).pathname).toBe('/v3/subscribers/l_1/subscribe.json')
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      Email: 'ada@example.com',
      Name: 'Ada',
      Tags: ['vip'],
    })
  })
})

describe('校验与错误', () => {
  it('入参校验生效:Status 给非法枚举值 → 400 且不打上游', async () => {
    const mock = mockMoosend(200, OK_LISTS)
    const res = await call('list_subscribers', { MailingListID: 'l_1', Status: 'Nope' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('HTTP 200 + body 自报凭证失败 → 401(Moosend 不用状态码表达这类错误)', async () => {
    mockMoosend(200, { Code: 500, Error: 'Invalid API key', Context: null })
    const res = await call('list_mailing_lists', {})
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })
  })

  it('HTTP 200 + body 自报业务失败 → 400', async () => {
    mockMoosend(200, { Code: 1, Error: 'Mailing list not found', Context: null })
    const res = await call('get_subscriber_by_email', { MailingListID: 'l_1', Email: 'a@example.com' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ message: 'Mailing list not found' })
  })

  it('上游错误按状态归一', async () => {
    mockMoosend(401, { Code: 0, Error: null })
    expect((await call('list_mailing_lists', {})).status).toBe(401)

    mockMoosend(429, { Code: 0, Error: null })
    await expect((await call('list_mailing_lists', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('没配 authRef → 503 且不打上游', async () => {
    const mock = mockMoosend(200, OK_LISTS)
    const res = await call('list_mailing_lists', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
