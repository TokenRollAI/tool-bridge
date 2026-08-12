import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGetformPlugin } from '../../src/getform/index'
import { getformActions } from '../../src/getform/schema'

/**
 * Getform 迁移产物的 wire 级验收。重点:两个不同 host、`x-api-key` 凭证头、
 * 200 + `{success:false}` 也算失败、错误状态以响应体里的 code 为准。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'fi_test_deadbeef'
const plugin = createGetformPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'forms/getform',
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

function mockGetform(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(
    typeof payload === 'string' ? payload : JSON.stringify(payload),
    { status, headers: { 'content-type': 'application/json' } },
  )))
  vi.stubGlobal('fetch', fn)
  return fn
}

function sent(mock: ReturnType<typeof vi.fn>): Request {
  return (mock.mock.calls[0] as [Request])[0]
}

const SUBMIT_OK = {
  success: true,
  submission: { id: 's1', submissionDate: '2026-08-12T00:00:00Z', status: true, blocks: {} },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 2 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(getformActions).length)
    expect(tools).toHaveLength(2)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求整形', () => {
  it('submit_form 打提交 host,凭证走 x-api-key,blocks 原样进 body', async () => {
    const mock = mockGetform(200, SUBMIT_OK)
    const res = await call('submit_form', {
      formId: 'form_1',
      blocks: [
        { type: 'sender', properties: { email: 'a@b.c' } },
        { type: 'text', name: 'note', value: 'hi' },
      ],
    })

    const request = sent(mock)
    expect(request.url).toBe('https://forminit.com/f/form_1')
    expect(request.method).toBe('POST')
    expect(request.headers.get('x-api-key')).toBe(API_KEY)
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      blocks: [
        { type: 'sender', properties: { email: 'a@b.c' } },
        { type: 'text', name: 'note', value: 'hi' },
      ],
    })
    await expect(res.json()).resolves.toMatchObject({ content: { success: true } })
  })

  it('list_submissions 打 API host,分页/搜索/时区进 query,files=false 也要发', async () => {
    const mock = mockGetform(200, { data: { id: 'form_1', submissions: [], pagination: {} } })
    await call('list_submissions', {
      formId: 'form 1',
      page: 2,
      size: 50,
      query: 'ada',
      files: false,
      timezone: 'Asia/Shanghai',
    })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    const url = new URL(request.url)
    expect(url.origin).toBe('https://api.forminit.com')
    expect(url.pathname).toBe('/v1/forms/form%201')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('size')).toBe('50')
    expect(url.searchParams.get('query')).toBe('ada')
    // files=false 是"显式不要文件元数据",与"没给"不是一回事。
    expect(url.searchParams.get('files')).toBe('false')
    expect(url.searchParams.get('timezone')).toBe('Asia/Shanghai')
  })

  it('未给的可选参数不进 query', async () => {
    const mock = mockGetform(200, { data: { id: 'f', submissions: [], pagination: {} } })
    await call('list_submissions', { formId: 'f' })
    expect([...new URL(sent(mock).url).searchParams.keys()]).toEqual([])
  })
})

describe('校验与错误', () => {
  it('入参校验生效:file 块不在任何 block 变体里 → 400 且不打上游', async () => {
    const mock = mockGetform(200, SUBMIT_OK)
    const res = await call('submit_form', {
      formId: 'form_1',
      blocks: [{ type: 'file', name: 'doc', value: 'x' }],
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('formId 在生成的 schema 里是 optional,缺失时在拼 URL 前被挡下', async () => {
    const mock = mockGetform(200, SUBMIT_OK)
    const res = await call('submit_form', { blocks: [{ type: 'text', name: 'a', value: 'b' }] })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('formId')
    expect(mock).not.toHaveBeenCalled()
  })

  it('200 + success:false 也算失败(Forminit 的怪异约定)', async () => {
    mockGetform(200, { success: false, code: 400, message: 'form is closed' })
    await expect((await call('submit_form', {
      formId: 'form_1',
      blocks: [{ type: 'text', name: 'a', value: 'b' }],
    })).json()).resolves.toMatchObject({ code: 'invalid_argument', message: 'form is closed' })
  })

  it('错误状态以响应体里的 code 为准,不是 HTTP 状态', async () => {
    // 体内标 401,HTTP 却是 200 —— 只看 HTTP 状态会把凭证问题当成功。
    mockGetform(200, { success: false, statusCode: 401, message: 'invalid api key' })
    await expect((await call('list_submissions', { formId: 'f' })).json())
      .resolves.toMatchObject({ code: 'permission_denied', message: 'invalid api key' })
  })

  it('上游错误按状态归一', async () => {
    mockGetform(401, { message: 'invalid api key' })
    expect((await call('list_submissions', { formId: 'f' })).status).toBe(401)

    mockGetform(429, { message: 'slow down' })
    await expect((await call('list_submissions', { formId: 'f' })).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockGetform(500, '')
    await expect((await call('list_submissions', { formId: 'f' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('成功响应是空体或非 JSON → unavailable', async () => {
    mockGetform(200, '')
    await expect((await call('list_submissions', { formId: 'f' })).json())
      .resolves.toMatchObject({ code: 'unavailable', message: 'empty getform response' })

    mockGetform(200, '<html/>')
    await expect((await call('list_submissions', { formId: 'f' })).json())
      .resolves.toMatchObject({ code: 'unavailable', message: 'invalid getform JSON response' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockGetform(200, SUBMIT_OK)
    const res = await call('list_submissions', { formId: 'f' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
