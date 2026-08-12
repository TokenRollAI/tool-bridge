import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFormcarryPlugin } from '../../src/formcarry/index'
import { formcarryActions } from '../../src/formcarry/schema'

/**
 * Formcarry 迁移产物的 wire 级验收。重点在自定义 `api_key` 头、create_form 的 PUT +
 * form-urlencoded、以及"响应必须是 JSON 对象"这条上游契约。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'fc_live_deadbeef'
const plugin = createFormcarryPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'forms/formcarry',
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

function mockFormcarry(status: number, payload: unknown, contentType = 'application/json'): ReturnType<typeof vi.fn> {
  const body = contentType === 'application/json' ? JSON.stringify(payload) : String(payload)
  const fn = vi.fn(() => Promise.resolve(new Response(body, {
    status,
    headers: { 'content-type': contentType },
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
  it('List 出全部 3 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(formcarryActions).length)
    expect(tools).toHaveLength(3)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('list_submissions')).toBe('read')
    expect(effectOf('create_form')).toBe('write')
    expect(effectOf('delete_form')).toBe('destructive')
  })
})

describe('请求成形', () => {
  it('create_form 走 PUT + form-urlencoded,凭证在 api_key 头', async () => {
    const mock = mockFormcarry(200, { code: 200, title: 'ok', message: 'created', type: 'success', formUrl: 'u' })
    const res = await call('create_form', {
      name: 'Contact',
      email: 'a@example.com',
      webhook: 'https://hooks.example.com/x',
      returnParams: false,
      retention: true,
    })

    const request = sent(mock)
    expect(request.method).toBe('PUT')
    expect(request.url).toBe('https://formcarry.com/api/form')
    expect(request.headers.get('api_key')).toBe(API_KEY)
    expect(request.headers.get('authorization')).toBeNull()
    expect(request.headers.get('content-type')).toContain('application/x-www-form-urlencoded')
    const body = new URLSearchParams(await request.text())
    expect(body.get('name')).toBe('Contact')
    expect(body.get('email')).toBe('a@example.com')
    expect(body.get('webhook')).toBe('https://hooks.example.com/x')
    // 布尔明确送出 false,不能因为"假值"被丢掉。
    expect(body.get('returnParams')).toBe('false')
    expect(body.get('retention')).toBe('true')
    expect(body.has('returnUrl')).toBe(false)
    await expect(res.json()).resolves.toMatchObject({ content: { formUrl: 'u' } })
  })

  it('delete_form 走 DELETE,form_id 被 URL 编码', async () => {
    const mock = mockFormcarry(200, { code: 200, title: 'ok', message: 'deleted', type: 'success' })
    await call('delete_form', { form_id: 'f/1' })
    const request = sent(mock)
    expect(request.method).toBe('DELETE')
    expect(request.url).toBe('https://formcarry.com/api/form/f%2F1')
  })

  it('list_submissions 把过滤器送进 query,form_id 只在路径里', async () => {
    const mock = mockFormcarry(200, { form: 'f1', results: 0, submissions: [], pagination: {} })
    await call('list_submissions', { form_id: 'f1', limit: 20, page: 2, sort: 'createdAt:-1', filter: 'spam:false' })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/form/f1/submissions')
    expect(url.searchParams.get('limit')).toBe('20')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('sort')).toBe('createdAt:-1')
    expect(url.searchParams.get('filter')).toBe('spam:false')
    expect(url.searchParams.has('form_id')).toBe(false)
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:create_form 缺必填 email → 400 且不打上游', async () => {
    const mock = mockFormcarry(200, {})
    const res = await call('create_form', { name: 'Contact' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('limit 超上限 → 400 且不打上游', async () => {
    const mock = mockFormcarry(200, {})
    const res = await call('list_submissions', { form_id: 'f1', limit: 500 })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息在 message/title 之间回落', async () => {
    mockFormcarry(401, { message: 'Invalid api key' })
    const denied = await call('list_submissions', { form_id: 'f1' })
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid api key',
    })

    mockFormcarry(429, { title: 'Too many requests' })
    await expect((await call('list_submissions', { form_id: 'f1' })).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true, message: 'Too many requests' })

    mockFormcarry(404, { error: 'form not found' })
    await expect((await call('delete_form', { form_id: 'missing' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'form not found' })

    mockFormcarry(500, {})
    await expect((await call('list_submissions', { form_id: 'f1' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('成功响应不是 JSON 对象 → unavailable(上游破契约,不是入参错)', async () => {
    mockFormcarry(200, [1, 2])
    await expect((await call('list_submissions', { form_id: 'f1' })).json())
      .resolves.toMatchObject({ code: 'unavailable' })

    mockFormcarry(200, 'not json', 'text/plain')
    await expect((await call('list_submissions', { form_id: 'f1' })).json())
      .resolves.toMatchObject({ code: 'unavailable' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockFormcarry(200, {})
    const res = await call('list_submissions', { form_id: 'f1' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
