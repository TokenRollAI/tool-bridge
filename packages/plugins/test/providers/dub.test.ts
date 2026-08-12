import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDubPlugin } from '../../src/dub/index'
import { dubActions } from '../../src/dub/schema'

/**
 * Dub 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 裸数组响应的 normalize、query 里数组的逗号连接、retrieve_link 的跨字段互斥、
 * 空 PATCH 的本地拦截、count 响应的三种形状。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'dub_sk_deadbeef'
const plugin = createDubPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'links/dub',
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

function mockDub(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

const LINK = {
  id: 'link_1',
  domain: 'dub.sh',
  key: 'abc',
  url: 'https://example.com',
  shortLink: 'https://dub.sh/abc',
  clicks: 7,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 15 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(dubActions).length)
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
    expect(effectOf('list_links')).toBe('read')
    expect(effectOf('count_links')).toBe('read')
    expect(effectOf('create_link')).toBe('write')
    expect(effectOf('delete_link')).toBe('destructive')
  })
})

describe('请求成形', () => {
  it('create_link:POST + JSON body,凭证走 Bearer', async () => {
    const mock = mockDub(200, LINK)
    const res = await call('create_link', { url: 'https://example.com', key: 'abc' })

    const request = sent(mock)
    expect(request.url).toBe('https://api.dub.co/links')
    expect(request.method).toBe('POST')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({ url: 'https://example.com', key: 'abc' })

    await expect(res.json()).resolves.toMatchObject({
      content: { link: { id: 'link_1', shortLink: 'https://dub.sh/abc', clicks: 7 } },
    })
  })

  it('list_links:裸数组响应 normalize 成 links,query 里数组按逗号连接', async () => {
    const mock = mockDub(200, [LINK])
    const res = await call('list_links', { tagIds: ['t1', 't2'], pageSize: 50 })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/links')
    expect(url.searchParams.get('tagIds')).toBe('t1,t2')
    expect(url.searchParams.get('pageSize')).toBe('50')
    expect(sent(mock).method).toBe('GET')

    const body = (await res.json()) as { content: { links: Array<{ id: string }> } }
    expect(body.content.links).toHaveLength(1)
    expect(body.content.links[0]?.id).toBe('link_1')
  })

  it('update_link:路径参数被 URL 编码,且不重复出现在 body 里', async () => {
    const mock = mockDub(200, LINK)
    await call('update_link', { linkId: 'link a/b', url: 'https://new.example.com' })

    const request = sent(mock)
    expect(request.url).toBe('https://api.dub.co/links/link%20a%2Fb')
    expect(request.method).toBe('PATCH')
    await expect(request.json()).resolves.toEqual({ url: 'https://new.example.com' })
  })

  it('delete_link:DELETE + 归一成 {deleted, raw}', async () => {
    const mock = mockDub(200, { id: 'link_1' })
    const res = await call('delete_link', { linkId: 'link_1' })
    expect(sent(mock).method).toBe('DELETE')
    await expect(res.json()).resolves.toEqual({
      content: { deleted: true, raw: { id: 'link_1' } },
    })
  })

  it('count_links:{count} 与裸数字两种响应都收', async () => {
    mockDub(200, { count: 42 })
    await expect((await call('count_links', {})).json())
      .resolves.toMatchObject({ content: { count: 42 } })

    mockDub(200, 7)
    await expect((await call('count_links', {})).json())
      .resolves.toMatchObject({ content: { count: 7 } })
  })

  it('省略的可选字段不进 query', async () => {
    const mock = mockDub(200, [])
    await call('list_tags', { page: 2 })
    const url = new URL(sent(mock).url)
    expect([...url.searchParams.keys()]).toEqual(['page'])
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:url 给非 URL → 400 且不打上游', async () => {
    const mock = mockDub(200, {})
    const res = await call('create_link', { url: 'not-a-url' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('retrieve_link 全缺标识符 → 400 且不打上游', async () => {
    const mock = mockDub(200, {})
    const res = await call('retrieve_link', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('retrieve_link')
    expect(mock).not.toHaveBeenCalled()
  })

  it('retrieve_link 只给 domain 不给 key → 400(domain 查法必须成对)', async () => {
    const mock = mockDub(200, {})
    const res = await call('retrieve_link', { domain: 'dub.sh' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('key')
    expect(mock).not.toHaveBeenCalled()
  })

  it('update_tag 空 PATCH → 400 且不打上游', async () => {
    const mock = mockDub(200, {})
    const res = await call('update_tag', { id: 'tag_1' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('update_tag')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 error.message', async () => {
    mockDub(404, { error: { message: 'Link not found' } })
    await expect((await call('retrieve_link', { linkId: 'missing' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'Link not found' })

    mockDub(401, { error: { message: 'Unauthorized' } })
    expect((await call('list_links', {})).status).toBe(401)

    mockDub(429, { error: { message: 'Too many requests' } })
    await expect((await call('list_links', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockDub(500, { error: { message: 'Dub is down' } })
    await expect((await call('list_links', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockDub(200, [])
    const res = await call('list_links', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
