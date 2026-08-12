import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWoodpeckerCoPlugin } from '../../src/woodpecker_co/index'
import { woodpeckerCoActions } from '../../src/woodpecker_co/schema'

/**
 * Woodpecker.co 迁移产物的 wire 级验收。重点在两代 API 的差异:v2 靠 HTTP 状态报错,
 * v1 用 200 + `status.status === 'ERROR'` 报错,后者迁丢就会把失败当成功返回。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'wp_live_deadbeef'
const plugin = createWoodpeckerCoPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'outreach/woodpecker',
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

function mockWoodpecker(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 7 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(woodpeckerCoActions).length)
    expect(tools).toHaveLength(7)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('全部 action 都是只读', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    for (const tool of tools) expect(tool.effect, tool.name).toBe('read')
  })
})

describe('v2 端点', () => {
  it('list_users 打 /rest/v2/users,凭证走 x-api-key,响应被归一', async () => {
    const mock = mockWoodpecker(200, {
      content: [{ id: 7, name: 'Ada', email: 'ada@example.com', role: 'OWNER', extra: 1 }],
      pagination_data: { total_elements: 1, total_pages: 1, current_page_number: 0, page_size: 25 },
    })
    const res = await call('list_users', { page: 0, sort: '+id' })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.woodpecker.co/rest/v2/users')
    expect(url.searchParams.get('page')).toBe('0')
    expect(url.searchParams.get('sort')).toBe('+id')
    expect(request.method).toBe('GET')
    expect(request.headers.get('x-api-key')).toBe(API_KEY)
    // 平台不注入 UA,迁移时按约定删掉了上游的 user-agent 头。
    expect(request.headers.get('user-agent')).toBeNull()

    await expect(res.json()).resolves.toMatchObject({
      content: {
        users: [{ id: 7, name: 'Ada', email: 'ada@example.com', role: 'OWNER' }],
        pagination: { total_elements: 1, page_size: 25 },
      },
    })
  })

  it('get_mailbox 把 details 里的字段提到顶层', async () => {
    const mock = mockWoodpecker(200, {
      id: 12,
      type: 'SMTP',
      details: { email: 'box@example.com', provider: 'gmail', login: 'box' },
    })
    const res = await call('get_mailbox', { mailbox_id: 12 })
    expect(new URL(sent(mock).url).pathname).toBe('/rest/v2/mailboxes/12')
    await expect(res.json()).resolves.toMatchObject({
      content: { mailbox: { id: 12, type: 'SMTP', email: 'box@example.com', provider: 'gmail' } },
    })
  })

  it('省略的可选参数不出现在 query 里', async () => {
    const mock = mockWoodpecker(200, { content: [] })
    await call('list_users', {})
    expect(new URL(sent(mock).url).search).toBe('')
  })
})

describe('v1 端点(200 里藏错误)', () => {
  it('list_prospects 把 ids 序列化成逗号串,布尔转字符串', async () => {
    const mock = mockWoodpecker(200, [{ id: 3, email: 'p@example.com', status: 'ACTIVE' }])
    const res = await call('list_prospects', { ids: [3, 5], contacted: true, status: 'ACTIVE', per_page: 50 })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/rest/v1/prospects')
    expect(url.searchParams.get('id')).toBe('3,5')
    expect(url.searchParams.get('contacted')).toBe('true')
    expect(url.searchParams.get('per_page')).toBe('50')
    await expect(res.json()).resolves.toMatchObject({
      content: { prospects: [{ id: 3, email: 'p@example.com', status: 'ACTIVE' }] },
    })
  })

  it('"空结果"的对象形状被归一成空数组,而不是当成错误', async () => {
    mockWoodpecker(200, { status: { status: 'OK' }, message: 'No prospects found' })
    const res = await call('list_campaigns', {})
    await expect(res.json()).resolves.toMatchObject({ content: { campaigns: [] } })
  })

  it('get_campaign_statistics 从 v1 列表里挑出 stats', async () => {
    const mock = mockWoodpecker(200, [{ id: 9, name: 'Q1', stats: { sent: 100, opened: 40 } }])
    const res = await call('get_campaign_statistics', { campaign_id: 9 })
    expect(new URL(sent(mock).url).searchParams.get('id')).toBe('9')
    await expect(res.json()).resolves.toMatchObject({
      content: { statistics: { sent: 100, opened: 40 } },
    })
  })

  it('HTTP 200 但 status.status=ERROR → 按错误处理', async () => {
    mockWoodpecker(200, { status: { status: 'ERROR', code: 'E_SESSION', msg: 'Invalid API key' } })
    const res = await call('list_campaigns', {})
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ code: 'permission_denied', message: 'Invalid API key' })
  })

  it('v1 的限流码 E_TOO_MANY_REQUESTS 归一成 rate_limited', async () => {
    mockWoodpecker(200, { status: { status: 'ERROR', code: 'E_TOO_MANY_REQUESTS', msg: 'Slow down' } })
    await expect((await call('list_prospects', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })
})

describe('校验与错误', () => {
  it('入参校验生效:campaign_id 给 0 → 400 且不打上游', async () => {
    const mock = mockWoodpecker(200, {})
    const res = await call('get_campaign', { campaign_id: 0 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('未知字段被 strictObject 挡下,不打上游', async () => {
    const mock = mockWoodpecker(200, {})
    const res = await call('list_users', { page: 1, nope: true })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一', async () => {
    mockWoodpecker(401, { message: 'Unauthorized' })
    expect((await call('list_users', {})).status).toBe(401)

    mockWoodpecker(429, { message: 'Too many requests' })
    await expect((await call('list_users', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockWoodpecker(404, { detail: 'No such campaign' })
    await expect((await call('get_campaign', { campaign_id: 1 })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'No such campaign' })

    mockWoodpecker(500, { message: 'boom' })
    await expect((await call('list_users', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockWoodpecker(200, {})
    const res = await call('list_users', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
