import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCincopaPlugin } from '../../src/cincopa/index'
import { cincopaActions } from '../../src/cincopa/schema'

/**
 * Cincopa 迁移产物的 wire 级验收。重点在凭证走 `api_token` query(Cincopa 没有 header
 * 形式)、数组入参的逗号拼接,以及 page_count / pages_count 两种拼法。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'cincopa_test_token'
const plugin = createCincopaPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'media/cincopa',
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

function mockCincopa(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

const PAGINATION = { page: 1, items_per_page: 20, items_count: 2 }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 4 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(cincopaActions).length)
    expect(tools).toHaveLength(4)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('Cincopa 侧全部只读,effect 应当都是 read', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string }>
    expect(tools.every(tool => tool.effect === 'read')).toBe(true)
  })
})

describe('请求构造', () => {
  it('凭证走 api_token query,数组入参拼成逗号串', async () => {
    const mock = mockCincopa(200, {
      workspace: 'default',
      galleries: [],
      tag_cloud: {},
      items_data: { ...PAGINATION, page_count: 1 },
    })
    await call('list_galleries', {
      search: 'promo',
      page: 2,
      itemsPerPage: 50,
      filterTags: ['spring', '-archive'],
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.cincopa.com/v2/gallery.list.json')
    // Cincopa 没有 header 形式的凭证,只能进 query。
    expect(url.searchParams.get('api_token')).toBe(API_KEY)
    expect(url.searchParams.get('search')).toBe('promo')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('items_per_page')).toBe('50')
    expect(url.searchParams.get('filter_tags')).toBe('spring,-archive')
    expect(request.method).toBe('GET')
    // 凭证不该同时出现在 Authorization 头上。
    expect(request.headers.get('authorization')).toBeNull()
  })

  it('list_assets 的 types/details 分别映射成 type/details', async () => {
    const mock = mockCincopa(200, { items: [], items_data: { ...PAGINATION, pages_count: 1 } })
    await call('list_assets', {
      types: ['image', 'video'],
      details: ['tags', 'metadata'],
      referenceId: 'ref-1',
    })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v2/asset.list.json')
    expect(url.searchParams.get('type')).toBe('image,video')
    expect(url.searchParams.get('details')).toBe('tags,metadata')
    expect(url.searchParams.get('reference_id')).toBe('ref-1')
  })
})

describe('响应形状', () => {
  it('gallery.list 的分页字段是 page_count', async () => {
    mockCincopa(200, {
      workspace: 'default',
      galleries: [{ fid: 'g1' }],
      tag_cloud: { spring: 3 },
      items_data: { page: 1, items_per_page: 20, items_count: 1, page_count: 1 },
    })
    await expect((await call('list_galleries', {})).json()).resolves.toEqual({
      content: {
        workspace: 'default',
        galleries: [{ fid: 'g1' }],
        tagCloud: { spring: 3 },
        pagination: { page: 1, itemsPerPage: 20, itemsCount: 1, pageCount: 1 },
      },
    })
  })

  it('gallery.get_items 的分页字段是 pages_count,且藏在 folder 里', async () => {
    mockCincopa(200, {
      fid: 'g1',
      upload_url: 'https://upload.cincopa.com/g1',
      claimed: 'yes',
      spfid: 'sp1',
      folder: {
        items: [{ rid: 'a1' }],
        items_data: { page: 1, items_per_page: 20, items_count: 1, pages_count: 1 },
      },
    })
    await expect((await call('list_gallery_items', { fid: 'g1' })).json()).resolves.toMatchObject({
      content: {
        fid: 'g1',
        uploadUrl: 'https://upload.cincopa.com/g1',
        items: [{ rid: 'a1' }],
        pagination: { pageCount: 1 },
      },
    })
  })

  it('上游缺必填字段 → unavailable(不悄悄补 null)', async () => {
    mockCincopa(200, { galleries: [], tag_cloud: {}, items_data: { ...PAGINATION, page_count: 1 } })
    await expect((await call('list_galleries', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:filterTags 给空数组 → 400 且不打上游', async () => {
    const mock = mockCincopa(200, {})
    const res = await call('list_galleries', { filterTags: [] })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('缺必填 fid → 400 且不打上游', async () => {
    const mock = mockCincopa(200, {})
    expect((await call('list_gallery_items', {})).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 message/error', async () => {
    mockCincopa(401, { message: 'Invalid api_token' })
    const denied = await call('list_asset_tags', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid api_token',
    })
    vi.unstubAllGlobals()

    mockCincopa(429, { error: 'Too many requests' })
    await expect((await call('list_asset_tags', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })
    vi.unstubAllGlobals()

    mockCincopa(500, {})
    await expect((await call('list_asset_tags', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockCincopa(200, {})
    const res = await call('list_asset_tags', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
