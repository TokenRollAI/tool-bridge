import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStatamicPlugin } from '../../src/statamic/index'
import { statamicActions } from '../../src/statamic/schema'

/**
 * Statamic 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * `{data}` 信封的剥壳、站点对象的五键归一、domain/domains 的互斥、update 的"至少改一项"。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'statamic_token_deadbeef'
const plugin = createStatamicPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'cms/statamic',
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

function mockStatamic(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 4 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(statamicActions).length)
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
    expect(effectOf('list_sites')).toBe('read')
    expect(effectOf('create_site')).toBe('write')
    expect(effectOf('delete_site')).toBe('destructive')
  })
})

describe('请求成形', () => {
  it('list_sites 打 /api/v1/sites,凭证走 Bearer', async () => {
    const mock = mockStatamic(200, { data: [] })
    await call('list_sites', {})
    const request = sent(mock)
    expect(request.url).toBe('https://statamic.com/api/v1/sites')
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
  })

  it('create_site 发 JSON body,省略的可选字段不出现', async () => {
    const mock = mockStatamic(200, { data: { name: 'Acme', key: 'k1' } })
    await call('create_site', { name: 'Acme', domains: ['acme.com', 'staging.acme.com'] })
    const request = sent(mock)
    expect(request.method).toBe('POST')
    await expect(request.json()).resolves.toEqual({
      name: 'Acme',
      domains: ['acme.com', 'staging.acme.com'],
    })
  })

  it('update_site 走 PATCH,site key 被 URL 编码', async () => {
    const mock = mockStatamic(200, { data: { name: 'New', key: 'a/b' } })
    await call('update_site', { key: 'a/b', name: 'New' })
    const request = sent(mock)
    expect(request.url).toBe('https://statamic.com/api/v1/sites/a%2Fb')
    expect(request.method).toBe('PATCH')
    await expect(request.json()).resolves.toEqual({ name: 'New' })
  })
})

describe('响应归一', () => {
  it('站点归一成固定五键,raw 保留原始对象', async () => {
    mockStatamic(200, {
      data: [{
        name: 'Acme',
        key: 'site_1',
        domains: ['acme.com', 42],
        created_at: '2024-01-01T00:00:00Z',
        extra: 'kept-in-raw',
      }],
    })
    await expect((await call('list_sites', {})).json()).resolves.toEqual({
      content: {
        sites: [{
          name: 'Acme',
          key: 'site_1',
          // 非字符串的域名条目被丢掉,而不是原样透出。
          domains: ['acme.com'],
          createdAt: '2024-01-01T00:00:00Z',
          raw: {
            name: 'Acme',
            key: 'site_1',
            domains: ['acme.com', 42],
            created_at: '2024-01-01T00:00:00Z',
            extra: 'kept-in-raw',
          },
        }],
      },
    })
  })

  it('缺字段用空值兜底,data 不是数组时退化成空列表', async () => {
    mockStatamic(200, { data: { unexpected: true } })
    await expect((await call('list_sites', {})).json())
      .resolves.toEqual({ content: { sites: [] } })
  })

  it('delete 没给 message 时用默认文案', async () => {
    mockStatamic(200, {})
    await expect((await call('delete_site', { key: 'site_1' })).json())
      .resolves.toEqual({ content: { message: 'Site deleted.' } })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:create_site 缺 name → 400 且不打上游', async () => {
    const mock = mockStatamic(200, {})
    const res = await call('create_site', { domain: 'acme.com' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('domain 与 domains 互斥、update 至少改一项,都在本地挡下', async () => {
    const mock = mockStatamic(200, {})
    const both = await call('create_site', {
      name: 'Acme',
      domain: 'acme.com',
      domains: ['acme.com'],
    })
    expect(both.status).toBe(400)
    expect(((await both.json()) as { message: string }).message).toContain('domains')

    const empty = await call('update_site', { key: 'site_1' })
    expect(empty.status).toBe(400)
    expect(((await empty.json()) as { message: string }).message).toContain('name')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 message / Laravel 的 errors 映射', async () => {
    mockStatamic(401, { message: 'Unauthenticated.' })
    const denied = await call('list_sites', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Unauthenticated.',
    })

    mockStatamic(429, { message: 'Too Many Attempts.' })
    await expect((await call('list_sites', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockStatamic(422, { errors: { domain: ['The domain has already been taken.'] } })
    await expect((await call('create_site', { name: 'Acme', domain: 'acme.com' })).json())
      .resolves.toMatchObject({
        code: 'invalid_argument',
        message: 'The domain has already been taken.',
      })

    mockStatamic(500, { message: 'Server Error' })
    await expect((await call('list_sites', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockStatamic(200, {})
    const res = await call('list_sites', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
