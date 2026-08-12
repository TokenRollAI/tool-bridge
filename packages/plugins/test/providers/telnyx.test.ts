import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTelnyxPlugin } from '../../src/telnyx/index'
import { telnyxActions } from '../../src/telnyx/schema'

/**
 * Telnyx 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * JSON:API 的方括号筛选键、send_message 的跨字段互斥、null 与 undefined 之别、
 * 错误消息从 `errors[0].detail` 里挖出来。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'KEY0197deadbeef'
const PROFILE_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6'
const MESSAGE_ID = '40017c9c-6c2f-4b5f-9e2a-1b6f0a1e2d3c'
const plugin = createTelnyxPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'messaging/telnyx',
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

function mockTelnyx(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

const RESOURCE = { id: MESSAGE_ID, record_type: 'message' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 4 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(telnyxActions).length)
    expect(tools).toHaveLength(4)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('send_message')).toBe('write')
    expect(effectOf('retrieve_message')).toBe('read')
    expect(effectOf('list_messaging_profiles')).toBe('read')
    expect(effectOf('retrieve_messaging_profile')).toBe('read')
  })
})

describe('send_message', () => {
  it('POST /v2/messages,Bearer 凭证,body 是 snake_case JSON', async () => {
    const mock = mockTelnyx(200, { data: RESOURCE })
    const res = await call('send_message', {
      to: '+13115552368',
      from: '+18445550001',
      text: 'hello',
      type: 'SMS',
      useProfileWebhooks: false,
      autoDetect: true,
      encoding: 'gsm7',
      webhookUrl: 'https://hooks.example.com/telnyx',
    })

    const request = sent(mock)
    expect(request.url).toBe('https://api.telnyx.com/v2/messages')
    expect(request.method).toBe('POST')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('content-type')).toBe('application/json')
    expect(request.headers.get('accept')).toBe('application/json')
    // 平台不注入 UA,上游那个 providerUserAgent 头在迁移时删掉了。
    expect(request.headers.get('user-agent')).toBeNull()

    await expect(request.json()).resolves.toEqual({
      to: '+13115552368',
      from: '+18445550001',
      text: 'hello',
      type: 'SMS',
      use_profile_webhooks: false,
      auto_detect: true,
      encoding: 'gsm7',
      webhook_url: 'https://hooks.example.com/telnyx',
    })
    await expect(res.json()).resolves.toEqual({ content: { data: RESOURCE } })
  })

  it('sendAt 显式传 null 会发给上游,省略则整个键不出现', async () => {
    const withNull = mockTelnyx(200, { data: RESOURCE })
    await call('send_message', { to: '+13115552368', messagingProfileId: PROFILE_ID, text: 'x', sendAt: null })
    await expect(sent(withNull).json()).resolves.toEqual({
      to: '+13115552368',
      messaging_profile_id: PROFILE_ID,
      text: 'x',
      send_at: null,
    })

    vi.unstubAllGlobals()
    const omitted = mockTelnyx(200, { data: RESOURCE })
    await call('send_message', { to: '+13115552368', messagingProfileId: PROFILE_ID, text: 'x' })
    const body = (await sent(omitted).json()) as Record<string, unknown>
    expect('send_at' in body).toBe(false)
  })

  it('自由文本字段的首尾空白被吃掉(照搬上游 optionalString 的语义)', async () => {
    const mock = mockTelnyx(200, { data: RESOURCE })
    await call('send_message', {
      to: ' +13115552368 ',
      from: ' +18445550001 ',
      text: '  hello  ',
      subject: ' subj ',
    })
    await expect(sent(mock).json()).resolves.toMatchObject({
      to: '+13115552368',
      from: '+18445550001',
      text: 'hello',
      subject: 'subj',
    })
  })

  it('缺 from 和 messagingProfileId → 400 且不打上游', async () => {
    const mock = mockTelnyx(200, { data: RESOURCE })
    const res = await call('send_message', { to: '+13115552368', text: 'hi' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    expect(((await (await call('send_message', { to: '+1', text: 'hi' })).json()) as { message: string }).message)
      .toContain('messagingProfileId')
    expect(mock).not.toHaveBeenCalled()
  })

  it('type=MMS 缺 mediaUrls、type=SMS 缺 text 都在本地挡下', async () => {
    const mock = mockTelnyx(200, { data: RESOURCE })
    const mms = await call('send_message', { to: '+13115552368', from: '+18445550001', type: 'MMS', text: 'x' })
    expect(mms.status).toBe(400)
    await expect(mms.json()).resolves.toMatchObject({ message: expect.stringContaining('mediaUrls') })

    const sms = await call('send_message', {
      to: '+13115552368',
      from: '+18445550001',
      type: 'SMS',
      mediaUrls: ['https://cdn.example.com/a.png'],
    })
    expect(sms.status).toBe(400)
    await expect(sms.json()).resolves.toMatchObject({ message: expect.stringContaining('text') })
    expect(mock).not.toHaveBeenCalled()
  })

  it('既无 text 也无 mediaUrls(且没给 type)→ 400', async () => {
    const mock = mockTelnyx(200, { data: RESOURCE })
    const res = await call('send_message', { to: '+13115552368', from: '+18445550001' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('list 与 retrieve', () => {
  it('筛选与分页进 query,方括号键原样传', async () => {
    const mock = mockTelnyx(200, { data: [], meta: { page_number: 2, page_size: 25 } })
    await call('list_messaging_profiles', {
      filterName: 'prod',
      filterNameEq: 'production',
      filterNameContains: 'pro',
      pageNumber: 2,
      pageSize: 25,
    })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v2/messaging_profiles')
    expect(sent(mock).method).toBe('GET')
    expect(url.searchParams.get('filter[name]')).toBe('prod')
    expect(url.searchParams.get('filter[name][eq]')).toBe('production')
    expect(url.searchParams.get('filter[name][contains]')).toBe('pro')
    expect(url.searchParams.get('page[number]')).toBe('2')
    expect(url.searchParams.get('page[size]')).toBe('25')
  })

  it('省略的筛选不出现在 query 里(空 filter 对 Telnyx 不是"不筛选")', async () => {
    const mock = mockTelnyx(200, { data: [], meta: {} })
    await call('list_messaging_profiles', {})
    const url = new URL(sent(mock).url)
    expect([...url.searchParams.keys()]).toEqual([])
  })

  it('GET 不带 content-type(无 body)', async () => {
    const mock = mockTelnyx(200, { data: RESOURCE })
    await call('retrieve_message', { id: MESSAGE_ID })
    const request = sent(mock)
    expect(request.url).toBe(`https://api.telnyx.com/v2/messages/${MESSAGE_ID}`)
    expect(request.headers.get('content-type')).toBeNull()
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
  })

  it('retrieve_messaging_profile 打 /messaging_profiles/{id}', async () => {
    const mock = mockTelnyx(200, { data: { id: PROFILE_ID, record_type: 'messaging_profile' } })
    await call('retrieve_messaging_profile', { id: PROFILE_ID })
    expect(sent(mock).url).toBe(`https://api.telnyx.com/v2/messaging_profiles/${PROFILE_ID}`)
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:id 不是 uuid → 400 且不打上游', async () => {
    const mock = mockTelnyx(200, { data: RESOURCE })
    const res = await call('retrieve_message', { id: 'not-a-uuid' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('pageSize 超上限 → 400 且不打上游', async () => {
    const mock = mockTelnyx(200, { data: [], meta: {} })
    const res = await call('list_messaging_profiles', { pageSize: 500 })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 errors[0].detail', async () => {
    mockTelnyx(401, { errors: [{ code: '10009', title: 'Unauthorized', detail: 'Invalid API key' }] })
    const unauthorized = await call('retrieve_message', { id: MESSAGE_ID })
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    vi.unstubAllGlobals()
    mockTelnyx(429, { errors: [{ code: '10008', detail: 'Too many requests' }] })
    const limited = await call('retrieve_message', { id: MESSAGE_ID })
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({
      code: 'rate_limited',
      message: 'Too many requests',
      retryable: true,
    })

    vi.unstubAllGlobals()
    mockTelnyx(404, { errors: [{ code: '10005', title: 'Resource not found' }] })
    await expect((await call('retrieve_message', { id: MESSAGE_ID })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'Resource not found' })

    vi.unstubAllGlobals()
    mockTelnyx(503, { errors: [{ detail: 'Service unavailable' }] })
    await expect((await call('retrieve_message', { id: MESSAGE_ID })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('错误体没有可用消息时退回状态码,不吐空串', async () => {
    mockTelnyx(500, {})
    await expect((await call('retrieve_message', { id: MESSAGE_ID })).json())
      .resolves.toMatchObject({ code: 'unavailable', message: expect.stringContaining('500') })
  })

  it('限流响应是 HTML 时仍归成 rate_limited(而非按解析失败当故障)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>429</html>', { status: 429 }))))
    await expect((await call('retrieve_message', { id: MESSAGE_ID })).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('没配 authRef → 503 且不打上游', async () => {
    const mock = mockTelnyx(200, { data: RESOURCE })
    const res = await call('retrieve_message', { id: MESSAGE_ID }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
