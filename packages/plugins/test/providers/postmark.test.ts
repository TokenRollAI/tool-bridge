import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPostmarkPlugin } from '../../src/postmark/index'
import { postmarkActions } from '../../src/postmark/schema'

/**
 * Postmark 迁移产物的 wire 级验收。重点在四处迁移最容易迁丢的地方:
 * `X-Postmark-Server-Token` 认证头、edit_template 必须把路径参数从 body 里摘掉、
 * metadata 过滤器摊平成 `metadata_<key>`、以及 HTTP 422 底下那张 ErrorCode 码表。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'pm_server_token'
const plugin = createPostmarkPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'email/postmark',
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

function mockPostmark(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

function sentUrl(mock: ReturnType<typeof vi.fn>): URL {
  return new URL(sent(mock).url)
}

/** 一封最小可发的信,用来给各条断言当基线。 */
const EMAIL = { From: 'a@example.com', To: 'b@example.com', Subject: 'hi', TextBody: 'yo' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('~describe 报单个 tools/v1 export,并宣告 get_server 为凭证探针', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    await expect(res.json()).resolves.toEqual({
      protocolVersion: 'plugin/v2',
      exports: [{
        auth: { kind: 'single', required: true },
        id: 'actions',
        profile: 'tools/v1',
        description: 'Postmark',
        credentialProbe: 'get_server',
      }],
    })
  })

  it('List 出全部 12 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(postmarkActions).length)
    expect(tools).toHaveLength(12)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('探针 get_server 是 read 且入参为空对象(平台会空参调它)', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{
      effect?: string
      inputSchema?: { required?: string[] }
      name: string
    }>
    const probe = tools.find(tool => tool.name === 'get_server')
    expect(probe?.effect).toBe('read')
    expect(probe?.inputSchema?.required ?? []).toEqual([])
  })
})

describe('请求拼装', () => {
  it('凭证走 X-Postmark-Server-Token 头(不是 Bearer);GET 不带 content-type', async () => {
    const mock = mockPostmark(200, { ID: 1, Name: 'prod' })
    const res = await call('get_server', {})

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.url).toBe('https://api.postmarkapp.com/server')
    expect(request.headers.get('x-postmark-server-token')).toBe(API_KEY)
    expect(request.headers.get('authorization')).toBeNull()
    expect(request.headers.get('content-type')).toBeNull()
    await expect(res.json()).resolves.toEqual({ content: { ID: 1, Name: 'prod' } })
  })

  it('send_email:入参原样进 body,POST /email,带 content-type', async () => {
    const mock = mockPostmark(200, { MessageID: 'm1', ErrorCode: 0 })
    await call('send_email', { ...EMAIL, Tag: 'welcome', TrackOpens: true })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://api.postmarkapp.com/email')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({ ...EMAIL, Tag: 'welcome', TrackOpens: true })
  })

  it('send_batch_with_templates:只发 Messages 这一个键', async () => {
    const mock = mockPostmark(200, [{ MessageID: 'm1' }])
    const message = { From: 'a@example.com', To: 'b@example.com', TemplateAlias: 'welcome', TemplateModel: {} }
    const res = await call('send_batch_with_templates', { Messages: [message] })
    await expect(sent(mock).json()).resolves.toEqual({ Messages: [message] })
    // 出参是数组(不是对象),整个透出。
    await expect(res.json()).resolves.toEqual({ content: [{ MessageID: 'm1' }] })
  })

  it('search_outbound_messages:metadata 摊平成 metadata_<key>,空值的键整个不发', async () => {
    const mock = mockPostmark(200, { TotalCount: 0, Messages: [] })
    await call('search_outbound_messages', {
      count: 50,
      offset: 10,
      status: 'sent',
      recipient: 'b@example.com',
      metadata: { orderId: 'A-1', campaign: 'spring', blank: '   ' },
    })

    const url = sentUrl(mock)
    expect(url.pathname).toBe('/messages/outbound')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      count: '50',
      offset: '10',
      status: 'sent',
      recipient: 'b@example.com',
      metadata_orderId: 'A-1',
      metadata_campaign: 'spring',
    })
  })

  it('get_bounces:inactive=false 是有意义的筛选值,不能被当成"没给"丢掉', async () => {
    const mock = mockPostmark(200, { TotalCount: 0, Bounces: [] })
    await call('get_bounces', { inactive: false, type: 'HardBounce' })
    expect(Object.fromEntries(sentUrl(mock).searchParams)).toEqual({
      inactive: 'false',
      type: 'HardBounce',
    })
  })

  it('未给的可选筛选项不出现在 query 里', async () => {
    const mock = mockPostmark(200, { TotalCount: 0, Templates: [] })
    await call('list_templates', {})
    expect([...sentUrl(mock).searchParams.keys()]).toEqual([])
  })

  it('get_template:数字 ID 与字符串别名都能当路径参数,别名要转义', async () => {
    const byId = mockPostmark(200, { TemplateId: 7 })
    await call('get_template', { templateIdOrAlias: 7 })
    expect(sentUrl(byId).pathname).toBe('/templates/7')

    vi.unstubAllGlobals()
    const byAlias = mockPostmark(200, { Alias: 'welcome/v2' })
    await call('get_template', { templateIdOrAlias: 'welcome/v2' })
    expect(sentUrl(byAlias).pathname).toBe('/templates/welcome%2Fv2')
  })

  it('edit_template:PUT 到模板路径,且 templateIdOrAlias 不能留在 body 里', async () => {
    const mock = mockPostmark(200, { TemplateId: 7 })
    await call('edit_template', {
      templateIdOrAlias: 'welcome',
      Name: '新名字',
      Subject: 'Hello',
      HtmlBody: '<p>hi</p>',
    })

    const request = sent(mock)
    expect(request.method).toBe('PUT')
    expect(new URL(request.url).pathname).toBe('/templates/welcome')
    // 留在 body 里会被上游读成"把别名改成这个值"。
    await expect(request.json()).resolves.toEqual({
      Name: '新名字',
      Subject: 'Hello',
      HtmlBody: '<p>hi</p>',
    })
  })

  it('get_outbound_message_details:messageId 进路径并转义', async () => {
    const mock = mockPostmark(200, { MessageID: 'm 1' })
    await call('get_outbound_message_details', { messageId: 'm 1' })
    expect(sentUrl(mock).pathname).toBe('/messages/outbound/m%201/details')
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:count 越界 → invalid_argument 且不打上游', async () => {
    const mock = mockPostmark(200, {})
    const res = await call('list_templates', { count: 900 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it.each([
    ['get_outbound_message_details', {}, 'messageId'],
    ['get_template', {}, 'templateIdOrAlias'],
  ])('%s 缺必填字段 → invalid_argument(上游声明里没写 required,断言在这一层)', async (name, args, field) => {
    const mock = mockPostmark(200, {})
    const res = await call(name, args)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument', message: `${field} 是必填的` })
    expect(mock).not.toHaveBeenCalled()
  })

  it('令牌无效藏在 HTTP 422 + ErrorCode 10 底下(状态本身看不出是凭证问题)', async () => {
    mockPostmark(422, { ErrorCode: 10, Message: 'Your request did not submit a valid API token.' })
    const res = await call('send_email', EMAIL)
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Your request did not submit a valid API token.',
    })
  })

  it('目标不存在的一组 ErrorCode 归 not_found,而不是"你参数错了"', async () => {
    mockPostmark(422, { ErrorCode: 1101, Message: 'The template does not exist.' })
    const res = await call('get_template', { templateIdOrAlias: 'nope' })
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ code: 'not_found' })
  })

  it('账号状态导致的拒发归 permission_denied(非可重试:待审核不会自己变)', async () => {
    mockPostmark(422, { ErrorCode: 412, Message: 'Account is pending approval.' })
    const res = await call('send_email', EMAIL)
    expect(res.status).toBe(403)
    const body = (await res.json()) as { code: string, retryable?: boolean }
    expect(body.code).toBe('permission_denied')
    expect(body.retryable ?? false).toBe(false)
  })

  it('拿不到 ErrorCode 时退回 HTTP 状态归一:422 → invalid_argument,5xx → unavailable', async () => {
    mockPostmark(422, { Message: 'Invalid email request' })
    const invalid = await call('send_email', EMAIL)
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'Invalid email request',
    })

    vi.unstubAllGlobals()
    mockPostmark(429, { Message: 'Too many requests' })
    await expect((await call('send_email', EMAIL)).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockPostmark(503, { Message: 'Service unavailable' })
    await expect((await call('send_email', EMAIL)).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('错误响应回的是 HTML 错误页时,按状态归一并把正文当消息', async () => {
    const fn = vi.fn(() => Promise.resolve(new Response('<html>502 Bad Gateway</html>', { status: 502 })))
    vi.stubGlobal('fetch', fn)
    await expect((await call('get_server', {})).json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: '<html>502 Bad Gateway</html>',
    })
  })

  it('2xx 上回非 JSON → unavailable + retryable(上游坏了,不是调用方的错)', async () => {
    const fn = vi.fn(() => Promise.resolve(new Response('not json', { status: 200 })))
    vi.stubGlobal('fetch', fn)
    await expect((await call('get_server', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockPostmark(200, {})
    const res = await call('get_server', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
