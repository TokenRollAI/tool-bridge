import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCustomgptPlugin } from '../../src/customgpt/index'
import { customgptActions } from '../../src/customgpt/schema'

/**
 * CustomGPT 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * `{status,data}` 的剥壳、send_message 的 multipart 与 `labels[0][]` 约定、
 * list_documents 多一层 `pages`、分页字段的数字字符串兼容。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'cgpt_test_key'
const plugin = createCustomgptPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'ai/customgpt',
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

function mockCustomgpt(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), {
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
  it('List 出全部 7 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(customgptActions).length)
    expect(tools).toHaveLength(7)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('list_agents')).toBe('read')
    expect(effectOf('list_documents')).toBe('read')
    expect(effectOf('send_message')).toBe('write')
    expect(effectOf('create_conversation')).toBe('write')
  })
})

describe('响应剥壳与分页归一', () => {
  it('list_agents:剥掉 {status,data} 外壳,分页字段的数字字符串也认', async () => {
    const mock = mockCustomgpt(200, {
      status: 'success',
      data: {
        data: [{ id: 1, project_name: 'Docs bot' }],
        current_page: 1,
        last_page: '3',
        per_page: 10,
        total: '27',
        next_page_url: 'https://app.customgpt.ai/api/v1/projects?page=2',
        prev_page_url: null,
      },
    })
    const res = await call('list_agents', { page: 1, order: 'desc', orderBy: 'created_at' })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://app.customgpt.ai/api/v1/projects')
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.get('order')).toBe('desc')
    // 上游把 camelCase 的 orderBy 原样发出,不转 snake_case。
    expect(url.searchParams.get('orderBy')).toBe('created_at')

    await expect(res.json()).resolves.toMatchObject({
      content: {
        agents: [{ id: 1, project_name: 'Docs bot' }],
        pagination: {
          currentPage: 1,
          lastPage: 3,
          perPage: 10,
          total: 27,
          nextPageUrl: 'https://app.customgpt.ai/api/v1/projects?page=2',
          previousPageUrl: null,
        },
      },
    })
  })

  it('list_documents 的分页在多一层的 pages 上', async () => {
    const mock = mockCustomgpt(200, {
      status: 'success',
      data: {
        project: { id: 7 },
        pages: { data: [{ id: 11, page_url: 'https://x.test/a' }], current_page: 2, total: 5 },
      },
    })
    const res = await call('list_documents', { projectId: 7, crawlStatus: 'ok', indexStatus: 'queued' })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/v1/projects/7/pages')
    expect(url.searchParams.get('crawl_status')).toBe('ok')
    expect(url.searchParams.get('index_status')).toBe('queued')

    await expect(res.json()).resolves.toMatchObject({
      content: {
        project: { id: 7 },
        documents: [{ id: 11 }],
        pagination: { currentPage: 2, total: 5 },
      },
    })
  })
})

describe('send_message 的 multipart 体', () => {
  it('prompt 与可选字段进 form-data,labels 用固定下标的重复键,lang/external_id 走 query', async () => {
    const mock = mockCustomgpt(200, {
      status: 'success',
      data: { id: 42, openai_response: 'Hello there', citations: [9] },
    })
    const res = await call('send_message', {
      projectId: 7,
      sessionId: 'sess/1',
      prompt: 'Hi',
      lang: 'en',
      externalId: 'ext-1',
      responseSource: 'own_content',
      labels: ['docs', 'faq'],
      labelsExclusive: true,
      actionOverrides: { search: { enabled: false } },
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    const url = new URL(request.url)
    expect(url.pathname).toBe('/api/v1/projects/7/conversations/sess%2F1/messages')
    expect(url.searchParams.get('lang')).toBe('en')
    expect(url.searchParams.get('external_id')).toBe('ext-1')
    // FormData 的 content-type 必须带 boundary,插件不能自己写死。
    expect(request.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/)

    const form = await request.formData()
    expect(form.get('prompt')).toBe('Hi')
    expect(form.get('response_source')).toBe('own_content')
    expect(form.getAll('labels[0][]')).toEqual(['docs', 'faq'])
    expect(form.get('labels_exclusive')).toBe('true')
    expect(form.get('action_overrides')).toBe('{"search":{"enabled":false}}')
    expect(form.has('custom_persona')).toBe(false)

    await expect(res.json()).resolves.toMatchObject({
      content: { messageId: 42, response: 'Hello there', citations: [9] },
    })
  })

  it('create_conversation 走 JSON 体,省略 name 时发空对象', async () => {
    const mock = mockCustomgpt(200, { status: 'success', data: { session_id: 'sess-9' } })
    const res = await call('create_conversation', { projectId: 7 })
    const request = sent(mock)
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({})
    await expect(res.json()).resolves.toMatchObject({ content: { sessionId: 'sess-9' } })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:projectId 给 0 → 400 且不打上游', async () => {
    const mock = mockCustomgpt(200, {})
    const res = await call('get_agent', { projectId: 0 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('缺必填 prompt → 400 且不打上游', async () => {
    const mock = mockCustomgpt(200, {})
    const res = await call('send_message', { projectId: 7, sessionId: 's1' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 CustomGPT 的 message', async () => {
    mockCustomgpt(401, { message: 'Unauthenticated.' })
    const denied = await call('list_agents', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Unauthenticated.',
    })

    mockCustomgpt(404, { data: { message: 'Project not found' } })
    await expect((await call('get_agent', { projectId: 999 })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'Project not found' })

    mockCustomgpt(429, { message: 'Too many requests' })
    await expect((await call('list_agents', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockCustomgpt(500, { error: { message: 'CustomGPT is down' } })
    await expect((await call('list_agents', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockCustomgpt(200, {})
    const res = await call('list_agents', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
