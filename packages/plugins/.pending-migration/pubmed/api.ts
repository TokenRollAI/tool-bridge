/**
 * PubMed(NCBI E-utilities / Citation Matcher / PMC ID Converter)的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/pubmed/runtime.ts` 与 `runtime-xml.ts`,语义等价、
 * 写法本地化:凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * ## 凭证在 URL(部署侧需知)
 *
 * NCBI 的 API key 是 **`api_key` query 参数**,不是请求头 —— 这是 E-utilities 本身的设计,
 * 换成头会被忽略。故出站 URL 里带明文凭证,**访问日志与出站抓包都要脱敏 `api_key`**。
 * (`esearch` 走 POST 的那条路上它落在 form body 里,见下。)
 * 另外 PubMed 支持 **匿名调用**(上游 authTypes 含 `no_auth`):没配 authRef 一样能用,
 * 只是 NCBI 的限速从 10 rps 降到 3 rps。故这里**不用** `requireApiKey`。
 *
 * ## 三个上游细节决定了这里的形状
 *
 * - **超长 query 要改走 POST**:`esearch` 的 term 超过 500 字符时 NCBI 会拒绝过长的 URL,
 *   上游把整串 query 参数搬进 form body。副作用是 `api_key` 那时不在 URL 上。
 * - **响应要限长读**:efetch 的 XML 一次能上百 MB;先 `arrayBuffer()` 再判大小等于把上限
 *   交给对端决定。故边读边计数,超限立刻断流。
 * - **EFetch 只回 XML**:E-utilities 的 `retmode=json` 对 efetch 无效,文献正文只有 XML 一种
 *   形态,故这里带一个**只服务 PubMed 文献集**的 XML 读取器(见文件下半部分)。
 *
 * ## 与上游的有意偏离
 *
 * - **不迁进程级限速闸门**(`PubmedRequestGate` / `PubmedRequestGatePool`)。上游那套东西在
 *   插件里是错的层:①本仓库所有迁移产物都不在插件内 sleep,可重试性由 `TBError` 的
 *   `retryable` 表达、由调用方决定退避;②它是**进程级共享队列**,一个租户的突发会拖慢
 *   其他租户;③按凭证分桶要把凭证派生的 key 留在长生命周期的 Map 里。取而代之:429 归一成
 *   `rate_limited` + retryable,5xx 归 `unavailable` + retryable,退避交给上层。
 *   **代价要说清**:高并发下打到 NCBI 限速的概率比上游高,部署侧若要硬性配额需在网关层做。
 * - 同理不迁上游的 3 次重试循环(它依赖上面那个 sleep)。
 * - 响应超长上游报 502;这里归 `invalid_argument` —— 同一个请求重试还是同样大,能修的是
 *   调用方把 `limit` / `pmids` 调小,标成可重试只会让 agent 空转。
 * - `tool` 参数上游报 `openconnector`(NCBI 要求标识调用方应用)。这里报 `tool-bridge`,
 *   否则流量被记在别人账上。同理不发 `user-agent`。
 * - 上游把 400/404/422 之外的非 2xx 压成 502;这里把原始状态原样交给 `upstreamError`。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  convertArticleIdsInput,
  findRelatedArticlesInput,
  getArticleInput,
  getArticleReferencesInput,
  getArticlesInput,
  getCitingArticlesInput,
  matchCitationInput,
  searchArticlesInput,
} from './schema'
import { guardedFetch } from '../_runtime/guardedFetch'
import type { ProviderContext } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/'
const CITATION_MATCHER_URL = 'https://pubmed.ncbi.nlm.nih.gov/api/citmatch/'
const ID_CONVERTER_URL = 'https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/'
/** NCBI 要求每个调用方标识自己的应用。 */
const TOOL_NAME = 'tool-bridge'
const REQUEST_TIMEOUT_MS = 30_000
const MAX_JSON_RESPONSE_BYTES = 1024 * 1024
const MAX_XML_RESPONSE_BYTES = 10 * 1024 * 1024
/** `esearch` 的 term 超过这个长度就改走 POST(再长 NCBI 会拒绝整个 URL)。 */
const ESEARCH_POST_TERM_LENGTH = 500
/** PubMed 的检索窗口上限:offset + limit 超过它,NCBI 直接报错。 */
const MAX_SEARCH_WINDOW = 10_000

/** 入参里的 sort 值 → NCBI 认的 sort 值。 */
const SORT_VALUES: Record<string, string> = {
  first_author: 'Author',
  journal: 'JournalName',
  publication_date: 'pub date',
  relevance: 'relevance',
}

type Json = Record<string, unknown>

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 上游 `optionalString` 的等价物:非字符串、或去空白后为空,都算缺失。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 参数非法(含"schema 没标 required 但这里必须有"的那些字段)。 */
function invalidInput(message: string): TBError {
  return new TBError('invalid_argument', message)
}

/** 上游回的形状不符合契约 —— 是上游的问题,不是调用方的错。 */
function invalidResponse(message: string): TBError {
  return new TBError('unavailable', message, { retryable: true })
}

function requireRecord(value: unknown, label: string): Json {
  const result = record(value)
  if (result === undefined) throw invalidResponse(`${label} 不是对象`)
  return result
}

function requireObjectArray(value: unknown, label: string): Json[] {
  if (!Array.isArray(value)) throw invalidResponse(`${label} 不是数组`)
  return value.map((item, index) => requireRecord(item, `${label}[${index}]`))
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw invalidResponse(`${label} 不是字符串数组`)
  }
  return value as string[]
}

// ---------------------------------------------------------------------------
// 入参断言(上游 34.3% 的 action 没在 schema 里标 required,断言留在这层)
// ---------------------------------------------------------------------------

/** 纯空白能过 Zod 的 `min(1)`,但对 NCBI 等于没给。 */
function requireInputText(value: unknown, field: string): string {
  const result = text(value)
  if (result === undefined) throw invalidInput(`${field} is required.`)
  return result
}

function readPmid(value: unknown, field: string): string {
  const pmid = requireInputText(value, field)
  if (!/^\d+$/u.test(pmid)) throw invalidInput(`${field} must contain only digits`)
  return pmid
}

function readPmidArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    throw invalidInput('pmids must contain between 1 and 50 PubMed IDs')
  }
  return value.map((pmid, index) => readPmid(pmid, `pmids[${index}]`))
}

/** `limit` 在 schema 里带 `.default(10)`,但 `.optional()` 让 default 不生效,故这里兜底。 */
function readLimit(value: unknown): number {
  const limit = typeof value === 'number' && Number.isInteger(value) ? value : 10
  if (limit < 1 || limit > 50) throw invalidInput('limit must be between 1 and 50')
  return limit
}

function readArticleIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) {
    throw invalidInput('ids must contain between 1 and 200 article identifiers')
  }
  return value.map((id, index) => requireInputText(id, `ids[${index}]`))
}

function readIdType(value: unknown): string {
  const idType = requireInputText(value, 'idType')
  if (idType === 'doi' || idType === 'mid' || idType === 'pmcid' || idType === 'pmid') return idType
  throw invalidInput('idType must be doi, mid, pmcid, or pmid')
}

function readSort(value: unknown): string | undefined {
  const sort = text(value)
  if (sort === undefined) return undefined
  const mapped = SORT_VALUES[sort]
  if (mapped === undefined) throw invalidInput('sort is not supported by PubMed')
  return mapped
}

/**
 * 日期区间上游要求 from 与 to **都给**(schema 里两个都是 optional),且 from 不得晚于 to。
 * NCBI 的日期分隔符是 `/` 不是 `-`。
 */
function readPublicationDateRange(value: unknown): { from: string, to: string } | undefined {
  const range = record(value)
  if (range === undefined) return undefined
  const from = requireInputText(range.from, 'publicationDateRange.from')
  const to = requireInputText(range.to, 'publicationDateRange.to')
  if (from > to) {
    throw invalidInput('publicationDateRange.from must not be after publicationDateRange.to')
  }
  return { from, to }
}

function ncbiDate(value: string | undefined): string | undefined {
  return value?.replaceAll('-', '/')
}

// ---------------------------------------------------------------------------
// 出站
// ---------------------------------------------------------------------------

/**
 * 边读边计数,超限立刻断流 —— 先 `arrayBuffer()` 再判大小等于把上限交给对端决定,
 * 一个几百 MB 的 efetch 响应就能把内存吃干。
 */
async function readBoundedText(response: Response, maxBytes: number, source: string): Promise<string> {
  const tooLarge = (): TBError => invalidInput(
    `${source} 响应超过 ${maxBytes} 字节上限:把 limit / pmids / ids 调小后重试`,
  )

  const declared = Number(response.headers.get('content-length'))
  if (Number.isSafeInteger(declared) && declared > maxBytes) throw tooLarge()

  if (response.body === null) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) throw tooLarge()
    return new TextDecoder().decode(bytes)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw tooLarge()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

/** NCBI 的错误体有 `{error}` 与 `{errors:[]}` 两种;都取不到就把原文截断当消息。 */
function extractError(body: string): string | undefined {
  const trimmed = body.trim()
  if (trimmed === '') return undefined
  try {
    const payload = record(JSON.parse(trimmed))
    const direct = text(payload?.error)
    if (direct !== undefined) return direct
    const errors = payload?.errors
    if (Array.isArray(errors)) {
      return errors.filter((item): item is string => typeof item === 'string').join('; ') || undefined
    }
  } catch {
    return trimmed.slice(0, 500)
  }
  return trimmed.slice(0, 500)
}

interface NcbiRequest {
  accept: string
  body?: URLSearchParams
  maxBytes: number
  source: string
  url: URL
}

async function requestText(input: NcbiRequest): Promise<string> {
  const headers: Record<string, string> = { accept: input.accept }
  if (input.body !== undefined) headers['content-type'] = 'application/x-www-form-urlencoded'

  let response: Response
  try {
    response = await guardedFetch(input.url.toString(), {
      method: input.body === undefined ? 'GET' : 'POST',
      headers,
      body: input.body,
      // 不设超时会让一个挂死的 NCBI 端点拖住整个调用;上游同样给了 30s 的独立预算。
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障。
    if (error instanceof TBError) throw error
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw upstreamError(504, `${input.source} request timed out`)
    }
    const message = error instanceof Error ? error.message : 'unknown network error'
    throw upstreamError(502, `${input.source} request failed: ${message}`)
  }

  const body = await readBoundedText(response, input.maxBytes, input.source)
  if (!response.ok) {
    throw upstreamError(
      response.status,
      extractError(body) ?? `${input.source} request failed with HTTP ${response.status}`,
    )
  }
  return body
}

function parseJson(body: string, source: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    throw invalidResponse(`${source} returned malformed JSON`)
  }
}

/**
 * 打一次 E-utility。`db` / `tool` 固定,`api_key` 有就带 —— 它是 **query 参数**,不是头。
 * `esearch` 的 term 超长时整串参数搬进 form body(顺带把 api_key 从 URL 上挪走)。
 */
async function eutils(
  ctx: ProviderContext,
  utility: string,
  query: Record<string, string | undefined>,
  options: { accept: string, maxBytes: number },
): Promise<string> {
  const url = new URL(utility, EUTILS_BASE)
  url.searchParams.set('db', 'pubmed')
  url.searchParams.set('tool', TOOL_NAME)
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(name, value)
  }
  // PubMed 允许匿名调用,故凭证缺席是合法状态,不走 requireApiKey。
  const apiKey = text(ctx.upstreamAuth)
  if (apiKey !== undefined) url.searchParams.set('api_key', apiKey)

  const usePost = utility === 'esearch.fcgi' && (query.term?.length ?? 0) > ESEARCH_POST_TERM_LENGTH
  let body: URLSearchParams | undefined
  if (usePost) {
    body = new URLSearchParams(url.searchParams)
    url.search = ''
  }

  return requestText({ url, body, source: 'PubMed', accept: options.accept, maxBytes: options.maxBytes })
}

async function eutilsJson(
  ctx: ProviderContext,
  utility: string,
  query: Record<string, string | undefined>,
): Promise<Json> {
  const body = await eutils(ctx, utility, { ...query, retmode: 'json' }, {
    accept: 'application/json',
    maxBytes: MAX_JSON_RESPONSE_BYTES,
  })
  return requireRecord(parseJson(body, `PubMed ${utility}`), `PubMed ${utility} 响应`)
}

/** citmatch 与 idconv 是另外两台主机上的接口,不吃 `api_key`,也没有 `db`/`tool` 约定。 */
async function ncbiJson(url: URL, source: string): Promise<Json> {
  const body = await requestText({
    url,
    source,
    accept: 'application/json',
    maxBytes: MAX_JSON_RESPONSE_BYTES,
  })
  return requireRecord(parseJson(body, source), `${source} 响应`)
}

// ---------------------------------------------------------------------------
// 只服务 PubMed 文献集的 XML 读取器
//
// 上游用 `fast-xml-parser` + `fast-xml-validator`。这里手写一份:本仓库的插件不引额外
// 运行时依赖(要能在 Workers 里跑),而 EFetch 的 XML 只需要"元素树 + 属性 + 展平文本"
// 这一点点能力 —— 上游那些整形函数最终也只是把文本 collect 起来收空白。
// ---------------------------------------------------------------------------

interface XmlElement {
  attributes: Record<string, string>
  children: XmlNode[]
  name: string
}

/** 字符串就是文本节点。 */
type XmlNode = string | XmlElement

interface Cursor {
  index: number
  source: string
}

function malformedXml(): TBError {
  return invalidResponse('PubMed returned malformed article XML')
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: '\'',
  gt: '>',
  lt: '<',
  quot: '"',
}

function decodeEntities(value: string): string {
  return value.replace(/&(?:#(?:x([\da-f]+)|(\d+))|([a-z]+));/giu, (reference, hex, decimal, name) => {
    if (typeof name === 'string') return NAMED_ENTITIES[name.toLowerCase()] ?? reference
    const codePoint = Number.parseInt((hex ?? decimal) as string, hex === undefined ? 10 : 16)
    return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10FFFF
      ? String.fromCodePoint(codePoint)
      : reference
  })
}

function isNameChar(char: string): boolean {
  return !/[\s/>=]/u.test(char)
}

function skipWhitespace(cursor: Cursor): void {
  while (cursor.index < cursor.source.length && /\s/u.test(cursor.source[cursor.index]!)) cursor.index += 1
}

/** 跳过声明、注释、DOCTYPE(含内部子集)与空白 —— 它们对取值没有贡献。 */
function skipProlog(cursor: Cursor): void {
  for (;;) {
    skipWhitespace(cursor)
    const rest = cursor.source.slice(cursor.index)
    if (rest.startsWith('<?')) {
      const end = cursor.source.indexOf('?>', cursor.index)
      if (end < 0) throw malformedXml()
      cursor.index = end + 2
      continue
    }
    if (rest.startsWith('<!--')) {
      const end = cursor.source.indexOf('-->', cursor.index)
      if (end < 0) throw malformedXml()
      cursor.index = end + 3
      continue
    }
    if (rest.startsWith('<!')) {
      // DOCTYPE 的内部子集用 `[...]` 包住,里面可以有 `>`,不能只找第一个 `>`。
      let depth = 0
      let index = cursor.index + 2
      for (; index < cursor.source.length; index += 1) {
        const char = cursor.source[index]
        if (char === '[') depth += 1
        else if (char === ']') depth -= 1
        else if (char === '>' && depth <= 0) break
      }
      if (index >= cursor.source.length) throw malformedXml()
      cursor.index = index + 1
      continue
    }
    return
  }
}

function readName(cursor: Cursor): string {
  const start = cursor.index
  while (cursor.index < cursor.source.length && isNameChar(cursor.source[cursor.index]!)) cursor.index += 1
  const name = cursor.source.slice(start, cursor.index)
  if (name === '') throw malformedXml()
  return name
}

function readAttributes(cursor: Cursor): { attributes: Record<string, string>, selfClosing: boolean } {
  const attributes: Record<string, string> = {}
  for (;;) {
    skipWhitespace(cursor)
    const rest = cursor.source.slice(cursor.index)
    if (rest.startsWith('/>')) {
      cursor.index += 2
      return { attributes, selfClosing: true }
    }
    if (rest.startsWith('>')) {
      cursor.index += 1
      return { attributes, selfClosing: false }
    }
    if (cursor.index >= cursor.source.length) throw malformedXml()

    const name = readName(cursor)
    skipWhitespace(cursor)
    if (cursor.source[cursor.index] !== '=') throw malformedXml()
    cursor.index += 1
    skipWhitespace(cursor)
    const quote = cursor.source[cursor.index]
    if (quote !== '"' && quote !== '\'') throw malformedXml()
    cursor.index += 1
    const end = cursor.source.indexOf(quote, cursor.index)
    if (end < 0) throw malformedXml()
    attributes[name] = decodeEntities(cursor.source.slice(cursor.index, end))
    cursor.index = end + 1
  }
}

function parseElement(cursor: Cursor): XmlElement {
  if (cursor.source[cursor.index] !== '<') throw malformedXml()
  cursor.index += 1
  const name = readName(cursor)
  const { attributes, selfClosing } = readAttributes(cursor)
  const element: XmlElement = { name, attributes, children: [] }
  if (selfClosing) return element

  for (;;) {
    if (cursor.index >= cursor.source.length) throw malformedXml()
    const rest = cursor.source.slice(cursor.index)
    if (rest.startsWith('</')) {
      cursor.index += 2
      const closing = readName(cursor)
      skipWhitespace(cursor)
      if (closing !== name || cursor.source[cursor.index] !== '>') throw malformedXml()
      cursor.index += 1
      return element
    }
    if (rest.startsWith('<![CDATA[')) {
      const end = cursor.source.indexOf(']]>', cursor.index)
      if (end < 0) throw malformedXml()
      element.children.push(cursor.source.slice(cursor.index + 9, end))
      cursor.index = end + 3
      continue
    }
    if (rest.startsWith('<!--')) {
      const end = cursor.source.indexOf('-->', cursor.index)
      if (end < 0) throw malformedXml()
      cursor.index = end + 3
      continue
    }
    if (rest.startsWith('<?')) {
      const end = cursor.source.indexOf('?>', cursor.index)
      if (end < 0) throw malformedXml()
      cursor.index = end + 2
      continue
    }
    if (rest.startsWith('<')) {
      element.children.push(parseElement(cursor))
      continue
    }
    const next = cursor.source.indexOf('<', cursor.index)
    const end = next < 0 ? cursor.source.length : next
    element.children.push(decodeEntities(cursor.source.slice(cursor.index, end)))
    cursor.index = end
  }
}

function parseXml(source: string): XmlElement {
  const cursor: Cursor = { source, index: 0 }
  skipProlog(cursor)
  const root = parseElement(cursor)
  return root
}

function elements(parent: XmlElement | undefined, name: string): XmlElement[] {
  if (parent === undefined) return []
  return parent.children.filter(
    (child): child is XmlElement => typeof child !== 'string' && child.name === name,
  )
}

function firstElement(parent: XmlElement | undefined, name: string): XmlElement | undefined {
  return elements(parent, name)[0]
}

function attribute(element: XmlElement, name: string): string | undefined {
  return text(element.attributes[name])
}

/** 展平所有后代文本、收掉空白。数值字符引用再解一次:PubMed 数据里存在双重编码。 */
function textOf(element: XmlElement | undefined): string {
  if (element === undefined) return ''
  const collect = (node: XmlNode): string =>
    typeof node === 'string' ? node : node.children.map(collect).join('')
  const raw = element.children.map(collect).join('')
  return decodeEntities(raw).replace(/\s+/gu, ' ').trim()
}

function childText(parent: XmlElement | undefined, name: string): string | undefined {
  const value = textOf(firstElement(parent, name))
  return value === '' ? undefined : value
}

function childTexts(parent: XmlElement | undefined, name: string): string[] {
  return elements(parent, name).map(child => textOf(child)).filter(value => value !== '')
}

function requireChild(parent: XmlElement, name: string, source: string): XmlElement {
  const child = firstElement(parent, name)
  if (child === undefined) throw invalidResponse(`${source} is missing ${name}`)
  return child
}

function requireChildText(parent: XmlElement, name: string, source: string): string {
  const value = childText(parent, name)
  if (value === undefined) throw invalidResponse(`${source} is missing ${name}`)
  return value
}

// ---------------------------------------------------------------------------
// XML → 归一后的文献记录
// ---------------------------------------------------------------------------

interface Article {
  abstract: Array<{ label: string | null, text: string }>
  authors: Array<{ affiliations: string[], name: string, orcid: string | null }>
  doi: string | null
  journal: {
    abbreviation: string | null
    issn: string | null
    issue: string | null
    title: string | null
    volume: string | null
  }
  keywords: string[]
  languages: string[]
  meshTerms: string[]
  pmcUrl: string | null
  pmcid: string | null
  pmid: string
  publicationDate: string | null
  publicationTypes: string[]
  pubmedUrl: string
  title: string
}

const MONTH_NUMBERS: Record<string, string> = {
  apr: '04',
  aug: '08',
  dec: '12',
  feb: '02',
  jan: '01',
  jul: '07',
  jun: '06',
  mar: '03',
  may: '05',
  nov: '11',
  oct: '10',
  sep: '09',
}

function normalizeMonth(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (/^\d{1,2}$/u.test(value)) return value.padStart(2, '0')
  return MONTH_NUMBERS[value.slice(0, 3).toLowerCase()]
}

function normalizeDay(value: string | undefined): string | undefined {
  return value !== undefined && /^\d{1,2}$/u.test(value) ? value.padStart(2, '0') : undefined
}

/** MedlineDate 是自由文本(如 "1998 Nov-Dec"),有它就直接用,拼不出结构化日期。 */
function readDate(pubDate: XmlElement | undefined): string | null {
  if (pubDate === undefined) return null
  const medlineDate = childText(pubDate, 'MedlineDate')
  if (medlineDate !== undefined) return medlineDate

  const year = childText(pubDate, 'Year')
  if (year === undefined) return null
  const season = childText(pubDate, 'Season')
  if (season !== undefined) return `${year} ${season}`
  const month = normalizeMonth(childText(pubDate, 'Month'))
  const day = normalizeDay(childText(pubDate, 'Day'))
  return [year, month, day].filter(value => value !== undefined).join('-')
}

function readAbstract(parent: XmlElement): Array<{ label: string | null, text: string }> {
  return elements(firstElement(parent, 'Abstract'), 'AbstractText')
    .map(section => ({
      label: attribute(section, 'Label') ?? attribute(section, 'NlmCategory') ?? null,
      text: textOf(section),
    }))
    .filter(section => section.text.length > 0)
}

function readAuthors(parent: XmlElement): Array<{ affiliations: string[], name: string, orcid: string | null }> {
  return elements(firstElement(parent, 'AuthorList'), 'Author').flatMap((author) => {
    const collectiveName = childText(author, 'CollectiveName')
    const familyName = childText(author, 'LastName')
    // Initials 是 ForeName 缺席时的退路(老记录只有缩写)。
    const givenName = childText(author, 'ForeName') ?? childText(author, 'Initials')
    const name = collectiveName ?? [givenName, familyName].filter(Boolean).join(' ')
    if (name === '') return []

    const orcid = elements(author, 'Identifier')
      .find(identifier => attribute(identifier, 'Source')?.toLowerCase() === 'orcid')
    return [{
      name,
      orcid: orcid === undefined ? null : textOf(orcid) || null,
      affiliations: elements(author, 'AffiliationInfo')
        .map(info => childText(info, 'Affiliation'))
        .filter((value): value is string => value !== undefined),
    }]
  })
}

function readJournal(journal: XmlElement | undefined): Article['journal'] {
  const issue = firstElement(journal, 'JournalIssue')
  return {
    title: childText(journal, 'Title') ?? null,
    abbreviation: childText(journal, 'ISOAbbreviation') ?? null,
    issn: childText(journal, 'ISSN') ?? null,
    volume: childText(issue, 'Volume') ?? null,
    issue: childText(issue, 'Issue') ?? null,
  }
}

function addIdentifiers(identifiers: Map<string, string>, list: XmlElement | undefined): void {
  for (const identifier of elements(list, 'ArticleId')) {
    const type = attribute(identifier, 'IdType')?.toLowerCase()
    const value = textOf(identifier)
    if (type !== undefined && value !== '') identifiers.set(type, value)
  }
}

/** DOI 不在 ArticleIdList 里时,还可能挂在 `ELocationID[EIdType=doi]` 上。 */
function readElectronicDoi(parent: XmlElement): string | null {
  const location = elements(parent, 'ELocationID')
    .find(identifier => attribute(identifier, 'EIdType')?.toLowerCase() === 'doi')
  return location === undefined ? null : textOf(location) || null
}

function articleUrls(pmid: string, pmcid: string | null): { pmcUrl: string | null, pubmedUrl: string } {
  return {
    pubmedUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    pmcUrl: pmcid === null ? null : `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`,
  }
}

function parseArticle(pubmedArticle: XmlElement): Article {
  const citation = requireChild(pubmedArticle, 'MedlineCitation', 'PubMed article')
  const article = requireChild(citation, 'Article', 'PubMed citation')
  const pmid = requireChildText(citation, 'PMID', 'PubMed citation')
  const journal = firstElement(article, 'Journal')

  const identifiers = new Map<string, string>()
  addIdentifiers(identifiers, firstElement(firstElement(pubmedArticle, 'PubmedData'), 'ArticleIdList'))
  const pmcid = identifiers.get('pmc') ?? null

  return {
    pmid,
    title: childText(article, 'ArticleTitle') ?? '',
    abstract: readAbstract(article),
    authors: readAuthors(article),
    journal: readJournal(journal),
    publicationDate: readDate(firstElement(firstElement(journal, 'JournalIssue'), 'PubDate')),
    publicationTypes: childTexts(firstElement(article, 'PublicationTypeList'), 'PublicationType'),
    meshTerms: elements(firstElement(citation, 'MeshHeadingList'), 'MeshHeading')
      .map(heading => childText(heading, 'DescriptorName'))
      .filter((value): value is string => value !== undefined),
    keywords: elements(citation, 'KeywordList').flatMap(list => childTexts(list, 'Keyword')),
    languages: childTexts(article, 'Language'),
    doi: identifiers.get('doi') ?? readElectronicDoi(article),
    pmcid,
    ...articleUrls(pmid, pmcid),
  }
}

/** 书籍/章节记录(NCBI Bookshelf)与期刊文章共用一个出参形状,字段来源不同。 */
function parseBookArticle(pubmedBookArticle: XmlElement): Article {
  const document = requireChild(pubmedBookArticle, 'BookDocument', 'PubMed book article')
  const book = requireChild(document, 'Book', 'PubMed book document')
  const pmid = requireChildText(document, 'PMID', 'PubMed book document')

  const identifiers = new Map<string, string>()
  addIdentifiers(identifiers, firstElement(document, 'ArticleIdList'))
  addIdentifiers(identifiers, firstElement(firstElement(pubmedBookArticle, 'PubmedBookData'), 'ArticleIdList'))
  const pmcid = identifiers.get('pmc') ?? null

  return {
    pmid,
    title: childText(document, 'ArticleTitle') ?? childText(book, 'BookTitle') ?? '',
    abstract: readAbstract(document),
    authors: readAuthors(document),
    journal: {
      title: childText(book, 'BookTitle') ?? null,
      abbreviation: null,
      issn: null,
      volume: childText(book, 'Volume') ?? null,
      issue: null,
    },
    publicationDate: readDate(firstElement(book, 'PubDate')),
    publicationTypes: childTexts(document, 'PublicationType'),
    meshTerms: [],
    keywords: elements(document, 'KeywordList').flatMap(list => childTexts(list, 'Keyword')),
    languages: childTexts(document, 'Language'),
    doi: identifiers.get('doi') ?? readElectronicDoi(book),
    pmcid,
    ...articleUrls(pmid, pmcid),
  }
}

function parseArticleSet(xml: string): Article[] {
  const root = parseXml(xml)
  if (root.name !== 'PubmedArticleSet') {
    throw invalidResponse('PubMed returned an article response without PubmedArticleSet')
  }
  return root.children.flatMap((node) => {
    if (typeof node === 'string') return []
    if (node.name === 'PubmedArticle') return [parseArticle(node)]
    if (node.name === 'PubmedBookArticle') return [parseBookArticle(node)]
    return []
  })
}

async function fetchArticles(ctx: ProviderContext, pmids: string[]): Promise<Article[]> {
  // efetch 不认 retmode=json:文献正文只有 XML 一种形态。
  const xml = await eutils(ctx, 'efetch.fcgi', { id: pmids.join(','), retmode: 'xml' }, {
    accept: 'application/xml, text/xml',
    maxBytes: MAX_XML_RESPONSE_BYTES,
  })
  return parseArticleSet(xml)
}

// ---------------------------------------------------------------------------
// elink 与 handler
// ---------------------------------------------------------------------------

/** elink 的结果嵌在 `linksets[].linksetdbs[]` 里,要按 linkname 找到对应那一族。 */
function readLinkedPmids(payload: Json, linkName: string, label: string): string[] {
  const linksets = Array.isArray(payload.linksets)
    ? requireObjectArray(payload.linksets, `${label} linkset`)
    : []
  for (const linkset of linksets) {
    const databases = Array.isArray(linkset.linksetdbs)
      ? requireObjectArray(linkset.linksetdbs, `${label} database`)
      : []
    const related = databases.find(database => text(database.linkname) === linkName)
    if (related !== undefined) return requireStringArray(related.links, label)
  }
  // 没有这一族链接是正常结果(该文献没有被引/没有参考文献),不是错误。
  return []
}

async function linkedArticles(
  ctx: ProviderContext,
  sourcePmid: string,
  linkName: string,
  limit: number,
): Promise<Json> {
  const payload = await eutilsJson(ctx, 'elink.fcgi', {
    dbfrom: 'pubmed',
    id: sourcePmid,
    linkname: linkName,
    cmd: 'neighbor',
  })
  const pmids = readLinkedPmids(payload, linkName, `PubMed ${linkName} links`).slice(0, limit)
  return {
    sourcePmid,
    articles: pmids.length > 0 ? await fetchArticles(ctx, pmids) : [],
  }
}

/** `count` 是数字串;不是就说明响应坏了。 */
function readIntegerString(value: unknown, label: string): number {
  const raw = text(value)
  const parsed = raw === undefined ? Number.NaN : Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw invalidResponse(`${label} is malformed`)
  return parsed
}

/** PMC 的 id 有时以数字回来(pmid),统一成串。 */
function optionalIdentifier(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value)
  return text(value) ?? null
}

export async function searchArticles(
  input: z.infer<typeof searchArticlesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const query = requireInputText(input.query, 'query')
  // schema 里 offset/limit 带 `.default()` 但又 `.optional()`,default 不会生效,故这里兜底。
  const offset = input.offset ?? 0
  const limit = input.limit ?? 10
  if (offset + limit > MAX_SEARCH_WINDOW) {
    throw invalidInput(`offset plus limit must not exceed ${MAX_SEARCH_WINDOW} for PubMed searches`)
  }
  const sort = readSort(input.sort)
  const range = readPublicationDateRange(input.publicationDateRange)

  const payload = await eutilsJson(ctx, 'esearch.fcgi', {
    term: query,
    retstart: String(offset),
    retmax: String(limit),
    sort,
    // datetype 只在给了区间时才发,否则 NCBI 会按默认日期字段过滤掉本该命中的记录。
    datetype: range === undefined ? undefined : 'pdat',
    mindate: ncbiDate(range?.from),
    maxdate: ncbiDate(range?.to),
  })
  const result = requireRecord(payload.esearchresult, 'PubMed esearchresult')
  const pmids = requireStringArray(result.idlist, 'PubMed search idlist')

  return {
    total: readIntegerString(result.count, 'PubMed search count'),
    offset,
    limit,
    queryTranslation: text(result.querytranslation) ?? null,
    articles: pmids.length > 0 ? await fetchArticles(ctx, pmids) : [],
  }
}

export async function getArticle(
  input: z.infer<typeof getArticleInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const articles = await fetchArticles(ctx, [readPmid(input.pmid, 'pmid')])
  return { found: articles.length > 0, article: articles[0] ?? null }
}

export async function getArticles(
  input: z.infer<typeof getArticlesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const pmids = readPmidArray(input.pmids)
  const articles = await fetchArticles(ctx, pmids)
  const returned = new Set(articles.map(article => article.pmid))
  return { articles, notFoundPmids: pmids.filter(pmid => !returned.has(pmid)) }
}

export async function findRelatedArticles(
  input: z.infer<typeof findRelatedArticlesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const sourcePmid = readPmid(input.pmid, 'pmid')
  const limit = readLimit(input.limit)
  const payload = await eutilsJson(ctx, 'elink.fcgi', {
    dbfrom: 'pubmed',
    id: sourcePmid,
    linkname: 'pubmed_pubmed',
    cmd: 'neighbor',
  })
  // `pubmed_pubmed` 把源文献自己也算进"相关",先剔掉再截断,否则会白占一个名额。
  const related = readLinkedPmids(payload, 'pubmed_pubmed', 'PubMed related article links')
    .filter(pmid => pmid !== sourcePmid)
    .slice(0, limit)
  return {
    sourcePmid,
    articles: related.length > 0 ? await fetchArticles(ctx, related) : [],
  }
}

export async function getCitingArticles(
  input: z.infer<typeof getCitingArticlesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return linkedArticles(ctx, readPmid(input.pmid, 'pmid'), 'pubmed_pubmed_citedin', readLimit(input.limit))
}

export async function getArticleReferences(
  input: z.infer<typeof getArticleReferencesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return linkedArticles(ctx, readPmid(input.pmid, 'pmid'), 'pubmed_pubmed_refs', readLimit(input.limit))
}

export async function matchCitation(
  input: z.infer<typeof matchCitationInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const citation = requireInputText(input.citation, 'citation')
  const url = new URL(CITATION_MATCHER_URL)
  url.searchParams.set('method', 'heuristic')
  url.searchParams.set('raw-text', citation)

  const payload = await ncbiJson(url, 'PubMed Citation Matcher')
  // 信封式错误:HTTP 200 + `success: false`。当成功返回就把一次失败悄悄变成了空结果。
  if (payload.success !== true) {
    throw invalidResponse('PubMed Citation Matcher reported an unsuccessful response')
  }
  const result = requireRecord(payload.result, 'PubMed Citation Matcher result')
  const pmids = requireObjectArray(result.uids, 'PubMed Citation Matcher UIDs')
    .map((uid, index) => readPmid(uid.pubmed, `PubMed Citation Matcher UIDs[${index}].pubmed`))

  return {
    matched: pmids.length > 0,
    articles: pmids.length > 0 ? await fetchArticles(ctx, pmids) : [],
  }
}

export async function convertArticleIds(
  input: z.infer<typeof convertArticleIdsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const ids = readArticleIds(input.ids)
  const idType = readIdType(input.idType)
  const url = new URL(ID_CONVERTER_URL)
  url.searchParams.set('ids', ids.join(','))
  url.searchParams.set('idtype', idType)
  url.searchParams.set('format', 'json')
  url.searchParams.set('tool', TOOL_NAME)

  const payload = await ncbiJson(url, 'PMC ID Converter')
  const records = requireObjectArray(payload.records, 'PMC ID Converter records')
  return {
    records: records.map((item, index) => {
      const requestedId = optionalIdentifier(item['requested-id'])
      if (requestedId === null) {
        throw invalidResponse(`PMC ID Converter records[${index}].requested-id is malformed`)
      }
      return {
        requestedId,
        pmid: optionalIdentifier(item.pmid),
        pmcid: text(item.pmcid) ?? null,
        doi: text(item.doi) ?? null,
        mid: text(item.mid) ?? null,
        // PMC 用 `errmsg` 报"这个 id 解析不了",是逐条结果的一部分,不是整体失败。
        error: text(item.errmsg) ?? null,
      }
    }),
  }
}
