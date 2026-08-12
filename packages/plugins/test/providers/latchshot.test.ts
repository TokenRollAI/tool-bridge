import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLatchshotPlugin } from '../../src/latchshot/index'
import { latchshotActions } from '../../src/latchshot/schema'

/**
 * Latchshot 迁移产物的 wire 级验收。两个 action 的处境不同:
 * `get_usage` 走完整链路(凭证头、响应 normalize、错误归一),
 * `capture_page` 必须在**不打上游**的前提下回 501 —— 渲染是计费的,不能先烧配额再拒绝。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'lsk_deadbeef'
const plugin = createLatchshotPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'render/latchshot',
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

function mockLatchshot(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

const USAGE = {
  customer: { name: 'Acme', plan: 'launch' },
  usage: {
    period: '2026-08',
    plan: 'launch',
    limit: 1000,
    remaining: 940,
    resetAt: '2026-09-01T00:00:00Z',
    successful: 55,
    failed: 5,
    reserved: 0,
    outputBytes: 123456,
    renderMs: 78900,
    updatedAt: null,
  },
  upgradeRequest: null,
  links: {
    plans: 'https://latchshot.fly.dev/plans',
    requestPaidPlan: 'https://latchshot.fly.dev/request',
    requestPaidPlanDocs: 'https://latchshot.fly.dev/docs/request',
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 2 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(latchshotActions).length)
    expect(tools).toHaveLength(2)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('get_usage')).toBe('read')
    expect(effectOf('capture_page')).toBe('write')
  })
})

describe('get_usage', () => {
  it('GET /v1/usage,凭证走 Bearer,响应 normalize 成配额快照', async () => {
    const mock = mockLatchshot(200, USAGE)
    const res = await call('get_usage', {})

    const request = sent(mock)
    expect(request.url).toBe('https://latchshot.fly.dev/v1/usage')
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)

    await expect(res.json()).resolves.toMatchObject({
      content: {
        customer: { name: 'Acme', plan: 'launch' },
        usage: { period: '2026-08', limit: 1000, remaining: 940, updatedAt: null },
        upgradeRequest: null,
        links: { plans: 'https://latchshot.fly.dev/plans' },
      },
    })
  })

  it('upgradeRequest 存在时也被 normalize(note 保留原样,不 trim)', async () => {
    mockLatchshot(200, {
      ...USAGE,
      upgradeRequest: {
        id: 3,
        keyId: 9,
        requestedPlan: 'build',
        note: '  need more  ',
        status: 'new',
        createdAt: '2026-08-01T00:00:00Z',
        updatedAt: '2026-08-02T00:00:00Z',
      },
    })
    await expect((await call('get_usage', {})).json()).resolves.toMatchObject({
      content: { upgradeRequest: { id: 3, requestedPlan: 'build', note: '  need more  ' } },
    })
  })

  it('上游响应缺字段 → unavailable(上游破契约,不赖调用方)', async () => {
    mockLatchshot(200, { customer: { name: 'Acme' }, usage: USAGE.usage, links: USAGE.links })
    const res = await call('get_usage', {})
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('customer.plan')
  })
})

describe('capture_page', () => {
  it('回 501 且**不打上游**(渲染按次计费,不能先烧配额再拒绝)', async () => {
    const mock = mockLatchshot(200, {})
    const res = await call('capture_page', { url: 'https://example.com' })
    expect(res.status).toBe(501)
    const body = (await res.json()) as { code: string, message: string, retryable: boolean }
    expect(body).toMatchObject({ code: 'unavailable', retryable: false })
    expect(body.message).toContain('transit')
    expect(mock).not.toHaveBeenCalled()
  })

  it('入参校验仍先于 501 生效:url 给非 URL → 400 且不打上游', async () => {
    const mock = mockLatchshot(200, {})
    const res = await call('capture_page', { url: 'not-a-url' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:width 越界 → 400 且不打上游', async () => {
    const mock = mockLatchshot(200, {})
    const res = await call('capture_page', { url: 'https://example.com', width: 99999 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 error.message', async () => {
    mockLatchshot(401, { error: { message: 'Invalid API key' } })
    const unauth = await call('get_usage', {})
    expect(unauth.status).toBe(401)
    await expect(unauth.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    mockLatchshot(429, { error: { message: 'Quota exhausted' } })
    await expect((await call('get_usage', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockLatchshot(500, { error: { message: 'Latchshot is down' } })
    await expect((await call('get_usage', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockLatchshot(200, USAGE)
    const res = await call('get_usage', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
