import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCommpeakPlugin } from '../../src/commpeak/index'
import { commpeakActions } from '../../src/commpeak/schema'

/**
 * CommPeak 迁移产物的 wire 级验收。重点在:Authorization 头是**裸值**(无 Bearer)、
 * send_sms 的两跳(先换 stream token 再发)、列表端点的 `_page` 分页参数名、
 * HTTP 200 + `{status:false}` 的失败表达。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'cp_test_key'
const plugin = createCommpeakPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'sms/commpeak',
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

function mockCommpeak(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

/** send_sms 是两跳:先 GET token,再 POST 发送。按调用序返回不同响应。 */
function mockSequence(...responses: Array<{ payload: unknown, status: number }>): ReturnType<typeof vi.fn> {
  let index = 0
  const fn = vi.fn(() => {
    const next = responses[Math.min(index, responses.length - 1)]!
    index += 1
    return Promise.resolve(new Response(JSON.stringify(next.payload), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    }))
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

function sentAt(mock: ReturnType<typeof vi.fn>, index: number): Request {
  return (mock.mock.calls[index] as [Request])[0]
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 8 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(commpeakActions).length)
    expect(tools).toHaveLength(8)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求形状', () => {
  it('list_streams:Authorization 是裸值,分页页码用 _page,响应被归一', async () => {
    const mock = mockCommpeak(200, [
      { id: 7, streamUid: 'uid_7', name: 'Main', streamTags: [{ id: 1, value: 'prod' }] },
    ])
    const res = await call('list_streams', { page: 2, itemsPerPage: 50 })

    const request = sentAt(mock, 0)
    const url = new URL(request.url)
    expect(url.origin).toBe('https://gw.commpeak.com')
    expect(url.pathname).toBe('/textpeak/streams')
    expect(url.searchParams.get('_page')).toBe('2')
    expect(url.searchParams.get('itemsPerPage')).toBe('50')
    // 裸值,不是 `Bearer <key>`。
    expect(request.headers.get('authorization')).toBe(API_KEY)

    await expect(res.json()).resolves.toEqual({
      content: {
        streams: [{
          id: 7,
          streamUid: 'uid_7',
          name: 'Main',
          description: null,
          type: null,
          callerId: null,
          ipAcl: null,
          state: null,
          streamTags: [{ id: 1, value: 'prod' }],
          raw: { id: 7, streamUid: 'uid_7', name: 'Main', streamTags: [{ id: 1, value: 'prod' }] },
        }],
      },
    })
  })

  it('send_sms:先换 stream token,再拿它当 Authorization 发 POST', async () => {
    const mock = mockSequence(
      { status: 200, payload: { token: 'stream_tok_1' } },
      { status: 200, payload: { status: true, task_id: 'task_1', messages: [{ internal_id: 'm1' }] } },
    )
    const res = await call('send_sms', {
      streamId: 7,
      sender: 'Acme',
      messages: [{ internalId: 'm1', recipientPhone: '15551234567', messageContent: 'hi' }],
    })

    expect(mock).toHaveBeenCalledTimes(2)
    const tokenRequest = sentAt(mock, 0)
    expect(tokenRequest.url).toBe('https://gw.commpeak.com/textpeak/streams/7/token')
    expect(tokenRequest.headers.get('authorization')).toBe(API_KEY)

    const sendRequest = sentAt(mock, 1)
    expect(sendRequest.url).toBe('https://gw.commpeak.com/textpeak/streams/simple_send')
    expect(sendRequest.method).toBe('POST')
    // 第二跳用的是 stream token,不是 API key。
    expect(sendRequest.headers.get('authorization')).toBe('stream_tok_1')
    await expect(sendRequest.json()).resolves.toEqual({
      sender: 'Acme',
      messages: [{ internal_id: 'm1', recipient_phone: '15551234567', message_content: 'hi' }],
    })

    await expect(res.json()).resolves.toMatchObject({
      content: { status: true, taskId: 'task_1' },
    })
  })

  it('list_messages:过滤器进 query,分页信封的 totalItems 被归一', async () => {
    const mock = mockCommpeak(200, {
      items: [{ message_uuid: 'u1', status: 'delivered', content: { type: 'text', text: 'hi' } }],
      totalItems: 1,
    })
    const res = await call('list_messages', { status: 'delivered', streamId: 7, startDate: '2026-01-01' })

    const url = new URL(sentAt(mock, 0).url)
    expect(url.pathname).toBe('/textpeak/streams/messages')
    expect(url.searchParams.get('status')).toBe('delivered')
    expect(url.searchParams.get('streamId')).toBe('7')
    expect(url.searchParams.get('startDate')).toBe('2026-01-01')

    await expect(res.json()).resolves.toMatchObject({
      content: {
        items: [{ messageUuid: 'u1', status: 'delivered', content: { type: 'text', text: 'hi' } }],
        page: { totalItems: 1 },
      },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验生效:messages 为空数组 → 400 且不打上游', async () => {
    const mock = mockCommpeak(200, {})
    const res = await call('send_sms', { streamId: 7, sender: 'Acme', messages: [] })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('顶层与逐条 sender 都缺 → 400 且不打上游(schema 表达不了这条条件必填)', async () => {
    const mock = mockCommpeak(200, {})
    const res = await call('send_sms', {
      streamId: 7,
      messages: [{ recipientPhone: '15551234567', messageContent: 'hi' }],
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('sender is required')
    expect(mock).not.toHaveBeenCalled()
  })

  it('HTTP 200 + {status:false} 也算失败 → 502', async () => {
    mockCommpeak(200, { status: false, message: 'stream disabled' })
    const res = await call('list_streams', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      message: 'stream disabled',
      retryable: true,
    })
  })

  it('上游错误按状态归一', async () => {
    mockCommpeak(401, { message: 'Invalid API key' })
    const denied = await call('list_streams', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    mockCommpeak(429, { message: 'Too many requests' })
    await expect((await call('list_streams', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', message: 'Too many requests', retryable: true })

    mockCommpeak(404, { message: 'stream not found' })
    await expect((await call('get_stream', { streamId: 99 })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'stream not found' })
  })

  it('没配 authRef → 503 且不打上游', async () => {
    const mock = mockCommpeak(200, [])
    const res = await call('list_streams', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
