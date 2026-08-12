import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createChatworkPlugin } from '../../src/chatwork/index'
import { chatworkActions } from '../../src/chatwork/schema'

/**
 * Chatwork 迁移产物的 wire 级验收。重点在 X-ChatWorkToken 头、form-encoded 请求体、
 * 布尔选项发成 1(不发即为关),以及消息列表空体归成空数组。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'chatwork_test_token'
const plugin = createChatworkPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'chat/chatwork',
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

function mockChatwork(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 15 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(chatworkActions).length)
    expect(tools).toHaveLength(15)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('get_me')).toBe('read')
    expect(effectOf('list_room_messages')).toBe('read')
    expect(effectOf('post_message')).toBe('write')
    expect(effectOf('delete_message')).toBe('destructive')
  })
})

describe('请求构造', () => {
  it('凭证走 X-ChatWorkToken 头', async () => {
    const mock = mockChatwork(200, { account_id: 1, name: 'Ada' })
    await call('get_me', {})
    const request = sent(mock)
    expect(request.url).toBe('https://api.chatwork.com/v2/me')
    expect(request.headers.get('x-chatworktoken')).toBe(API_KEY)
    expect(request.headers.get('authorization')).toBeNull()
  })

  it('post_message 发 form-encoded,布尔选项发成 1', async () => {
    const mock = mockChatwork(200, { message_id: '100' })
    await call('post_message', { roomId: 42, body: 'hello', selfUnread: true })

    const request = sent(mock)
    expect(request.url).toBe('https://api.chatwork.com/v2/rooms/42/messages')
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded')
    const form = new URLSearchParams(await request.text())
    expect(form.get('body')).toBe('hello')
    expect(form.get('self_unread')).toBe('1')
  })

  it('selfUnread 为 false 时该键根本不发(Chatwork 用"不发即为关")', async () => {
    const mock = mockChatwork(200, { message_id: '100' })
    await call('post_message', { roomId: 42, body: 'hello', selfUnread: false })
    const form = new URLSearchParams(await sent(mock).text())
    expect(form.has('self_unread')).toBe(false)
    expect([...form.keys()]).toEqual(['body'])
  })

  it('create_task 把受理人拼成逗号串,limit_type 只在给了 limit 时才发', async () => {
    const withLimit = mockChatwork(200, { task_ids: [7, 8] })
    await call('create_task', {
      roomId: 42,
      body: 'review',
      assigneeAccountIds: [11, 12],
      limitTime: 1700000000,
    })
    const form = new URLSearchParams(await sent(withLimit).text())
    expect(form.get('to_ids')).toBe('11,12')
    expect(form.get('limit')).toBe('1700000000')
    // 上游的默认值是 'time'。
    expect(form.get('limit_type')).toBe('time')
    vi.unstubAllGlobals()

    const noLimit = mockChatwork(200, { task_ids: [9] })
    await call('create_task', { roomId: 42, body: 'review', assigneeAccountIds: [11] })
    const bare = new URLSearchParams(await sent(noLimit).text())
    expect(bare.has('limit')).toBe(false)
    expect(bare.has('limit_type')).toBe(false)
  })

  it('list_room_tasks 的筛选进 query', async () => {
    const mock = mockChatwork(200, [])
    await call('list_room_tasks', { roomId: 42, accountId: 11, status: 'open' })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v2/rooms/42/tasks')
    expect(url.searchParams.get('account_id')).toBe('11')
    expect(url.searchParams.get('status')).toBe('open')
  })
})

describe('响应形状', () => {
  it('list_room_messages 在没有新消息(空体)时归成空数组', async () => {
    const fn = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
    vi.stubGlobal('fetch', fn)
    await expect((await call('list_room_messages', { roomId: 42 })).json())
      .resolves.toEqual({ content: { messages: [] } })
  })

  it('update_message 在上游不回 message_id 时退回入参的 id', async () => {
    mockChatwork(200, {})
    await expect((await call('update_message', { roomId: 42, messageId: 'm1', body: 'edited' })).json())
      .resolves.toEqual({ content: { messageId: 'm1' } })
  })

  it('update_task_status 在上游不回 task_id 时退回入参的 id', async () => {
    mockChatwork(200, {})
    await expect((await call('update_task_status', { roomId: 42, taskId: 7, status: 'done' })).json())
      .resolves.toEqual({ content: { taskId: 7 } })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:roomId 给 0 → 400 且不打上游', async () => {
    const mock = mockChatwork(200, {})
    const res = await call('get_room', { roomId: 0 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('create_task 的 assigneeAccountIds 不能为空数组 → 400 且不打上游', async () => {
    const mock = mockChatwork(200, {})
    expect((await call('create_task', { roomId: 42, body: 'x', assigneeAccountIds: [] })).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 errors 数组', async () => {
    mockChatwork(401, { errors: ['Invalid API token'] })
    const denied = await call('get_me', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API token',
    })
    vi.unstubAllGlobals()

    mockChatwork(429, { errors: ['Rate limit exceeded'] })
    await expect((await call('get_me', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })
    vi.unstubAllGlobals()

    mockChatwork(404, { errors: ['Not found'] })
    await expect((await call('get_room', { roomId: 99 })).json())
      .resolves.toMatchObject({ code: 'not_found' })
    vi.unstubAllGlobals()

    mockChatwork(500, {})
    await expect((await call('get_me', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockChatwork(200, {})
    const res = await call('get_me', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
