import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createReadwisePlugin } from '../../src/readwise/index'
import { readwiseActions } from '../../src/readwise/schema'

/**
 * Readwise 迁移产物的 wire 级验收。重点在 `Token <key>` 认证头、v2/v3 两套 API 的
 * 字段拼法差异、以及 save/update 响应里文档可能被包一层的情况。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'rw_test_token'
const plugin = createReadwisePlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'notes/readwise',
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

function mockReadwise(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 6 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(readwiseActions).length)
    expect(tools).toHaveLength(6)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('list_books')).toBe('read')
    expect(effectOf('export_highlights')).toBe('read')
    expect(effectOf('save_document')).toBe('write')
    expect(effectOf('create_highlights')).toBe('write')
  })
})

describe('请求构造', () => {
  it('凭证头是 Token 而非 Bearer,list_books 的筛选走 DRF 风格 query', async () => {
    const mock = mockReadwise(200, { count: 0, results: [] })
    await call('list_books', {
      page: 2,
      pageSize: 50,
      category: 'articles',
      updatedAfter: '2024-01-01T00:00:00Z',
      updatedBefore: '2024-02-01T00:00:00Z',
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://readwise.io/api/v2/books/')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('page_size')).toBe('50')
    expect(url.searchParams.get('category')).toBe('articles')
    expect(url.searchParams.get('updated__gt')).toBe('2024-01-01T00:00:00Z')
    expect(url.searchParams.get('updated__lt')).toBe('2024-02-01T00:00:00Z')
    expect(request.headers.get('authorization')).toBe(`Token ${API_KEY}`)
  })

  it('save_document 映射成 snake_case,省略的可选字段不进 body', async () => {
    const mock = mockReadwise(201, { id: 'doc_1' })
    await call('save_document', {
      url: 'https://example.com/post',
      title: 'A post',
      shouldCleanHtml: false,
      savedUsing: 'tool-bridge',
      tags: ['reading'],
    })

    const request = sent(mock)
    expect(request.url).toBe('https://readwise.io/api/v3/save/')
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      url: 'https://example.com/post',
      title: 'A post',
      // false 要发出去,不能被"假值即省略"吞掉。
      should_clean_html: false,
      saved_using: 'tool-bridge',
      tags: ['reading'],
    })
  })

  it('update_document 用 PATCH,documentId 被 URL 编码进路径且不进 body', async () => {
    const mock = mockReadwise(200, { id: 'a/b' })
    await call('update_document', { documentId: 'a/b', location: 'archive' })
    const request = sent(mock)
    expect(request.url).toBe('https://readwise.io/api/v3/update/a%2Fb/')
    expect(request.method).toBe('PATCH')
    await expect(request.json()).resolves.toEqual({ location: 'archive' })
  })
})

describe('响应归一', () => {
  it('export 的 user_book_id 与 books 的 id 都能落到同一个 id 字段', async () => {
    mockReadwise(200, {
      count: 1,
      nextPageCursor: 'cursor_2',
      results: [{
        user_book_id: 77,
        title: 'Deep Work',
        num_highlights: 2,
        updated: '2024-01-02T00:00:00Z',
        highlights: [{ id: 5, text: 'focus', note: '', highlighted_at: '2024-01-01T00:00:00Z' }],
      }],
    })
    const body = (await (await call('export_highlights', {})).json()) as {
      content: { books: Array<Record<string, unknown>>, count: number, nextPageCursor: string }
    }
    expect(body.content.count).toBe(1)
    expect(body.content.nextPageCursor).toBe('cursor_2')
    const book = body.content.books[0]!
    expect(book.id).toBe(77)
    expect(book.numHighlights).toBe(2)
    expect(book.updatedAt).toBe('2024-01-02T00:00:00Z')
    // note 保留空串(清空备注要能表达),而不是被压成 null。
    expect((book.highlights as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: 5,
      text: 'focus',
      note: '',
      highlightedAt: '2024-01-01T00:00:00Z',
    })
  })

  it('Reader 的 tags 是对象时取键名', async () => {
    mockReadwise(200, {
      count: 1,
      results: [{ id: 'doc_1', tags: { reading: {}, ai: {} }, created_at: '2024-01-01T00:00:00Z' }],
    })
    const body = (await (await call('list_documents', {})).json()) as {
      content: { documents: Array<Record<string, unknown>> }
    }
    expect(body.content.documents[0]!.tags).toEqual(['reading', 'ai'])
    expect(body.content.documents[0]!.createdAt).toBe('2024-01-01T00:00:00Z')
  })

  it('save 响应把文档包在 document 里时也能拆出来', async () => {
    mockReadwise(201, { document: { id: 'doc_9', url: 'https://example.com/post' } })
    await expect((await call('save_document', { url: 'https://example.com/post' })).json())
      .resolves.toMatchObject({
        content: { document: { id: 'doc_9', url: 'https://example.com/post' } },
      })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:url 不是合法 URL → 400 且不打上游', async () => {
    const mock = mockReadwise(200, {})
    const res = await call('save_document', { url: 'not-a-url' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('缺必填 documentId → 400 且不打上游', async () => {
    const mock = mockReadwise(200, {})
    expect((await call('update_document', { location: 'archive' })).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,DRF 的字段级错误也能取出消息', async () => {
    mockReadwise(401, { detail: 'Invalid token.' })
    const denied = await call('list_books', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid token.',
    })
    vi.unstubAllGlobals()

    mockReadwise(429, { detail: 'Request was throttled.' })
    await expect((await call('list_books', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })
    vi.unstubAllGlobals()

    mockReadwise(400, { url: ['Enter a valid URL.'] })
    await expect((await call('save_document', { url: 'https://example.com' })).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'Enter a valid URL.' })
    vi.unstubAllGlobals()

    mockReadwise(502, {})
    await expect((await call('list_books', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockReadwise(200, {})
    const res = await call('list_books', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
