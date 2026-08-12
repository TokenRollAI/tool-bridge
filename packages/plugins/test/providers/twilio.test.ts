import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  encodeCredentialValues,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTwilioPlugin } from '../../src/twilio/index'
import { twilioActions } from '../../src/twilio/schema'

/**
 * Twilio 迁移产物的 wire 级验收。重点钉住几处"迁移最容易迁丢"的地方:
 * HTTP Basic(不是 Bearer)、accountSid 进路径段、写操作的 form-encoded 请求体、
 * camelCase 入参 → PascalCase query 参数的改名、以及错误消息末尾那个数字业务码。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const ACCOUNT_SID = 'ACdeadbeefdeadbeefdeadbeefdeadbeef'
const AUTH_TOKEN = 'tok_deadbeef'
const CREDENTIALS = { accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN }
const EXPECTED_BASIC = `Basic ${btoa(`${ACCOUNT_SID}:${AUTH_TOKEN}`)}`
const plugin = createTwilioPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'comms/twilio',
  exportId: 'actions',
}

function envelope(body: unknown, opts: { auth?: string | null } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'authorization': `Bearer ${PLUGIN_TOKEN}`,
    'content-type': 'application/json',
    [HEADER_TB_CONTEXT]: encodeCallContext(CALLER),
  }
  const auth = opts.auth === undefined ? encodeCredentialValues(CREDENTIALS) : opts.auth
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

function mockTwilio(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const fn = vi.fn(() => Promise.resolve(new Response(body, {
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
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(twilioActions).length)
    expect(tools).toHaveLength(5)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'get_account',
      'get_message',
      'list_messages',
      'list_usage_records',
      'send_message',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求拼装', () => {
  it('get_account:accountSid 进路径段,凭证走 HTTP Basic(不是 Bearer),GET 无请求体', async () => {
    const mock = mockTwilio(200, {
      sid: ACCOUNT_SID,
      friendly_name: 'My account',
      status: 'active',
      type: 'Full',
    })
    const res = await call('get_account', {})

    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('GET')
    expect(url.origin).toBe('https://api.twilio.com')
    expect(url.pathname).toBe(`/2010-04-01/Accounts/${ACCOUNT_SID}.json`)
    expect(request.headers.get('authorization')).toBe(EXPECTED_BASIC)
    // Basic 里带的是 accountSid:authToken,任何形式的 Bearer 都会被 Twilio 401。
    expect(request.headers.get('authorization')).not.toContain('Bearer')
    expect(request.headers.get('content-type')).toBeNull()
    expect(await request.text()).toBe('')

    await expect(res.json()).resolves.toEqual({
      content: {
        accountSid: ACCOUNT_SID,
        friendlyName: 'My account',
        status: 'active',
        type: 'Full',
      },
    })
  })

  it('list_messages:camelCase 入参改名成 PascalCase query 参数', async () => {
    const mock = mockTwilio(200, { messages: [], next_page_uri: null })
    await call('list_messages', {
      to: '+15550001111',
      from: '+15550002222',
      pageSize: 20,
      pageToken: 'PAtoken',
    })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe(`/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      To: '+15550001111',
      From: '+15550002222',
      PageSize: '20',
      PageToken: 'PAtoken',
    })
  })

  it('list_usage_records:Category / StartDate / EndDate / PageSize 都改了名', async () => {
    const mock = mockTwilio(200, { usage_records: [] })
    await call('list_usage_records', {
      category: 'sms',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      pageSize: 5,
    })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe(`/2010-04-01/Accounts/${ACCOUNT_SID}/Usage/Records.json`)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      Category: 'sms',
      StartDate: '2026-01-01',
      EndDate: '2026-01-31',
      PageSize: '5',
    })
  })

  it('未给的可选参数不出现在 query 里', async () => {
    const mock = mockTwilio(200, { messages: [] })
    await call('list_messages', {})
    expect([...new URL(sent(mock).url).searchParams.keys()]).toEqual([])
  })

  it('get_message:messageSid 进路径段并做 URL 编码', async () => {
    const mock = mockTwilio(200, { sid: 'SM1', status: 'delivered' })
    await call('get_message', { messageSid: 'SM/1' })
    expect(new URL(sent(mock).url).pathname)
      .toBe(`/2010-04-01/Accounts/${ACCOUNT_SID}/Messages/SM%2F1.json`)
  })
})

describe('send_message 的请求体', () => {
  it('是 form-encoded 而不是 JSON,字段名 To/From/Body', async () => {
    const mock = mockTwilio(201, {
      sid: 'SM123',
      account_sid: ACCOUNT_SID,
      status: 'queued',
      to: '+15550001111',
      from: '+15550002222',
      body: 'hello',
    })
    const res = await call('send_message', {
      to: '+15550001111',
      from: '+15550002222',
      body: 'hello',
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe(`/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`)
    expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded')
    const raw = await request.text()
    // 拿 JSON 发过去 Twilio 会当成空参数并报 21604,是最容易迁丢的一处。
    expect(raw.startsWith('{')).toBe(false)
    expect(Object.fromEntries(new URLSearchParams(raw))).toEqual({
      To: '+15550001111',
      From: '+15550002222',
      Body: 'hello',
    })

    await expect(res.json()).resolves.toEqual({
      content: {
        messageSid: 'SM123',
        accountSid: ACCOUNT_SID,
        status: 'queued',
        to: '+15550001111',
        from: '+15550002222',
        body: 'hello',
      },
    })
  })

  it('body 里的 & 与 = 走 form 编码,不会串到别的字段上', async () => {
    const mock = mockTwilio(201, { sid: 'SM124' })
    await call('send_message', { to: '+1', from: '+2', body: 'a&From=evil=1' })
    expect(Object.fromEntries(new URLSearchParams(await sent(mock).text()))).toEqual({
      To: '+1',
      From: '+2',
      Body: 'a&From=evil=1',
    })
  })
})

describe('响应整形', () => {
  it('列表出参裁剪成命名字段,缺失字段兜底成 null,sid 兜底成空串', async () => {
    mockTwilio(200, {
      messages: [{ sid: 'SM1', to: '+1' }, { status: 'failed' }],
      next_page_uri: '/2010-04-01/Accounts/AC1/Messages.json?Page=1',
      unknown_field: 'dropped',
    })
    const res = await call('list_messages', {})
    await expect(res.json()).resolves.toEqual({
      content: {
        messages: [
          { messageSid: 'SM1', accountSid: null, status: null, to: '+1', from: null, body: null },
          { messageSid: '', accountSid: null, status: 'failed', to: null, from: null, body: null },
        ],
        nextPageUri: '/2010-04-01/Accounts/AC1/Messages.json?Page=1',
      },
    })
  })

  it('usage 记录的 page / page_size 是数字、count 类字段是字符串,各自按类型取', async () => {
    mockTwilio(200, {
      usage_records: [{
        account_sid: ACCOUNT_SID,
        category: 'sms',
        count: '12',
        count_unit: 'messages',
        usage: '12',
        usage_unit: 'messages',
        price: '0.09',
        price_unit: 'USD',
        start_date: '2026-01-01',
        end_date: '2026-01-31',
      }],
      page: 0,
      page_size: 50,
      next_page_uri: null,
    })
    const res = await call('list_usage_records', {})
    await expect(res.json()).resolves.toEqual({
      content: {
        usageRecords: [{
          accountSid: ACCOUNT_SID,
          category: 'sms',
          count: '12',
          countUnit: 'messages',
          usage: '12',
          usageUnit: 'messages',
          price: '0.09',
          priceUnit: 'USD',
          startDate: '2026-01-01',
          endDate: '2026-01-31',
        }],
        page: 0,
        pageSize: 50,
        nextPageUri: null,
      },
    })
  })

  it('列表键缺席时兜底成空数组而不是报错', async () => {
    mockTwilio(200, {})
    await expect((await call('list_messages', {})).json())
      .resolves.toEqual({ content: { messages: [], nextPageUri: null } })
  })
})

describe('校验与错误', () => {
  it('缺必填的 messageSid → 400 且不打上游', async () => {
    const mock = mockTwilio(200, {})
    const res = await call('get_message', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('pageSize 越界(0)→ 400 且不打上游', async () => {
    const mock = mockTwilio(200, {})
    const res = await call('list_messages', { pageSize: 0 })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('纯空白的 body 能过 Zod 的 min(1),但在本地就挡下(空短信是一次白花钱的失败)', async () => {
    const mock = mockTwilio(201, {})
    const res = await call('send_message', { to: '+1', from: '+2', body: '   ' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument', message: 'body is required.' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游 4xx → invalid_argument,消息末尾带上 Twilio 的数字业务码', async () => {
    mockTwilio(400, {
      code: 21211,
      message: 'The \'To\' number is not a valid phone number.',
      status: 400,
    })
    const res = await call('send_message', { to: '+1', from: '+2', body: 'x' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'The \'To\' number is not a valid phone number. (21211)',
    })
  })

  it('上游 401 → permission_denied,403 也一样', async () => {
    mockTwilio(401, { code: 20003, message: 'Authenticate' })
    const unauthorized = await call('get_account', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Authenticate (20003)',
    })

    vi.unstubAllGlobals()
    mockTwilio(403, { message: 'Forbidden' })
    await expect((await call('get_account', {})).json())
      .resolves.toMatchObject({ code: 'permission_denied', message: 'Forbidden' })
  })

  it('上游 404 → not_found,429 → rate_limited + retryable', async () => {
    mockTwilio(404, { code: 20404, message: 'The requested resource was not found' })
    const missing = await call('get_message', { messageSid: 'SMnope' })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found' })

    vi.unstubAllGlobals()
    mockTwilio(429, { code: 20429, message: 'Too Many Requests' })
    const limited = await call('list_messages', {})
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('上游 5xx → unavailable + retryable', async () => {
    mockTwilio(503, { message: 'Service unavailable' })
    const res = await call('get_account', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('错误体不是 JSON 时用原文当消息,不报"响应不是 JSON"', async () => {
    mockTwilio(502, '<html>bad gateway</html>')
    await expect((await call('get_account', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', message: '<html>bad gateway</html>' })
  })

  it('2xx 上回非 JSON → unavailable(上游坏了,不是插件崩了)', async () => {
    mockTwilio(200, 'not json at all')
    const res = await call('get_account', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → 报错且不打上游(不裸调 Twilio)', async () => {
    const mock = mockTwilio(200, {})
    const res = await call('get_account', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
