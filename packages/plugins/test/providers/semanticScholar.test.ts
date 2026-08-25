import { describe, expect, it, vi } from 'vitest'
import { createSemanticScholarPlugin } from '../../src/semantic_scholar/index'
import { semanticScholarActions } from '../../src/semantic_scholar/schema'
import { createProviderHarness } from '../support/providerHarness'

/**
 * Semantic Scholar 迁移产物的 wire 级验收。重点在几处"迁移最容易迁丢"的地方:
 * `openAccessPdf` 的旗标语义、两套分页游标、两个 API family 的 base URL、
 * 推荐接口的 `recommendedPapers` 键名,以及 429 必须是**可重试**的。
 */

const API_KEY = 's2-testkey'
const GRAPH = 'https://api.semanticscholar.org/graph/v1'
const plugin = createSemanticScholarPlugin()

const {
  call,
  envelope,
  sent,
  env: ENV,
  stubFetch,
} = createProviderHarness({
  mountPath: 'research/s2',
  plugin,
  upstreamAuth: API_KEY,
})

function mockS2(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  return stubFetch(() => Promise.resolve(payload === null
    ? new Response(null, { status })
    : new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      })))
}

async function content(res: Response): Promise<unknown> {
  return ((await res.json()) as { content: unknown }).content
}

describe('契约面', () => {
  it('List 出全部 16 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(semanticScholarActions).length)
    expect(tools).toHaveLength(16)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('~describe 报成单个 tools/v1 export,且不声明凭证探针(16 个 action 都有必填入参)', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    const described = (await res.json()) as {
      exports: Array<{ credentialProbe?: unknown, id: string, oauth?: unknown, profile: string }>
    }
    expect(described.exports).toHaveLength(1)
    expect(described.exports[0]).toMatchObject({ id: 'actions', profile: 'tools/v1' })
    expect(described.exports[0]?.credentialProbe).toBeUndefined()
    expect(described.exports[0]?.oauth).toBeUndefined()
  })
})

describe('请求拼装', () => {
  it('get_paper:凭证走 x-api-key 头,paperId 编进路径,fields 进 query', async () => {
    const mock = mockS2(200, { paperId: 'p1', title: 'T' })
    const res = await call('get_paper', { paperId: 'DOI:10.1234/abc', fields: 'title,year' })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('GET')
    expect(request.headers.get('x-api-key')).toBe(API_KEY)
    expect(request.headers.get('accept')).toBe('application/json')
    // GET 不带 content-type,也不带 body。
    expect(request.headers.get('content-type')).toBeNull()
    expect(await request.text()).toBe('')
    expect(url.origin + url.pathname).toBe(`${GRAPH}/paper/DOI%3A10.1234%2Fabc`)
    expect(Object.fromEntries(url.searchParams)).toEqual({ fields: 'title,year' })
    await expect(content(res)).resolves.toEqual({ paper: { paperId: 'p1', title: 'T' } })
  })

  it('paperId 前后的空白被去掉,不会编进路径变成一个必然 404 的 id', async () => {
    const mock = mockS2(200, {})
    await call('get_paper', { paperId: '  p1  ' })
    expect(new URL(sent(mock).url).pathname).toBe('/graph/v1/paper/p1')
  })

  it('openAccessPdf 是旗标参数:true 发空值,false 整个参数都不发', async () => {
    const on = mockS2(200, { data: [] })
    await call('search_papers', { query: 'llm', openAccessPdf: true, limit: 5 })
    const onUrl = new URL(sent(on).url)
    // 落到 wire 上是 `openAccessPdf=`(空值)—— 发成 `true` 上游不认,这个过滤条件会静默失效。
    expect(onUrl.searchParams.get('openAccessPdf')).toBe('')
    expect(onUrl.search).toBe('?query=llm&limit=5&openAccessPdf=')

    vi.unstubAllGlobals()
    const off = mockS2(200, { data: [] })
    await call('search_papers', { query: 'llm', openAccessPdf: false })
    expect(new URL(sent(off).url).searchParams.has('openAccessPdf')).toBe(false)
  })

  it('两套分页游标各归各家:search_papers 认 offset,bulk_search_papers 认 token', async () => {
    const relevance = mockS2(200, { data: [] })
    await call('search_papers', { query: 'llm', offset: 20, year: '2020-2024' })
    expect(Object.fromEntries(new URL(sent(relevance).url).searchParams))
      .toEqual({ query: 'llm', offset: '20', year: '2020-2024' })

    vi.unstubAllGlobals()
    const bulk = mockS2(200, { data: [], token: 'next' })
    await call('bulk_search_papers', { query: 'llm', token: 'cursor1' })
    const bulkUrl = new URL(sent(bulk).url)
    expect(bulkUrl.pathname).toBe('/graph/v1/paper/search/bulk')
    expect(Object.fromEntries(bulkUrl.searchParams)).toEqual({ query: 'llm', token: 'cursor1' })
  })

  it('batch 端点:ids 在 body,fields 在 query,出参原样保留 null 占位', async () => {
    const mock = mockS2(200, [{ paperId: 'p1' }, null])
    const res = await call('get_papers', { paperIds: ['p1', 'missing'], fields: 'title' })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    expect(new URL(request.url).pathname).toBe('/graph/v1/paper/batch')
    expect(Object.fromEntries(new URL(request.url).searchParams)).toEqual({ fields: 'title' })
    await expect(request.json()).resolves.toEqual({ ids: ['p1', 'missing'] })
    // null 是"这个 id 没找到"的位置占位,顺序与请求一致,不能被过滤掉。
    await expect(content(res)).resolves.toEqual({ papers: [{ paperId: 'p1' }, null] })
  })

  it('recommend_papers 打 recommendations family,negativePaperIds 没给就整个键不发', async () => {
    const mock = mockS2(200, { recommendedPapers: [] })
    await call('recommend_papers', { positivePaperIds: ['p1'], limit: 10 })
    const url = new URL(sent(mock).url)
    // 末尾斜杠是上游端点要求的。
    expect(url.origin + url.pathname).toBe('https://api.semanticscholar.org/recommendations/v1/papers/')
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '10' })
    await expect(sent(mock).json()).resolves.toEqual({ positivePaperIds: ['p1'] })

    vi.unstubAllGlobals()
    const withNegative = mockS2(200, { recommendedPapers: [] })
    await call('recommend_papers', { positivePaperIds: ['p1'], negativePaperIds: ['p2'] })
    await expect(sent(withNegative).json())
      .resolves.toEqual({ positivePaperIds: ['p1'], negativePaperIds: ['p2'] })
  })

  it('recommend_for_paper 也走 recommendations family', async () => {
    const mock = mockS2(200, { recommendedPapers: [] })
    await call('recommend_for_paper', { paperId: 'p1', limit: 3 })
    expect(new URL(sent(mock).url).origin + new URL(sent(mock).url).pathname)
      .toBe('https://api.semanticscholar.org/recommendations/v1/papers/forpaper/p1')
  })
})

describe('响应整形', () => {
  it('论文列表:recommendations 的 recommendedPapers 与 graph 的 data 落在同一个 papers 键', async () => {
    mockS2(200, { recommendedPapers: [{ paperId: 'p2' }] })
    await expect(content(await call('recommend_for_paper', { paperId: 'p1' }))).resolves.toEqual({
      total: null,
      offset: null,
      next: null,
      token: null,
      papers: [{ paperId: 'p2' }],
      raw: { recommendedPapers: [{ paperId: 'p2' }] },
    })

    vi.unstubAllGlobals()
    mockS2(200, { total: 3, offset: 0, next: 10, token: 'tok', data: [{ paperId: 'p1' }] })
    await expect(content(await call('search_papers', { query: 'x' }))).resolves.toMatchObject({
      total: 3,
      offset: 0,
      next: 10,
      token: 'tok',
      papers: [{ paperId: 'p1' }],
    })
  })

  it('分页数字字段只认整数,别的形态一律 null(不猜、不 parse 字符串)', async () => {
    mockS2(200, { total: '3', offset: 1.5, data: [] })
    await expect(content(await call('search_authors', { query: 'a' }))).resolves.toEqual({
      total: null,
      offset: null,
      next: null,
      authors: [],
      raw: { total: '3', offset: 1.5, data: [] },
    })
  })

  it('引用/参考文献的列表键是 data(装的是边,不是论文本体)', async () => {
    mockS2(200, { total: 1, data: [{ citingPaper: { paperId: 'p9' } }] })
    await expect(content(await call('get_paper_citations', { paperId: 'p1' }))).resolves.toEqual({
      total: 1,
      offset: null,
      next: null,
      data: [{ citingPaper: { paperId: 'p9' } }],
      raw: { total: 1, data: [{ citingPaper: { paperId: 'p9' } }] },
    })
  })

  it('autocomplete 的 matches 与 data 两种键名都认', async () => {
    mockS2(200, { matches: [{ id: 'p1' }] })
    await expect(content(await call('autocomplete_papers', { query: 'llm' })))
      .resolves.toMatchObject({ completions: [{ id: 'p1' }] })

    vi.unstubAllGlobals()
    mockS2(200, { data: [{ id: 'p2' }] })
    await expect(content(await call('autocomplete_papers', { query: 'llm' })))
      .resolves.toMatchObject({ completions: [{ id: 'p2' }] })
  })

  it('列表字段不是数组时退化成空数组,而不是让整个调用失败', async () => {
    mockS2(200, { data: 'oops' })
    await expect(content(await call('get_author_papers', { authorId: 'a1' })))
      .resolves.toMatchObject({ papers: [] })
  })

  it('空响应体读成 null:出参给出全 null 的骨架而不是报错', async () => {
    mockS2(200, null)
    await expect(content(await call('search_snippets', { query: 'x' }))).resolves.toEqual({
      total: null,
      offset: null,
      next: null,
      snippets: [],
      raw: {},
    })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:limit 越界 → 400 且不打上游', async () => {
    const mock = mockS2(200, {})
    const res = await call('search_papers', { query: 'x', limit: 500 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('纯空白的 query 被 schema 的 regex(\\S) 挡下,不打上游', async () => {
    const mock = mockS2(200, {})
    expect((await call('search_papers', { query: '   ' })).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('429 → rate_limited + retryable(限速是这个 provider 的常态,不能标成不可重试)', async () => {
    mockS2(429, { message: 'Too Many Requests. Please wait and try again.' })
    const res = await call('get_paper', { paperId: 'p1' })
    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toEqual({
      code: 'rate_limited',
      retryable: true,
      message: 'Too Many Requests. Please wait and try again.',
    })
  })

  it('401 与 403 各自保留(都是 permission_denied,但状态不同)', async () => {
    mockS2(401, { error: 'Unauthorized' })
    const unauthorized = await call('get_paper', { paperId: 'p1' })
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Unauthorized',
      retryable: false,
    })

    vi.unstubAllGlobals()
    mockS2(403, { detail: 'Forbidden for this endpoint' })
    const forbidden = await call('get_paper', { paperId: 'p1' })
    expect(forbidden.status).toBe(403)
    await expect(forbidden.json())
      .resolves.toMatchObject({ code: 'permission_denied', message: 'Forbidden for this endpoint' })
  })

  it('404 → not_found,5xx → unavailable + retryable', async () => {
    mockS2(404, { error: 'Title match not found' })
    const missing = await call('match_paper_title', { query: 'no such paper' })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found' })

    vi.unstubAllGlobals()
    mockS2(500, 'Internal Server Error')
    await expect((await call('get_paper', { paperId: 'p1' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true, message: 'Internal Server Error' })
  })

  it('非 JSON 的成功响应归 unavailable(上游违约)', async () => {
    const fn = vi.fn(() => Promise.resolve(new Response('<html>maintenance</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })))
    vi.stubGlobal('fetch', fn)
    await expect((await call('get_paper', { paperId: 'p1' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockS2(200, {})
    const res = await call('get_paper', { paperId: 'p1' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
