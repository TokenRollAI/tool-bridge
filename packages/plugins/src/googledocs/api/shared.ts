/**
 * Google Docs 各 handler 共用的请求层:URL/query 拼装、凭证、错误归一、批量更新与响应裁剪。
 *
 * 迁移自 open-connector `src/providers/googledocs/executors.ts` 与它共用的
 * `providers/googledrive/runtime-shared.ts`。32 个 action 按形状落在同目录的两个模块:
 * `batch.ts`(24 个走 `documents:batchUpdate` 的)与 `documents.ts`(8 个文档级/Drive/Sheets 的),
 * 纯文本渲染另置于 `plaintext.ts`。
 *
 * ## 凭证在 header,且是 OAuth 换来的
 *
 * `authorization: Bearer <access token>`,不在 URL。这个 token 是**平台托管 OAuth2**
 * (见 `../index.ts` 的 `oauth` 声明)用授权码换来、并按需刷新后注入的;插件侧照常
 * `requireApiKey(ctx, SERVICE)` 取,不需要知道它是 OAuth 来的,也不碰 refresh_token
 * 与 client 凭证 —— 那些在平台侧,插件永远看不到。
 *
 * ## 五处上游细节决定了这里的形状
 *
 * 1. **一个 provider 打四个 Google 服务**:Docs(`docs.googleapis.com/v1`)、
 *    Drive(`www.googleapis.com/drive/v3`,负责复制/搜索/导出 PDF)、
 *    Sheets(`sheets.googleapis.com/v4`,只为 `list_spreadsheet_charts`)。
 *    scope 也因此是四个(见 `../index.ts`)。
 * 2. **文档 id 可以是整条分享链接**:上游从 `/document/d/<id>` 与 `/spreadsheets/d/<id>`
 *    里抠 id,抠不出来就把原值当 id 用。agent 手里常常只有用户贴的 URL,这层不能省。
 * 3. **绝大多数写操作都是 `documents/{id}:batchUpdate` 的一条 request**,出参统一是
 *    `{documentId, replies, writeControl?}`;各 action 再从 `replies[0]` 里把自己关心的
 *    id 挑出来(footerId / headerId / namedRangeId / objectId …)。
 * 4. **403 身兼两职**:Google 用它同时表达"配额/限流"与"权限不足"。判据是错误体
 *    `error.errors[].reason`(`rateLimitExceeded` 一族)。归错了 agent 就会对一个永远
 *    不会变的权限错误无限重试,或反过来把等一会儿就好的限流当成死路。
 * 5. **上游自己的 `optionalString` 不去空白**(只把空串当"没给"),与其他 provider 里
 *    那个去空白的同名 helper 不是一回事。标题、分隔符这些字段里的空白是**有意义的内容**
 *    (`table_cell_delimiter: '\t'` 去了空白就成了空串,整张表会被拼成一行),
 *    故这里逐字保留"不去空白"的语义,只在文档 id 这类拼进 URL 的字段上另做去空白断言。
 *
 * ## 与上游的有意偏离
 *
 * - 上游 `extractGoogleError` 把上游原文原样当错误消息。这里**截断**:Google 的错误页
 *   可能是整页 HTML,原样塞进 message 会把日志和 agent 的上下文一起淹掉。
 * - 上游还导出一个 `proxy`(按 endpoint 前缀把任意请求透传给四个服务之一)。tool-bridge
 *   没有"任意透传"这一档 —— 那等于把整个 Docs/Drive/Sheets API 交给 agent,绕过 effect
 *   标注与出参裁剪,故不迁。
 * - 上游 `credentialValidators` 打 `/oauth2/v3/userinfo`。声明了 `oauth` 的 export 不能再声明
 *   `credentialProbe`(SDK 当场拒),令牌可用性由平台的授权流与刷新逻辑负责,故不迁。
 * - 不发 `user-agent`:上游那个值标识的是 open-connector 进程,在这里已无意义。
 * - 上游用 `node:buffer` 做 base64,这里换成 `btoa`(分块喂)—— 插件要能在 Workers 里跑。
 */

import { TBError } from '@tool-bridge/plugin-sdk'
import { type ProviderContext, requireApiKey } from '../../_runtime/plugin'
import { asJsonObject, compactDefined } from '../../_runtime/jsonValue'
import { bytesToBase64 } from '../../_runtime/responseBytes'
import { upstreamError } from '../../_runtime/upstreamError'
import { guardedFetch } from '../../_runtime/guardedFetch'

export const SERVICE = 'googledocs'
export const DOCS_API_BASE = 'https://docs.googleapis.com/v1'
export const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3'
export const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4'

const REQUEST_TIMEOUT_MS = 30_000
/** 错误消息里最多回显多少上游原文。 */
const MAX_ERROR_MESSAGE_LENGTH = 500

/** 配额/限流的 reason:403 带上它们时按 429 归一(可重试),不是权限问题。 */
const RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'quotaExceeded',
  'dailyLimitExceeded',
])

/** Drive 文件的字段掩码:上游挑的这十二个字段,出参 schema 也按它声明。 */
export const DRIVE_FILE_FIELDS = [
  'id',
  'name',
  'mimeType',
  'webViewLink',
  'createdTime',
  'modifiedTime',
  'driveId',
  'parents',
  'owners(displayName,emailAddress,permissionId,photoLink)',
  'shared',
  'starred',
  'trashed',
].join(',')

export type Json = Record<string, unknown>
/** 只有字符串会落到 query 上(数字/布尔在调用处先 stringify,同上游)。 */
export type Query = Record<string, string | undefined>

export interface DocsRequest {
  body?: Json
  method?: string
  query?: Query
  url: string
}

export const record = asJsonObject

/**
 * 上游 googledocs 自己那份 `optionalString`:**只把空串当"没给",不去空白**。
 * 见文件头第 5 条 —— 分隔符与标题里的空白是内容。
 */
export function optionalText(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value
}

/** 丢掉值为 undefined 的键(上游 `compactObject`);`null` 要留住。 */
export const compact = compactDefined

/** 契约说好是对象的地方上游回了别的东西 —— 上游违约,不是调用方的错。 */
export function requireRecord(value: unknown, label: string): Json {
  const result = record(value)
  if (result === undefined) throw new TBError('unavailable', `${label}不是对象`, { retryable: true })
  return result
}

/** 只保留对象项(上游 `asObjectArray` 的宽松版:非数组当空列表)。 */
export function objectArray(value: unknown): Json[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const fields = record(item)
    return fields === undefined ? [] : [fields]
  })
}

/** 沿路径取字符串(上游 `optionalNestedString`);任一层不是对象就算没有。 */
export function nestedText(value: Json | undefined, path: readonly string[]): string | undefined {
  let current: unknown = value
  for (const key of path) {
    const fields = record(current)
    if (fields === undefined) return undefined
    current = fields[key]
  }
  return typeof current === 'string' ? optionalText(current) : undefined
}

/** 沿路径取数字(上游 `optionalNestedNumber`)。 */
export function nestedNumber(value: Json | undefined, path: readonly string[]): number | undefined {
  let current: unknown = value
  for (const key of path) {
    const fields = record(current)
    if (fields === undefined) return undefined
    current = fields[key]
  }
  return typeof current === 'number' ? current : undefined
}

function requireNonBlank(value: string | undefined, field: string): string {
  if (value === undefined || value.trim() === '') {
    throw new TBError('invalid_argument', `${field} is required`)
  }
  return value
}

/** 是 Google 链接就抠出其中的 id,否则原值就是 id(上游 `extractIdFromGoogleUrl`)。 */
function extractId(value: string, pattern: RegExp): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return value
  }
  return url.toString().match(pattern)?.[1] ?? value
}

/**
 * 文档 id:既收裸 id 也收整条分享链接(见文件头第 2 条)。
 *
 * 去空白后为空就拒 —— schema 里这些字段只是 `z.string()`,纯空白串能过,拼进 URL 会打出
 * `documents/%20%20` 这样的请求,换回来的 404 让调用方以为文档不存在。
 */
export function requireDocumentId(value: string | undefined, field: string): string {
  return extractId(requireNonBlank(value, field), /\/document\/d\/([^/?#]+)/u)
}

/** 表格 id;与文档 id 同理,只是链接模式不同。 */
export function requireSpreadsheetId(value: string | undefined, field: string): string {
  return extractId(requireNonBlank(value, field), /\/spreadsheets\/d\/([^/?#]+)/u)
}

/**
 * Drive 文件 id:先按文档链接抠,抠不出再按表格链接抠(上游 `extractFileId` 的顺序)。
 * 导出 PDF 既可能拿到 Docs 链接也可能拿到 Sheets 链接。
 */
export function requireFileId(value: string | undefined, field: string): string {
  const raw = requireNonBlank(value, field)
  const fromDocument = extractId(raw, /\/document\/d\/([^/?#]+)/u)
  if (fromDocument !== raw) return fromDocument
  return extractId(raw, /\/spreadsheets\/d\/([^/?#]+)/u)
}

function buildUrl(url: string, query: Query | undefined): string {
  const target = new URL(url)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) target.searchParams.set(key, value)
  }
  return target.toString()
}

function truncate(value: string): string {
  return value.length <= MAX_ERROR_MESSAGE_LENGTH ? value : `${value.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
}

/** 从 Google 的错误体里取消息与 reason 列表;非 JSON(错误页)就用原文当消息。 */
async function readError(response: Response): Promise<{ message: string, reasons: string[] }> {
  const raw = await response.text().catch(() => '')
  if (raw === '') return { message: `Google Docs 返回 HTTP ${response.status}`, reasons: [] }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return { message: truncate(raw), reasons: [] }
  }
  const body = record(payload)
  const error = record(body?.error)
  const reasons = Array.isArray(error?.errors)
    ? error.errors
        .map(item => nestedText(record(item), ['reason']))
        .filter((item): item is string => item !== undefined)
    : []
  // `error_description` 是令牌端点那一族的字段名(access token 失效时会走到这里)。
  const message = nestedText(error, ['message']) ?? nestedText(body, ['error_description']) ?? truncate(raw)
  return { message, reasons }
}

async function docsError(response: Response): Promise<TBError> {
  const { message, reasons } = await readError(response)
  if (response.status === 403 && reasons.some(reason => RATE_LIMIT_REASONS.has(reason))) {
    // 配额耗尽是**等一会儿就好**的,归 rate_limited(可重试);权限不足才是 permission_denied。
    return upstreamError(429, message)
  }
  return upstreamError(response.status, message)
}

/** 发一次请求并断言状态;body 的读取交给调用方(PDF 导出要的是字节而不是 JSON)。 */
export async function send(ctx: ProviderContext, input: DocsRequest): Promise<Response> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const accessToken = requireApiKey(ctx, SERVICE)
  const hasBody = input.body !== undefined

  let response: Response
  try {
    response = await guardedFetch(buildUrl(input.url, input.query), {
      method: input.method ?? (hasBody ? 'POST' : 'GET'),
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`,
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
      },
      body: hasBody ? JSON.stringify(input.body) : undefined,
      // 不设超时会让一个挂死的端点拖住整个调用;上游同样给了 30s 的独立预算。
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障。
    if (error instanceof TBError) throw error
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw upstreamError(504, `Google Docs 请求超时(${REQUEST_TIMEOUT_MS / 1000} 秒)`)
    }
    const message = error instanceof Error ? error.message : 'unknown network error'
    throw upstreamError(502, `Google Docs 请求失败:${message}`)
  }

  if (!response.ok) throw await docsError(response)
  return response
}

export async function requestJson(ctx: ProviderContext, input: DocsRequest): Promise<unknown> {
  const response = await send(ctx, input)
  const body = await response.text()
  if (body === '') {
    throw new TBError('unavailable', 'Google Docs 在应回 JSON 的地方回了空响应体', { retryable: true })
  }
  try {
    return JSON.parse(body)
  } catch {
    throw new TBError('unavailable', 'Google Docs 返回了非 JSON 响应', { retryable: true })
  }
}

export async function requestRecord(ctx: ProviderContext, input: DocsRequest): Promise<Json> {
  return requireRecord(await requestJson(ctx, input), 'Google Docs 响应')
}

export { bytesToBase64 as base64 }

/** 批量更新的统一出参(上游 `runBatchRequest`)。 */
export interface BatchResult extends Json {
  documentId: string
  replies: Json[]
}

/**
 * 打一次 `documents/{id}:batchUpdate`。
 *
 * `writeControl` 只有 `update_document_batch` 会给(它是 Docs 的乐观并发控制);其余 action
 * 不发这个键 —— 发一个空对象过去 Google 会当成"要求 revisionId 匹配"而 400。
 */
export async function runBatch(
  ctx: ProviderContext,
  documentId: string,
  requests: Json[],
  writeControl?: Json,
): Promise<BatchResult> {
  const payload = await requestRecord(ctx, {
    url: `${DOCS_API_BASE}/documents/${documentId}:batchUpdate`,
    method: 'POST',
    body: compact<unknown>({ requests, writeControl }) as Json,
  })
  return {
    documentId,
    replies: objectArray(payload.replies),
    // 上游只在 Google 真的回了 writeControl 时才透出这个键。
    ...(record(payload.writeControl) === undefined ? {} : { writeControl: record(payload.writeControl) }),
  }
}

/** 单条 request 的批量更新;`extra` 是该 action 额外要透出的字段(上游 `runSingleBatchRequest`)。 */
export async function runSingle(
  ctx: ProviderContext,
  documentId: string,
  request: Json,
  extra?: Json,
): Promise<BatchResult> {
  const output = await runBatch(ctx, documentId, [request])
  return { ...output, ...extra }
}

/** 文档摘要(上游 `normalizeDocumentSummary`):id 同样过一遍链接抠取。 */
export function documentSummary(document: Json): Json {
  const documentId = typeof document.documentId === 'string' ? document.documentId : ''
  return {
    documentId: extractId(documentId, /\/document\/d\/([^/?#]+)/u),
    title: typeof document.title === 'string' ? document.title : '',
    revisionId: nestedText(document, ['revisionId']) ?? null,
  }
}

/** 文档明细:摘要 + Google 真的回了的那些容器字段(上游 `normalizeDocument`)。 */
export function documentDetail(document: Json): Json {
  const containers = ['body', 'headers', 'footers', 'footnotes', 'documentStyle', 'namedRanges', 'inlineObjects', 'lists']
  const detail: Json = documentSummary(document)
  for (const key of containers) {
    const value = record(document[key])
    if (value !== undefined) detail[key] = value
  }
  if (Array.isArray(document.tabs)) detail.tabs = objectArray(document.tabs)
  return detail
}

/** Drive 文件元数据(上游 `normalizeDriveFile`):必给的三个字段兜空串,可空的兜 null。 */
export function driveFile(payload: Json): Json {
  const owners = Array.isArray(payload.owners)
    ? objectArray(payload.owners).map(owner => ({
        displayName: nestedText(owner, ['displayName']) ?? null,
        emailAddress: nestedText(owner, ['emailAddress']) ?? null,
        permissionId: nestedText(owner, ['permissionId']) ?? null,
        photoLink: nestedText(owner, ['photoLink']) ?? null,
      }))
    : undefined
  const parents = Array.isArray(payload.parents)
    ? payload.parents.filter((item): item is string => typeof item === 'string')
    : undefined
  return compact<unknown>({
    id: typeof payload.id === 'string' ? payload.id : '',
    name: typeof payload.name === 'string' ? payload.name : '',
    mimeType: typeof payload.mimeType === 'string' ? payload.mimeType : '',
    webViewLink: nestedText(payload, ['webViewLink']) ?? null,
    createdTime: nestedText(payload, ['createdTime']) ?? null,
    modifiedTime: nestedText(payload, ['modifiedTime']) ?? null,
    driveId: nestedText(payload, ['driveId']) ?? null,
    parents,
    owners,
    // 三个布尔只在 Google 明确给了布尔时才透出(上游用 typeof 判,不给缺省值)。
    shared: typeof payload.shared === 'boolean' ? payload.shared : undefined,
    starred: typeof payload.starred === 'boolean' ? payload.starred : undefined,
    trashed: typeof payload.trashed === 'boolean' ? payload.trashed : undefined,
  }) as Json
}

export type { ProviderContext }
