import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFeatheryPlugin } from '../../src/feathery/index'
import { featheryActions } from '../../src/feathery/schema'

/**
 * Feathery 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * `Token` 前缀的凭证头、tags 的重复 query key、列表信封的多形状归一、
 * filter_field_id/value 的成对约束。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'feathery_key_deadbeef'
const plugin = createFeatheryPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'forms/feathery',
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

function mockFeathery(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 13 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(featheryActions).length)
    expect(tools).toHaveLength(13)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('get_account_info')).toBe('read')
    expect(effectOf('list_users')).toBe('read')
    expect(effectOf('create_hidden_field')).toBe('write')
    expect(effectOf('delete_user')).toBe('destructive')
  })
})

describe('请求成形', () => {
  it('GET 带 Token 前缀的凭证头,tags 展开成重复 query key', async () => {
    const mock = mockFeathery(200, [{ id: 'f1', name: 'Signup' }])
    const res = await call('list_forms', { tags: ['a', 'b'] })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.feathery.io/api/form/')
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Token ${API_KEY}`)
    expect(url.searchParams.getAll('tags')).toEqual(['a', 'b'])
    await expect(res.json()).resolves.toMatchObject({ content: { forms: [{ id: 'f1' }] } })
  })

  it('POST 提交 JSON body,路径参数被 URL 编码', async () => {
    const mock = mockFeathery(200, { status: 'ok' })
    await call('create_or_update_form_submissions', {
      form_id: 'a/b',
      submissions: [{ user_id: 'u1' }],
    })

    const request = sent(mock)
    expect(request.url).toBe('https://api.feathery.io/api/form/a%2Fb/submission/')
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({ submissions: [{ user_id: 'u1' }] })
  })

  it('edit_hidden_field 走 PATCH,新 ID 在 body 里仍叫 field_id', async () => {
    const mock = mockFeathery(200, { field_id: 'new' })
    await call('edit_hidden_field', { field_id: 'old', new_field_id: 'new' })
    const request = sent(mock)
    expect(request.url).toBe('https://api.feathery.io/api/field/hidden/old/')
    expect(request.method).toBe('PATCH')
    await expect(request.json()).resolves.toEqual({ field_id: 'new' })
  })

  it('省略的可选过滤项不进 query', async () => {
    const mock = mockFeathery(200, { results: [] })
    await call('list_users', { created_after: '2024-01-01' })
    const url = new URL(sent(mock).url)
    expect(url.searchParams.get('created_after')).toBe('2024-01-01')
    expect([...url.searchParams.keys()]).toEqual(['created_after'])
  })
})

describe('响应归一', () => {
  it('列表信封的多种形状都归成数组', async () => {
    mockFeathery(200, { results: [{ id: 'u1' }] })
    await expect((await call('list_users', {})).json())
      .resolves.toMatchObject({ content: { users: [{ id: 'u1' }] } })

    mockFeathery(200, { hidden_fields: [{ field_id: 'h1' }] })
    await expect((await call('list_hidden_fields', {})).json())
      .resolves.toMatchObject({ content: { hiddenFields: [{ field_id: 'h1' }] } })

    // 认不出的形状退化成空列表,而不是把非数组原样透出。
    mockFeathery(200, { unexpected: 1 })
    await expect((await call('list_forms', {})).json())
      .resolves.toEqual({ content: { forms: [] } })
  })

  it('delete 返回归一形状,raw 保留完整响应', async () => {
    mockFeathery(200, { ok: true })
    await expect((await call('delete_user', { id: 'u1' })).json()).resolves.toEqual({
      content: { deleted: true, id: 'u1', raw: { ok: true } },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:form_id 给空串 → 400 且不打上游', async () => {
    const mock = mockFeathery(200, {})
    const res = await call('get_form_schema', { form_id: '' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('只给 filter_field_id 不给值 → 400 且不打上游(否则 Feathery 静默返回全量)', async () => {
    const mock = mockFeathery(200, {})
    const res = await call('list_users', { filter_field_id: 'plan' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('filter_field_value')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 detail/error 字段', async () => {
    mockFeathery(401, { detail: 'Invalid token.' })
    const denied = await call('get_account_info', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid token.',
    })

    mockFeathery(429, { error: 'Too many requests' })
    await expect((await call('get_account_info', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockFeathery(404, { errors: ['No such form'] })
    await expect((await call('get_form_schema', { form_id: 'missing' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'No such form' })

    mockFeathery(500, { message: 'Feathery is down' })
    await expect((await call('get_account_info', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockFeathery(200, {})
    const res = await call('get_account_info', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
