import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpenseaPlugin } from '../../src/opensea/index'
import { openseaActions } from '../../src/opensea/schema'

/**
 * OpenSea 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 数组 query 的重复同名键、`next.value` 这个带点的游标键名、traits 的 JSON 序列化、
 * 路径参数编码、response 归一(尤其 contract/price 的对象-或-裸值两种形状)。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'os_test_deadbeef'
const plugin = createOpenseaPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'nft/opensea',
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

function mockOpensea(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 9 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(openseaActions).length)
    expect(tools).toHaveLength(9)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('handler 表覆盖了规格表的每个 action', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ name: string }>
    expect(tools.map(t => t.name).sort()).toEqual(Object.keys(openseaActions).sort())
  })
})

describe('query 编码', () => {
  it('数组参数重复同名键,凭证走 x-api-key 头', async () => {
    const mock = mockOpensea(200, { results: [{ id: 1 }] })
    await call('search', {
      query: 'pudgy',
      chains: ['ethereum', 'base'],
      assetTypes: ['collection', 'nft'],
      limit: 5,
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('GET')
    expect(url.origin + url.pathname).toBe('https://api.opensea.io/api/v2/search')
    expect(request.headers.get('x-api-key')).toBe(API_KEY)
    expect(request.headers.get('accept')).toBe('application/json')
    expect(url.searchParams.get('query')).toBe('pudgy')
    expect(url.searchParams.getAll('chains')).toEqual(['ethereum', 'base'])
    expect(url.searchParams.getAll('asset_types')).toEqual(['collection', 'nft'])
    expect(url.searchParams.get('limit')).toBe('5')
  })

  it('平台不注入 UA:请求不带自定义 user-agent 头', async () => {
    const mock = mockOpensea(200, { results: [] })
    await call('search', { query: 'x' })
    expect(sent(mock).headers.get('user-agent')).toBeNull()
  })

  it('省略的可选参数不出现在 query 里', async () => {
    const mock = mockOpensea(200, { results: [] })
    await call('search', { query: 'x' })
    expect([...new URL(sent(mock).url).searchParams.keys()]).toEqual(['query'])
  })

  it('traits 整个 JSON 序列化,游标键名是 next.value(不是 next)', async () => {
    const mock = mockOpensea(200, { nfts: [], next: 'cur_2' })
    await call('list_collection_nfts', {
      slug: 'pudgy penguins',
      traits: [{ traitType: 'Background', value: 'Blue' }],
      hasAgentBinding: true,
      limit: 50,
      next: 'cur_1',
    })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/v2/collection/pudgy%20penguins/nfts')
    expect(url.searchParams.get('traits')).toBe(
      JSON.stringify([{ traitType: 'Background', value: 'Blue' }]),
    )
    expect(url.searchParams.get('has_agent_binding')).toBe('true')
    expect(url.searchParams.get('next.value')).toBe('cur_1')
    expect(url.searchParams.has('next')).toBe(false)
    expect(url.searchParams.get('limit')).toBe('50')
  })

  it('hasAgentBinding: false 要发出去(假值不等于省略)', async () => {
    const mock = mockOpensea(200, { nfts: [] })
    await call('list_collection_nfts', { slug: 'azuki', hasAgentBinding: false })
    expect(new URL(sent(mock).url).searchParams.get('has_agent_binding')).toBe('false')
  })

  it('路径参数被 URL 编码,不会逃逸出路径段', async () => {
    const mock = mockOpensea(200, { nft: { identifier: '1' } })
    await call('get_nft', { chain: 'ethereum', address: '0xAb/Cd', identifier: '../7' })
    expect(new URL(sent(mock).url).pathname).toBe(
      '/api/v2/chain/ethereum/contract/0xAb%2FCd/nfts/..%2F7',
    )
  })

  it('各端点的路径与上游一致(traits 不在 /collections 下)', async () => {
    const traits = mockOpensea(200, { categories: {} })
    await call('list_collection_traits', { slug: 'azuki' })
    expect(new URL(sent(traits).url).pathname).toBe('/api/v2/traits/azuki')

    const stats = mockOpensea(200, { total: { volume: 1 } })
    await call('get_collection_stats', { slug: 'azuki' })
    expect(new URL(sent(stats).url).pathname).toBe('/api/v2/collections/azuki/stats')

    const listing = mockOpensea(200, { order_hash: '0x1' })
    await call('get_best_nft_listing', { slug: 'azuki', identifier: '7', includePrivateListings: true })
    const listingUrl = new URL(sent(listing).url)
    expect(listingUrl.pathname).toBe('/api/v2/listings/collection/azuki/nfts/7/best')
    expect(listingUrl.searchParams.get('include_private_listings')).toBe('true')

    const offer = mockOpensea(200, { order_hash: '0x2' })
    await call('get_best_nft_offer', { slug: 'azuki', identifier: '7' })
    expect(new URL(sent(offer).url).pathname).toBe('/api/v2/offers/collection/azuki/nfts/7/best')

    const offers = mockOpensea(200, { offers: [] })
    await call('list_collection_offers', { slug: 'azuki', next: 'cur_1', limit: 20 })
    const offersUrl = new URL(sent(offers).url)
    expect(offersUrl.pathname).toBe('/api/v2/offers/collection/azuki')
    expect(offersUrl.searchParams.get('next.value')).toBe('cur_1')
  })
})

describe('响应归一', () => {
  it('collection 的 slug 从 collection 字段取,raw 保留完整响应', async () => {
    mockOpensea(200, { collection: 'azuki', name: 'Azuki', image_url: 'https://i/x.png', extra: 1 })
    const res = await call('get_collection', { slug: 'azuki' })
    await expect(res.json()).resolves.toEqual({
      content: {
        collection: {
          slug: 'azuki',
          name: 'Azuki',
          description: null,
          imageUrl: 'https://i/x.png',
          bannerImageUrl: null,
          owner: null,
          raw: { collection: 'azuki', name: 'Azuki', image_url: 'https://i/x.png', extra: 1 },
        },
      },
    })
  })

  it('nft 的 contract 既认对象也认裸地址,分页游标一并透出', async () => {
    mockOpensea(200, {
      nfts: [
        { identifier: '1', contract: { address: '0xaaa' }, chain: 'ethereum' },
        { identifier: '2', contract: '0xbbb' },
      ],
      next: 'cur_2',
    })
    const res = await call('list_collection_nfts', { slug: 'azuki' })
    const body = (await res.json()) as {
      content: {
        nfts: Array<{ contract: string | null }>
        pagination: { next: string | null, previous: string | null }
      }
    }
    expect(body.content.nfts.map(n => n.contract)).toEqual(['0xaaa', '0xbbb'])
    expect(body.content.pagination).toEqual({ next: 'cur_2', previous: null })
  })

  it('order 的 price 从 price.value 取、currency 从 price.currency.symbol 取', async () => {
    mockOpensea(200, {
      order_hash: '0xdead',
      type: 'basic',
      price: { value: '1500000000000000000', currency: { symbol: 'WETH' } },
      maker: { address: '0xmaker' },
    })
    const res = await call('get_best_nft_offer', { slug: 'azuki', identifier: '7' })
    await expect(res.json()).resolves.toMatchObject({
      content: {
        offer: {
          orderHash: '0xdead',
          type: 'basic',
          price: '1500000000000000000',
          currency: 'WETH',
          maker: '0xmaker',
          taker: null,
        },
      },
    })
  })

  it('get_nft 既认被 nft 包裹的响应,也认裸对象', async () => {
    mockOpensea(200, { nft: { identifier: '7', name: 'Azuki #7' } })
    await expect((await call('get_nft', { chain: 'ethereum', address: '0xa', identifier: '7' })).json())
      .resolves.toMatchObject({ content: { nft: { identifier: '7', name: 'Azuki #7' } } })

    mockOpensea(200, { identifier: '8', name: 'Azuki #8' })
    await expect((await call('get_nft', { chain: 'ethereum', address: '0xa', identifier: '8' })).json())
      .resolves.toMatchObject({ content: { nft: { identifier: '8', name: 'Azuki #8' } } })
  })

  it('stats 与 traits 原样透出(OpenSea 的结构还在变,归一会吃掉新字段)', async () => {
    mockOpensea(200, { total: { volume: 42, floor_price: 1.2 }, intervals: [], future_field: true })
    await expect((await call('get_collection_stats', { slug: 'azuki' })).json())
      .resolves.toEqual({
        content: { stats: { total: { volume: 42, floor_price: 1.2 }, intervals: [], future_field: true } },
      })

    mockOpensea(200, { categories: { Background: 'string' }, counts: { Background: { Blue: 10 } } })
    await expect((await call('list_collection_traits', { slug: 'azuki' })).json())
      .resolves.toEqual({
        content: { traits: { categories: { Background: 'string' }, counts: { Background: { Blue: 10 } } } },
      })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:limit 超上限 → 400 且不打上游', async () => {
    const mock = mockOpensea(200, {})
    const res = await call('search', { query: 'x', limit: 999 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('未声明的 assetTypes 枚举值 → 400 且不打上游', async () => {
    const mock = mockOpensea(200, {})
    const res = await call('search', { query: 'x', assetTypes: ['contract'] })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('必填参数缺失 → 400 且不打上游', async () => {
    const mock = mockOpensea(200, {})
    const res = await call('get_nft', { chain: 'ethereum', address: '0xa' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('纯空白的必填串 Zod 拦不住,由 handler 挡下 → 400 且不打上游', async () => {
    const mock = mockOpensea(200, {})
    const res = await call('get_collection', { slug: '   ' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('slug')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 OpenSea 的各种错误体形状', async () => {
    mockOpensea(401, { detail: 'Unauthorized' })
    const unauthorized = await call('get_collection', { slug: 'azuki' })
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Unauthorized',
    })

    mockOpensea(429, { message: 'Request was throttled.' })
    const throttled = await call('get_collection', { slug: 'azuki' })
    expect(throttled.status).toBe(429)
    await expect(throttled.json()).resolves.toMatchObject({
      code: 'rate_limited',
      message: 'Request was throttled.',
      retryable: true,
    })

    mockOpensea(404, { errors: ['Collection not found', 'check the slug'] })
    await expect((await call('get_collection', { slug: 'nope' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'Collection not found; check the slug' })

    mockOpensea(500, { error: { message: 'OpenSea is down' } })
    await expect((await call('get_collection', { slug: 'azuki' })).json())
      .resolves.toMatchObject({ code: 'unavailable', message: 'OpenSea is down', retryable: true })
  })

  it('拿不到可用错误消息时退回状态码描述', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 403 }))))
    await expect((await call('get_collection', { slug: 'azuki' })).json())
      .resolves.toMatchObject({ code: 'permission_denied', message: 'OpenSea 返回 HTTP 403' })
  })

  it('上游回非对象 JSON → unavailable(契约破了,不是调用方的错)', async () => {
    mockOpensea(200, ['not', 'an', 'object'])
    const res = await call('get_collection', { slug: 'azuki' })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { code: string }).code).toBe('unavailable')
  })

  it('传输层失败 → 可重试的 unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('socket hang up'))))
    const res = await call('get_collection', { slug: 'azuki' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockOpensea(200, {})
    const res = await call('search', { query: 'x' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
