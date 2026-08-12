import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFaradayPlugin } from '../../src/faraday/index'
import { faradayActions } from '../../src/faraday/schema'

/**
 * Faraday 迁移产物的 wire 级验收。12 个 action 是同一形状的 GET,故重点验证路径拼装
 * (base 里的 /v1 不能被相对解析吃掉)、出参双键透出,以及响应形状不符时的归一。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'fd_live_deadbeef'
const plugin = createFaradayPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'data/faraday',
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

function mockFaraday(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 12 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(faradayActions).length)
    expect(tools).toHaveLength(12)
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

describe('请求构造', () => {
  it('get_current_account 打到 /v1/accounts/current,凭证走 Bearer', async () => {
    const mock = mockFaraday(200, { id: 'acc_1', name: 'Acme', resource_type: 'account' })
    const res = await call('get_current_account', {})

    const request = sent(mock)
    expect(request.url).toBe('https://api.faraday.ai/v1/accounts/current')
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('accept')).toBe('application/json')
    expect(request.headers.get('user-agent')).toBeNull()
    // account 与 raw 是同一份数据的两个键,上游如此。
    await expect(res.json()).resolves.toEqual({
      content: {
        account: { id: 'acc_1', name: 'Acme', resource_type: 'account' },
        raw: { id: 'acc_1', name: 'Acme', resource_type: 'account' },
      },
    })
  })

  it('路径参数被 URL 编码,base 里的 /v1 不被相对解析吃掉', async () => {
    const mock = mockFaraday(200, { id: 'a/b' })
    await call('get_dataset', { dataset_id: 'a/b' })
    expect(sent(mock).url).toBe('https://api.faraday.ai/v1/datasets/a%2Fb')
  })

  it('各集合 action 打到各自的端点', async () => {
    for (const [action, path] of [
      ['list_scopes', '/v1/scopes'],
      ['list_traits', '/v1/traits'],
      ['list_targets', '/v1/targets'],
      ['list_usages', '/v1/usages'],
    ] as const) {
      const mock = mockFaraday(200, [])
      await call(action, {})
      expect(new URL(sent(mock).url).pathname, action).toBe(path)
      vi.unstubAllGlobals()
    }
  })

  it('集合响应原样透出到 <key> 与 raw', async () => {
    mockFaraday(200, [{ id: 's1', name: 'Scope A' }])
    await expect((await call('list_scopes', {})).json()).resolves.toEqual({
      content: {
        scopes: [{ id: 's1', name: 'Scope A' }],
        raw: [{ id: 's1', name: 'Scope A' }],
      },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验生效:account_id 给空串 → 400 且不打上游', async () => {
    const mock = mockFaraday(200, {})
    const res = await call('get_account', { account_id: '' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('缺必填 trait_id → 400 且不打上游', async () => {
    const mock = mockFaraday(200, {})
    expect((await call('get_trait', {})).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('集合端点回对象 / 单资源端点回数组 → unavailable(上游违约)', async () => {
    mockFaraday(200, { scopes: [] })
    await expect((await call('list_scopes', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })

    mockFaraday(200, [{ id: 'x' }])
    await expect((await call('get_current_account', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('上游错误按状态归一,消息优先取 note', async () => {
    mockFaraday(401, { note: 'Invalid API key' })
    const unauth = await call('get_current_account', {})
    expect(unauth.status).toBe(401)
    await expect(unauth.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    mockFaraday(429, { message: 'Too many requests' })
    await expect((await call('list_accounts', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockFaraday(404, { note: 'No such dataset' })
    await expect((await call('get_dataset', { dataset_id: 'nope' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'No such dataset' })

    // 上游把 409 压成 400;迁移后保留 conflict。
    mockFaraday(409, { error: 'conflicting update' })
    await expect((await call('get_scope', { scope_id: 's1' })).json())
      .resolves.toMatchObject({ code: 'conflict' })

    mockFaraday(500, { note: 'boom' })
    await expect((await call('list_accounts', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockFaraday(200, {})
    const res = await call('get_current_account', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
