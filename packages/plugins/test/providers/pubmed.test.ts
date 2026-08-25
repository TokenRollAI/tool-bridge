import { describe, expect, it, vi } from 'vitest'
import { createProviderHarness } from '../support/providerHarness'
import { createPubmedPlugin } from '../../src/pubmed/index'
import { pubmedActions } from '../../src/pubmed/schema'

/**
 * PubMed 迁移产物的 wire 级验收。重点钉住几处"迁移最容易迁丢"的地方:
 * 凭证是 URL 上的 `api_key`(且**可以不给** —— PubMed 支持匿名)、esearch 超长 term 改走 POST、
 * elink 的 `pubmed_pubmed` 要**先剔源 PMID 再截断**、citmatch 的 `success:false` 信封错误、
 * 日期区间的 `-` → `/`、以及 EFetch XML 里数值字符引用的**二次解码**(命名实体不能跟着解)。
 */

const API_KEY = 'ncbi_deadbeef'
const plugin = createPubmedPlugin()

const {
  call,
  envelope,
  sent,
  stubFetch,
} = createProviderHarness({
  mountPath: 'research/pubmed',
  plugin,
  upstreamAuth: API_KEY,
})

interface Route {
  body: string
  status?: number
}

/**
 * 按 pathname 后缀路由 —— 几乎每个 action 都要打两跳(先 esearch/elink/citmatch 拿 PMID,
 * 再 efetch 取正文),用调用顺序去对响应太脆。
 */
function mockNcbi(routes: Record<string, Route>): ReturnType<typeof vi.fn> {
  return stubFetch((request: Request) => {
    const { pathname } = new URL(request.url)
    const key = Object.keys(routes).find(candidate => pathname.endsWith(candidate))
    if (key === undefined) {
      return Promise.resolve(new Response(`unrouted ${pathname}`, { status: 599 }))
    }
    const route = routes[key]!
    return Promise.resolve(new Response(route.body, {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }))
  })
}

/**
 * 一条足够真实的 EFetch 记录。标题里刻意埋了两种编码:
 * `&#x26;#x3B1;`(**双重编码**的 α,解析解一次得 `&#x3B1;`,取值时要再解一次)与
 * `&amp;lt;`(作者真的想写 `&lt;` 这四个字符,**不能**被二次解码吃成 `<`)。
 */
const ARTICLE_XML = `<?xml version="1.0" ?>
<!DOCTYPE PubmedArticleSet PUBLIC "-//NLM//DTD PubMedArticle//EN" "https://dtd.nlm.nih.gov/pubmed.dtd">
<PubmedArticleSet>
<PubmedArticle>
  <MedlineCitation>
    <PMID Version="1">12345</PMID>
    <Article>
      <Journal>
        <ISSN IssnType="Print">0028-0836</ISSN>
        <JournalIssue CitedMedium="Print">
          <Volume>500</Volume>
          <Issue>7461</Issue>
          <PubDate><Year>2013</Year><Month>Aug</Month><Day>7</Day></PubDate>
        </JournalIssue>
        <Title>Nature</Title>
        <ISOAbbreviation>Nature</ISOAbbreviation>
      </Journal>
      <ArticleTitle>A study of &#x26;#x3B1;-synuclein and &amp;lt;tags&amp;gt;.</ArticleTitle>
      <Abstract>
        <AbstractText Label="BACKGROUND" NlmCategory="BACKGROUND">First   part.</AbstractText>
        <AbstractText Label="RESULTS">Second part.</AbstractText>
        <AbstractText Label="EMPTY"></AbstractText>
      </Abstract>
      <AuthorList>
        <Author>
          <LastName>Doe</LastName>
          <ForeName>Jane</ForeName>
          <Identifier Source="ORCID">0000-0002-1825-0097</Identifier>
          <AffiliationInfo><Affiliation>Some Uni</Affiliation></AffiliationInfo>
        </Author>
        <Author><CollectiveName>The Study Group</CollectiveName></Author>
      </AuthorList>
      <Language>eng</Language>
      <PublicationTypeList><PublicationType>Journal Article</PublicationType></PublicationTypeList>
      <ELocationID EIdType="doi">10.1038/nature12345</ELocationID>
    </Article>
    <MeshHeadingList><MeshHeading><DescriptorName>Humans</DescriptorName></MeshHeading></MeshHeadingList>
    <KeywordList Owner="NOTNLM"><Keyword>alpha-synuclein</Keyword></KeywordList>
  </MedlineCitation>
  <PubmedData>
    <ArticleIdList>
      <ArticleId IdType="pubmed">12345</ArticleId>
      <ArticleId IdType="pmc">PMC999</ArticleId>
    </ArticleIdList>
  </PubmedData>
</PubmedArticle>
</PubmedArticleSet>`

/** ARTICLE_XML 整形后应有的样子。 */
const ARTICLE = {
  pmid: '12345',
  title: 'A study of α-synuclein and &lt;tags&gt;.',
  abstract: [
    { label: 'BACKGROUND', text: 'First part.' },
    { label: 'RESULTS', text: 'Second part.' },
  ],
  authors: [
    { name: 'Jane Doe', orcid: '0000-0002-1825-0097', affiliations: ['Some Uni'] },
    { name: 'The Study Group', orcid: null, affiliations: [] },
  ],
  journal: {
    title: 'Nature',
    abbreviation: 'Nature',
    issn: '0028-0836',
    volume: '500',
    issue: '7461',
  },
  publicationDate: '2013-08-07',
  publicationTypes: ['Journal Article'],
  meshTerms: ['Humans'],
  keywords: ['alpha-synuclein'],
  languages: ['eng'],
  doi: '10.1038/nature12345',
  pmcid: 'PMC999',
  pubmedUrl: 'https://pubmed.ncbi.nlm.nih.gov/12345/',
  pmcUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC999/',
}

/** 只带一条 PMID 的 EFetch 响应(不需要整形细节的用例用它)。 */
function articleSet(pmid: string): string {
  return `<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>${pmid}</PMID>`
    + '<Article><ArticleTitle>T</ArticleTitle></Article>'
    + '</MedlineCitation></PubmedArticle></PubmedArticleSet>'
}

describe('契约面', () => {
  it('List 出全部 8 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(pubmedActions).length)
    expect(tools).toHaveLength(8)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'convert_article_ids',
      'find_related_articles',
      'get_article',
      'get_article_references',
      'get_articles',
      'get_citing_articles',
      'match_citation',
      'search_articles',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('凭证在 URL 上(NCBI 的设计)', () => {
  it('api_key 进 query 参数,不进请求头;db / tool 固定', async () => {
    const mock = mockNcbi({
      'esearch.fcgi': { body: JSON.stringify({ esearchresult: { count: '0', idlist: [] } }) },
    })
    await call('search_articles', { query: 'cancer' })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin).toBe('https://eutils.ncbi.nlm.nih.gov')
    expect(url.pathname).toBe('/entrez/eutils/esearch.fcgi')
    expect(url.searchParams.get('api_key')).toBe(API_KEY)
    expect(url.searchParams.get('db')).toBe('pubmed')
    expect(url.searchParams.get('tool')).toBe('tool-bridge')
    expect(url.searchParams.get('retmode')).toBe('json')
    // 换成头会被 NCBI 忽略,故这里必须确认没人"顺手改成 Bearer"。
    expect(request.headers.get('authorization')).toBeNull()
    expect(request.headers.get('api-key')).toBeNull()
  })

  it('没配 authRef 也照常工作(PubMed 支持匿名),且 URL 上不带 api_key', async () => {
    const mock = mockNcbi({
      'esearch.fcgi': { body: JSON.stringify({ esearchresult: { count: '0', idlist: [] } }) },
    })
    const res = await call('search_articles', { query: 'cancer' }, { auth: null })
    expect(res.status).toBe(200)
    expect(mock).toHaveBeenCalledTimes(1)
    expect(new URL(sent(mock).url).searchParams.has('api_key')).toBe(false)
  })

  it('esearch 的 term 超长时改走 POST,整串参数(含 api_key)搬进 form body', async () => {
    const mock = mockNcbi({
      'esearch.fcgi': { body: JSON.stringify({ esearchresult: { count: '0', idlist: [] } }) },
    })
    const longTerm = `${'lymphoma[Title] OR '.repeat(30)}cancer`
    expect(longTerm.length).toBeGreaterThan(500)
    await call('search_articles', { query: longTerm })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('POST')
    expect(url.search).toBe('')
    expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded')
    const form = new URLSearchParams(await request.text())
    expect(form.get('term')).toBe(longTerm)
    expect(form.get('api_key')).toBe(API_KEY)
    expect(form.get('db')).toBe('pubmed')
  })

  it('citmatch 与 idconv 是另外两台主机,不带 api_key', async () => {
    const matcher = mockNcbi({
      'citmatch/': { body: JSON.stringify({ success: true, result: { uids: [] } }) },
    })
    await call('match_citation', { citation: 'Nature 2013;500:7461' })
    const matcherUrl = new URL(sent(matcher).url)
    expect(matcherUrl.origin).toBe('https://pubmed.ncbi.nlm.nih.gov')
    expect(matcherUrl.searchParams.has('api_key')).toBe(false)
    expect(matcherUrl.searchParams.get('method')).toBe('heuristic')
    expect(matcherUrl.searchParams.get('raw-text')).toBe('Nature 2013;500:7461')

    vi.unstubAllGlobals()
    const converter = mockNcbi({ 'idconv/api/v1/articles/': { body: JSON.stringify({ records: [] }) } })
    await call('convert_article_ids', { ids: ['12345'], idType: 'pmid' })
    const converterUrl = new URL(sent(converter).url)
    expect(converterUrl.origin).toBe('https://pmc.ncbi.nlm.nih.gov')
    expect(converterUrl.searchParams.has('api_key')).toBe(false)
    expect(Object.fromEntries(converterUrl.searchParams)).toEqual({
      ids: '12345',
      idtype: 'pmid',
      format: 'json',
      tool: 'tool-bridge',
    })
  })
})

describe('search_articles', () => {
  it('esearch 拿 PMID、efetch 取正文,出参带回 offset / limit', async () => {
    const mock = mockNcbi({
      'esearch.fcgi': {
        body: JSON.stringify({
          esearchresult: { count: '137', idlist: ['12345'], querytranslation: 'cancer[All Fields]' },
        }),
      },
      'efetch.fcgi': { body: ARTICLE_XML },
    })
    const res = await call('search_articles', { query: 'cancer', offset: 5, limit: 1 })

    expect(mock).toHaveBeenCalledTimes(2)
    const search = new URL(sent(mock).url)
    expect(search.searchParams.get('retstart')).toBe('5')
    expect(search.searchParams.get('retmax')).toBe('1')

    const fetchUrl = new URL(sent(mock, 1).url)
    expect(fetchUrl.pathname).toBe('/entrez/eutils/efetch.fcgi')
    expect(fetchUrl.searchParams.get('id')).toBe('12345')
    expect(fetchUrl.searchParams.get('retmode')).toBe('xml')
    expect(sent(mock, 1).headers.get('accept')).toBe('application/xml, text/xml')

    await expect(res.json()).resolves.toEqual({
      content: {
        total: 137,
        offset: 5,
        limit: 1,
        queryTranslation: 'cancer[All Fields]',
        articles: [ARTICLE],
      },
    })
  })

  it('空结果不打 efetch(省一整跳)', async () => {
    const mock = mockNcbi({
      'esearch.fcgi': { body: JSON.stringify({ esearchresult: { count: '0', idlist: [] } }) },
    })
    const res = await call('search_articles', { query: 'nothingmatchesthis' })
    expect(mock).toHaveBeenCalledTimes(1)
    await expect(res.json()).resolves.toMatchObject({
      content: { total: 0, offset: 0, limit: 10, articles: [] },
    })
  })

  it('sort 映射成 NCBI 认的值', async () => {
    const mock = mockNcbi({
      'esearch.fcgi': { body: JSON.stringify({ esearchresult: { count: '0', idlist: [] } }) },
    })
    await call('search_articles', { query: 'x', sort: 'publication_date' })
    expect(new URL(sent(mock).url).searchParams.get('sort')).toBe('pub date')
  })

  it('日期区间的分隔符从 - 换成 /,且只在给了区间时才发 datetype', async () => {
    const ranged = mockNcbi({
      'esearch.fcgi': { body: JSON.stringify({ esearchresult: { count: '0', idlist: [] } }) },
    })
    await call('search_articles', {
      query: 'x',
      publicationDateRange: { from: '2020-01-01', to: '2021-12-31' },
    })
    const params = new URL(sent(ranged).url).searchParams
    expect(params.get('datetype')).toBe('pdat')
    expect(params.get('mindate')).toBe('2020/01/01')
    expect(params.get('maxdate')).toBe('2021/12/31')

    vi.unstubAllGlobals()
    const plain = mockNcbi({
      'esearch.fcgi': { body: JSON.stringify({ esearchresult: { count: '0', idlist: [] } }) },
    })
    await call('search_articles', { query: 'x' })
    expect(new URL(sent(plain).url).searchParams.has('datetype')).toBe(false)
  })
})

describe('elink 系:先剔源 PMID 再截断', () => {
  it('find_related_articles 把源 PMID 从结果里剔掉后才 slice(反之会白占一个名额)', async () => {
    const mock = mockNcbi({
      'elink.fcgi': {
        body: JSON.stringify({
          linksets: [{
            linksetdbs: [{ linkname: 'pubmed_pubmed', links: ['12345', '222', '333'] }],
          }],
        }),
      },
      'efetch.fcgi': { body: articleSet('222') },
    })
    const res = await call('find_related_articles', { pmid: '12345', limit: 1 })

    // 先 slice 再 filter 会得到 [] —— 这条断言就是钉那个顺序的。
    expect(new URL(sent(mock, 1).url).searchParams.get('id')).toBe('222')
    await expect(res.json()).resolves.toMatchObject({
      content: { sourcePmid: '12345', articles: [{ pmid: '222' }] },
    })
  })

  it('get_citing_articles 用 pubmed_pubmed_citedin,且**不**剔源 PMID', async () => {
    const mock = mockNcbi({
      'elink.fcgi': {
        body: JSON.stringify({
          linksets: [{
            linksetdbs: [
              { linkname: 'pubmed_pubmed', links: ['999'] },
              { linkname: 'pubmed_pubmed_citedin', links: ['777', '888'] },
            ],
          }],
        }),
      },
      'efetch.fcgi': { body: articleSet('777') },
    })
    const res = await call('get_citing_articles', { pmid: '12345', limit: 1 })
    expect(new URL(sent(mock).url).searchParams.get('linkname')).toBe('pubmed_pubmed_citedin')
    // 按 linkname 挑对那一族,不是拿 linksetdbs[0]。
    expect(new URL(sent(mock, 1).url).searchParams.get('id')).toBe('777')
    await expect(res.json()).resolves.toMatchObject({ content: { sourcePmid: '12345' } })
  })

  it('get_article_references 用 pubmed_pubmed_refs;没有这一族链接是空结果而不是报错', async () => {
    const mock = mockNcbi({
      'elink.fcgi': { body: JSON.stringify({ linksets: [{ linksetdbs: [] }] }) },
    })
    const res = await call('get_article_references', { pmid: '12345' })
    expect(new URL(sent(mock).url).searchParams.get('linkname')).toBe('pubmed_pubmed_refs')
    expect(mock).toHaveBeenCalledTimes(1)
    await expect(res.json()).resolves.toEqual({
      content: { sourcePmid: '12345', articles: [] },
    })
  })
})

describe('get_article / get_articles', () => {
  it('get_article 查不到时是 found:false,不是报错', async () => {
    mockNcbi({ 'efetch.fcgi': { body: '<PubmedArticleSet></PubmedArticleSet>' } })
    await expect((await call('get_article', { pmid: '404404' })).json())
      .resolves.toEqual({ content: { found: false, article: null } })
  })

  it('get_articles 把要过但没回来的 PMID 列进 notFoundPmids', async () => {
    const mock = mockNcbi({ 'efetch.fcgi': { body: articleSet('12345') } })
    const res = await call('get_articles', { pmids: ['12345', '67890'] })
    expect(new URL(sent(mock).url).searchParams.get('id')).toBe('12345,67890')
    await expect(res.json()).resolves.toMatchObject({
      content: { articles: [{ pmid: '12345' }], notFoundPmids: ['67890'] },
    })
  })
})

describe('EFetch XML 整形', () => {
  it('数值字符引用二次解码,但命名实体不跟着解', async () => {
    mockNcbi({ 'efetch.fcgi': { body: ARTICLE_XML } })
    const res = await call('get_article', { pmid: '12345' })
    const { content } = (await res.json()) as { content: { article: { title: string } } }
    // `&#x26;#x3B1;` 双重编码的 α 要还原……
    expect(content.article.title).toContain('α-synuclein')
    // ……但 `&amp;lt;` 是作者真的想写的四个字符,不能被吃成 `<`。
    expect(content.article.title).toContain('&lt;tags&gt;')
    expect(content.article.title).not.toContain('<tags>')
  })

  it('空白收敛、空的 AbstractText 丢掉、Label 缺席时退回 NlmCategory', async () => {
    mockNcbi({ 'efetch.fcgi': { body: ARTICLE_XML } })
    const res = await call('get_article', { pmid: '12345' })
    await expect(res.json()).resolves.toEqual({ content: { found: true, article: ARTICLE } })
  })

  it('MedlineDate 这种自由文本日期直接用,不硬拼结构化日期', async () => {
    mockNcbi({
      'efetch.fcgi': {
        body: '<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>1</PMID>'
          + '<Article><ArticleTitle>T</ArticleTitle><Journal><JournalIssue>'
          + '<PubDate><MedlineDate>1998 Nov-Dec</MedlineDate></PubDate>'
          + '</JournalIssue></Journal></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>',
      },
    })
    const res = await call('get_article', { pmid: '1' })
    await expect(res.json()).resolves.toMatchObject({
      content: { article: { publicationDate: '1998 Nov-Dec' } },
    })
  })

  it('书籍记录(PubmedBookArticle)也认,标题退回 BookTitle', async () => {
    mockNcbi({
      'efetch.fcgi': {
        body: '<PubmedArticleSet><PubmedBookArticle><BookDocument><PMID>555</PMID>'
          + '<Book><BookTitle>GeneReviews</BookTitle><Volume>2</Volume></Book>'
          + '</BookDocument></PubmedBookArticle></PubmedArticleSet>',
      },
    })
    await expect((await call('get_article', { pmid: '555' })).json()).resolves.toMatchObject({
      content: {
        found: true,
        article: {
          pmid: '555',
          title: 'GeneReviews',
          journal: { title: 'GeneReviews', volume: '2', abbreviation: null, issn: null, issue: null },
          meshTerms: [],
        },
      },
    })
  })

  it('XML 坏了 / 根元素不对 → unavailable(上游的问题,不是调用方的)', async () => {
    mockNcbi({ 'efetch.fcgi': { body: '<PubmedArticleSet><PubmedArticle></MedlineCitation>' } })
    const malformed = await call('get_article', { pmid: '1' })
    expect(malformed.status).toBe(503)
    await expect(malformed.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })

    vi.unstubAllGlobals()
    mockNcbi({ 'efetch.fcgi': { body: '<eFetchResult><ERROR>bad</ERROR></eFetchResult>' } })
    await expect((await call('get_article', { pmid: '1' })).json())
      .resolves.toMatchObject({ code: 'unavailable', message: expect.stringContaining('PubmedArticleSet') })
  })
})

describe('信封式错误与出参整形', () => {
  it('citmatch 的 HTTP 200 + success:false 不能当成功返回', async () => {
    mockNcbi({ 'citmatch/': { body: JSON.stringify({ success: false, result: {} }) } })
    const res = await call('match_citation', { citation: 'garbage' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      message: expect.stringContaining('unsuccessful'),
    })
  })

  it('citmatch 命中后回查正文,matched 反映有没有命中', async () => {
    mockNcbi({
      'citmatch/': { body: JSON.stringify({ success: true, result: { uids: [{ pubmed: '12345' }] } }) },
      'efetch.fcgi': { body: articleSet('12345') },
    })
    await expect((await call('match_citation', { citation: 'Nature 2013' })).json())
      .resolves.toMatchObject({ content: { matched: true, articles: [{ pmid: '12345' }] } })

    vi.unstubAllGlobals()
    mockNcbi({ 'citmatch/': { body: JSON.stringify({ success: true, result: { uids: [] } }) } })
    await expect((await call('match_citation', { citation: 'nope' })).json())
      .resolves.toMatchObject({ content: { matched: false, articles: [] } })
  })

  it('idconv 的 pmid 有时以数字回来,统一成字符串;errmsg 是逐条结果不是整体失败', async () => {
    mockNcbi({
      'idconv/api/v1/articles/': {
        body: JSON.stringify({
          records: [
            { 'requested-id': '12345', 'pmid': 12345, 'pmcid': 'PMC999', 'doi': '10.1/x' },
            { 'requested-id': 'bogus', 'errmsg': 'invalid article id' },
          ],
        }),
      },
    })
    const res = await call('convert_article_ids', { ids: ['12345', 'bogus'], idType: 'pmid' })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      content: {
        records: [
          { requestedId: '12345', pmid: '12345', pmcid: 'PMC999', doi: '10.1/x', mid: null, error: null },
          { requestedId: 'bogus', pmid: null, pmcid: null, doi: null, mid: null, error: 'invalid article id' },
        ],
      },
    })
  })

  it('esearch 的 count 不是数字串就说明响应坏了 → unavailable', async () => {
    mockNcbi({ 'esearch.fcgi': { body: JSON.stringify({ esearchresult: { count: 'many', idlist: [] } }) } })
    await expect((await call('search_articles', { query: 'x' })).json())
      .resolves.toMatchObject({ code: 'unavailable', message: expect.stringContaining('malformed') })
  })
})

describe('入参校验(schema 没标 required,断言在 api.ts 里)', () => {
  it('pmid 非纯数字 → invalid_argument 且不打上游(schema 的 regex 先拦下)', async () => {
    const mock = mockNcbi({ 'efetch.fcgi': { body: ARTICLE_XML } })
    const res = await call('get_article', { pmid: 'PMC999' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: expect.stringContaining('^[0-9]+$'),
    })
    expect(mock).not.toHaveBeenCalled()
  })

  /**
   * `readPmid` 的数字断言在**入参**侧确实被 schema 的 regex 抢先了,但它另有一处不可替代的
   * 用途:citmatch 回来的 `uids[].pubmed` 是**响应**里的 PMID,不过 inputSchema。
   * 那个值会被直接拼进 efetch 的 `id`,不校验就等于让上游决定我们去请求什么。
   */
  it('citmatch 回的 uid 不是纯数字时不拿去拼 efetch 的 id', async () => {
    const mock = mockNcbi({
      'citmatch/': {
        body: JSON.stringify({ success: true, result: { uids: [{ pubmed: '12345,evil' }] } }),
      },
      'efetch.fcgi': { body: ARTICLE_XML },
    })
    const res = await call('match_citation', { citation: 'Nature 2013' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ message: expect.stringContaining('digits') })
    // 只打了 citmatch 那一跳,没带着被污染的 id 去打 efetch。
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('get_article 不给 pmid → invalid_argument(schema 里它是 optional)', async () => {
    const mock = mockNcbi({ 'efetch.fcgi': { body: ARTICLE_XML } })
    expect((await call('get_article', {})).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('offset + limit 超过 10000 的检索窗口 → invalid_argument', async () => {
    const mock = mockNcbi({ 'esearch.fcgi': { body: '{}' } })
    const res = await call('search_articles', { query: 'x', offset: 9999, limit: 50 })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ message: expect.stringContaining('10000') })
    expect(mock).not.toHaveBeenCalled()
  })

  it('publicationDateRange 要求 from 与 to 都给,且 from 不得晚于 to', async () => {
    const mock = mockNcbi({ 'esearch.fcgi': { body: '{}' } })
    expect((await call('search_articles', { query: 'x', publicationDateRange: { from: '2020-01-01' } })).status)
      .toBe(400)

    const reversed = await call('search_articles', {
      query: 'x',
      publicationDateRange: { from: '2021-01-01', to: '2020-01-01' },
    })
    expect(reversed.status).toBe(400)
    await expect(reversed.json()).resolves.toMatchObject({ message: expect.stringContaining('must not be after') })
    expect(mock).not.toHaveBeenCalled()
  })

  it('convert_article_ids 的 idType 与 ids 都是必填(schema 里都是 optional)', async () => {
    const mock = mockNcbi({ 'idconv/api/v1/articles/': { body: '{}' } })
    expect((await call('convert_article_ids', { ids: ['1'] })).status).toBe(400)
    expect((await call('convert_article_ids', { idType: 'pmid' })).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('sort 不在支持列表里由 Zod 的 enum 拦下', async () => {
    const mock = mockNcbi({ 'esearch.fcgi': { body: '{}' } })
    expect((await call('search_articles', { query: 'x', sort: 'citations' })).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('上游错误归一', () => {
  it('4xx → invalid_argument,消息取自 NCBI 的 error 字段', async () => {
    mockNcbi({
      'esearch.fcgi': { body: JSON.stringify({ error: 'Invalid db name' }), status: 400 },
    })
    const res = await call('search_articles', { query: 'x' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'Invalid db name',
    })
  })

  it('errors 数组拼成一条消息', async () => {
    mockNcbi({
      'esearch.fcgi': { body: JSON.stringify({ errors: ['bad term', 'bad date'] }), status: 400 },
    })
    await expect((await call('search_articles', { query: 'x' })).json())
      .resolves.toMatchObject({ message: 'bad term; bad date' })
  })

  it('429 → rate_limited + retryable(不在插件里 sleep,退避交给调用方)', async () => {
    mockNcbi({ 'esearch.fcgi': { body: 'API rate limit exceeded', status: 429 } })
    const res = await call('search_articles', { query: 'x' })
    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('5xx → unavailable + retryable', async () => {
    mockNcbi({ 'esearch.fcgi': { body: 'NCBI is down', status: 503 } })
    const res = await call('search_articles', { query: 'x' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('JSON 解不开 → unavailable', async () => {
    mockNcbi({ 'esearch.fcgi': { body: 'not json' } })
    await expect((await call('search_articles', { query: 'x' })).json())
      .resolves.toMatchObject({ code: 'unavailable', message: expect.stringContaining('malformed JSON') })
  })

  it('响应超过限长上限 → invalid_argument(重试还是同样大,能修的是把 limit 调小)', async () => {
    mockNcbi({ 'esearch.fcgi': { body: 'x'.repeat(1024 * 1024 + 64) } })
    const res = await call('search_articles', { query: 'x' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: expect.stringContaining('上限'),
    })
  })
})
