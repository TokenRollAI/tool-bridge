/**
 * Dropbox 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/dropbox/executors.ts`,语义等价、写法本地化:
 * 出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * ## 凭证:这里拿到的是 OAuth access token,不是 API key
 *
 * Dropbox 走**平台托管的 OAuth2**(声明在 `index.ts` 的 `oauth` 里)。但 handler 侧照常
 * `requireApiKey(ctx, SERVICE)` —— 拿到的是平台用授权码换来、并在过期前按 refresh token
 * 自动续上的 access token,插件**不参与**授权、不持有 client_secret、也不需要知道这个字符串
 * 是 OAuth 来的。所以本文件里看不到任何 OAuth 逻辑,这不是漏了一段,是分层的结果:
 * 授权与刷新在平台(见 `packages/app/src/providerOAuth.ts`),插件只管拿 token 打上游。
 *
 * ## 五处上游细节决定了这里的形状
 *
 * - **两个 host**:`api.dropboxapi.com/2` 是 RPC 面(JSON in / JSON out),
 *   `content.dropboxapi.com/2` 是内容面(上传下载)。内容面的**参数走请求头**
 *   `Dropbox-API-Arg`(JSON 串),body 留给文件字节;下载的元数据则从响应头
 *   `Dropbox-API-Result` 取。走错 host 会 400。
 * - `users/get_current_account` 是**不带 body** 的 POST,而且不能带 `content-type`
 *   —— 带了 Dropbox 会拒。故 `content-type` 只在真有 body 时才设。
 * - 错误体是 `{ error_summary, error: { '.tag': … } }`,而 Dropbox 把**几乎所有**端点特有的
 *   失败都压在 HTTP **409** 上,真正的语义只在 `.tag` / `error_summary` 里
 *   (`path/not_found/…`、`expired_access_token`、`too_many_write_operations`…)。
 *   只看状态码会把"文件不存在"和"名字冲突"归成同一码,故先看 tag(见 `dropboxError`)。
 * - `error_summary` 结尾常带一个 `/...`(Dropbox 表示"还有更细的分支"),按上游去掉。
 * - 元数据的 `.tag` 有时缺席,上游按"有 rev / content_hash / size / is_downloadable
 *   任一即视为 file"来兜底(见 `metadataTag`)—— `download_file` 靠它拒掉文件夹路径。
 *
 * ## 与上游的偏离(逐条给了理由)
 *
 * - `node:buffer` 换成 Web API(`atob` / `TextEncoder` / 手写 base64 编码):插件要能在
 *   Workers 里跑。副作用是**更严**:Node 的 `Buffer.from(x, 'base64')` 对非法字符静默忽略,
 *   `atob` 会抛 —— 于是上游那句永远走不到的 "contentBase64 must be valid base64" 终于生效了。
 * - 出参契约字段缺失(`account_id`、`cursor`、`link`…)归 `unavailable` + retryable。
 *   上游也用 502,语义一致;只是这层显式标了可重试。
 * - `mode: 'update'` 缺 `updateRev` 时在本地拒。上游会发出一个 `{".tag":"update"}` 的
 *   残缺参数、必然被 Dropbox 400 —— 而这是**写**请求,让它出门一趟不值。
 *   (schema 里 `updateRev` 的 description 本来就写着 "required when mode is update"。)
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  copyInput,
  createFolderInput,
  createSharedLinkInput,
  deleteInput,
  downloadFileInput,
  getCurrentAccountInput,
  getMetadataInput,
  getSharedLinkFileInput,
  getSharedLinkMetadataInput,
  getTagsInput,
  getTemporaryLinkInput,
  listFolderContinueInput,
  listFolderInput,
  listRevisionsInput,
  listSharedLinksInput,
  modifySharedLinkInput,
  moveInput,
  restoreInput,
  revokeSharedLinkInput,
  saveUrlCheckJobStatusInput,
  saveUrlInput,
  searchFilesContinueInput,
  searchFilesInput,
  uploadFileInput,
} from './schema'
import {
  booleanValue as bool,
  compactDefined as compact,
  finiteNumber as num,
  asJsonObject as record,
  trimmedText as text,
} from '../_runtime/jsonValue'
import { createProviderHttpClient, type ProviderHttpErrorContext } from '../_runtime/providerHttp'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'dropbox'
/** RPC 面:JSON 进 JSON 出。 */
const API_BASE = 'https://api.dropboxapi.com/2'
/** 内容面:上传下载,参数走 Dropbox-API-Arg 头。 */
const CONTENT_BASE = 'https://content.dropboxapi.com/2'
const http = createProviderHttpClient({ baseUrl: `${API_BASE}/`, service: SERVICE })
/** 单请求上传上限。超过要走 upload_session(上游第一版没做,这里同样不做)。 */
const MAX_SIMPLE_UPLOAD_BYTES = 150 * 1024 * 1024
const DEFAULT_MIME_TYPE = 'application/octet-stream'

type Json = Record<string, unknown>

/** 上游 `readObjectArray`:只保留是对象的项,不是数组则空数组。 */
function objectArray(value: unknown): Json[] {
  if (!Array.isArray(value)) return []
  return value.map(item => record(item)).filter((item): item is Json => item !== undefined)
}

/** 上游 `readStringArray`:非空字符串项;一个都不剩就整个字段不发。 */
function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string' && item !== '')
  return items.length > 0 ? items : undefined
}

/** 出参契约字段缺失 —— 是上游的问题,不是调用方的。 */
function contractError(label: string): TBError {
  return new TBError('unavailable', `Dropbox 响应缺少 ${label}`, { retryable: true })
}

function requiredText(value: unknown, label: string): string {
  const result = text(value)
  if (result === undefined) throw contractError(label)
  return result
}

function requiredRecord(value: unknown, label: string): Json {
  const result = record(value)
  if (result === undefined) throw contractError(label)
  return result
}

/**
 * 入参里"必填且去空白"的字段(上游 `requireString` 的等价物)。
 *
 * 两件事:
 * - **必填断言**。schema 把 `path` 之类声明成 `z.string()`(非空校验只在个别字段上有),
 *   纯空白能过校验;上游用 `requireString` 拦下 —— 空路径打到 Dropbox 是一次必然失败的
 *   调用。上游把它记成 502,这里归 `invalid_argument`:是调用方给的参数不对,不是上游故障。
 * - **去空白**。`requireString` 返回的是 trim 过的值,所以 `path: ' /a.txt '` 发出去的是
 *   `/a.txt`。凡是上游走 requireString 的字段这层都照做(cursor、rev、query、url 都在内)——
 *   Dropbox 不会替你 trim,带空格的路径就是另一个路径。
 */
function required(value: string | undefined, field: string): string {
  const result = text(value)
  if (result === undefined) throw new TBError('invalid_argument', `${field} 不能为空`)
  return result
}

// ── base64:上游用 node:buffer,这里换成 Web API(插件要能在 Workers 里跑) ──────────

/** 字节 → base64。分块喂 `String.fromCharCode`,免得大文件把参数展开炸掉调用栈。 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

/**
 * base64 → 字节。
 *
 * `atob` 对非法输入会抛,而 Node 的 `Buffer.from(x, 'base64')` 是静默忽略非法字符的 ——
 * 上游那个 catch 分支永远走不到,坏 base64 会被悄悄截断后**上传成一个错文件**。
 * 这里让它真的报错。
 */
function base64ToBytes(value: string): Uint8Array {
  let binary: string
  try {
    binary = atob(value)
  } catch {
    throw new TBError('invalid_argument', 'contentBase64 不是合法的 base64')
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

// ── 错误归一 ────────────────────────────────────────────────────────────────────

/** `error_summary` 结尾的 `/...` 是 Dropbox 的"还有更细分支"标记,不是消息的一部分。 */
function trimSummary(value: string): string {
  return value.endsWith('/...') ? value.slice(0, -4) : value
}

/**
 * Dropbox 错误 → TBError。
 *
 * **先看 tag、再看状态**:Dropbox 把端点特有的失败几乎全压在 409 上(`path/not_found`、
 * `path/conflict/file`、`too_many_write_operations`…),只按状态归一会把"文件不存在"、
 * "名字冲突"、"写太频繁"混成一码,而这三者对 agent 的下一步动作完全不同。
 */
function dropboxError(status: number, discriminator: string | undefined, message: string): TBError {
  const tag = discriminator ?? ''
  // token 失效:平台该去刷新/重新授权,重试同一个 token 没意义。
  if (/expired_access_token|invalid_access_token/.test(tag)) return upstreamError(401, message)
  if (/too_many_requests|too_many_write_operations/.test(tag)) return upstreamError(429, message)
  if (/not_found/.test(tag)) return upstreamError(404, message)
  if (/conflict/.test(tag)) return upstreamError(409, message)
  // `no_permission` / `access_denied` / `not_allowed`:授权范围不够或对象不允许该操作。
  if (/no_permission|access_denied|not_allowed|no_write_permission/.test(tag)) {
    return upstreamError(403, message)
  }
  return upstreamError(status, message)
}

/** 从错误响应里取出 `{discriminator, message}`。非 JSON 错误体(HTML 错误页)只有文本。 */
async function readError(response: Response, fallback: string): Promise<TBError> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    const raw = (await response.text()).trim()
    return dropboxError(response.status, undefined, raw === '' ? fallback : raw)
  }

  let payload: Json | undefined
  try {
    payload = record(JSON.parse(await response.text()))
  } catch {
    payload = undefined
  }
  const summary = text(payload?.error_summary)
  const tag = text(record(payload?.error)?.['.tag'])
  const message = summary === undefined ? tag ?? fallback : trimSummary(summary)
  // 判别用 summary 优先:它比 `.tag` 细(`path/not_found/…` vs `path`)。
  return dropboxError(response.status, summary ?? tag, message)
}

// ── 出站 ────────────────────────────────────────────────────────────────────────

function authHeader(ctx: ProviderContext): string {
  return `Bearer ${requireApiKey(ctx, SERVICE)}`
}

function rpcError(context: ProviderHttpErrorContext, fallback: string): TBError {
  if (!context.headers.get('content-type')?.includes('application/json')) {
    const raw = context.rawText?.trim()
    return dropboxError(context.status, undefined, raw === undefined || raw === '' ? fallback : raw)
  }
  const payload = record(context.data)
  const summary = text(payload?.error_summary)
  const tag = text(record(payload?.error)?.['.tag'])
  const message = summary === undefined ? tag ?? fallback : trimSummary(summary)
  return dropboxError(context.status, summary ?? tag, message)
}

/**
 * RPC 请求。所有 RPC 都是 POST。
 *
 * `content-type` **只在有 body 时**才设:`users/get_current_account` 是不带 body 的 POST,
 * 带上 content-type 会被 Dropbox 拒。
 */
async function rpc(
  ctx: ProviderContext,
  route: string,
  options: { allowEmptyResponse?: boolean, body?: Json } = {},
): Promise<Json> {
  const hasBody = options.body !== undefined
  const result = await http.request({
    path: route,
    method: 'POST',
    headers: { authorization: authHeader(ctx) },
    ...(hasBody ? { json: options.body } : {}),
    invalidJsonMessage: 'Dropbox 返回了非 JSON 响应',
    mapError: context => rpcError(context, `Dropbox ${route} 调用失败`),
  })
  if (result.bodyKind === 'empty') {
    // 空响应只在明确允许时才算成功(revoke_shared_link 就什么都不回)。
    if (options.allowEmptyResponse === true) return {}
    throw new TBError('unavailable', `Dropbox ${route} 返回了空响应`, { retryable: true })
  }
  const parsed = result.data
  if (parsed === null) return {}
  return requiredRecord(parsed, `${route} 响应`)
}

/** 内容面的下载:元数据在 `Dropbox-API-Result` 头,字节在 body。 */
async function downloadContent(
  ctx: ProviderContext,
  route: string,
  arg: Json,
  fallbackMessage: string,
): Promise<{ bytes: Uint8Array, contentType: string | null, metadata: Json }> {
  const response = await guardedFetch(`${CONTENT_BASE}${route}`, {
    method: 'POST',
    headers: {
      'authorization': authHeader(ctx),
      'Dropbox-API-Arg': JSON.stringify(arg),
    },
  })

  if (!response.ok) throw await readError(response, fallbackMessage)

  const raw = response.headers.get('dropbox-api-result')
  if (raw === null || raw === '') {
    throw new TBError('unavailable', 'Dropbox 下载响应缺少 dropbox-api-result 头', { retryable: true })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new TBError('unavailable', 'Dropbox 下载元数据不是合法 JSON', { retryable: true })
  }

  return {
    metadata: requiredRecord(parsed, '下载元数据'),
    contentType: response.headers.get('content-type'),
    bytes: new Uint8Array(await response.arrayBuffer()),
  }
}

// ── 元数据整形 ──────────────────────────────────────────────────────────────────

/**
 * 元数据的类型标签。
 *
 * `.tag` 缺席时按"有 rev / content_hash / size / is_downloadable 任一即是文件"兜底 ——
 * 有些路由(如 `files/restore`、shared link 相关)不带 `.tag`,而 `download_file` 要靠这个
 * 标签拒掉文件夹路径。
 */
function metadataTag(item: Json): string {
  const explicit = text(item['.tag'])
  if (explicit !== undefined) return explicit
  if (
    bool(item.is_downloadable) !== undefined
    || text(item.rev) !== undefined
    || text(item.content_hash) !== undefined
    || num(item.size) !== undefined
  ) {
    return 'file'
  }
  return 'unknown'
}

/** 文件/文件夹/共享链接共用的一张出参表(上游 `mapDropboxMetadata`)。 */
function mapMetadata(value: unknown): Json {
  const item = requiredRecord(value, '元数据')
  return {
    tag: metadataTag(item),
    // 名字缺失时给空串而不是 null:出参契约里 name 是必填 string。
    name: text(item.name) ?? '',
    id: text(item.id) ?? null,
    pathDisplay: text(item.path_display) ?? null,
    pathLower: text(item.path_lower) ?? null,
    clientModified: text(item.client_modified) ?? null,
    serverModified: text(item.server_modified) ?? null,
    rev: text(item.rev) ?? null,
    sizeBytes: num(item.size) ?? null,
    isDownloadable: bool(item.is_downloadable) ?? null,
    contentHash: text(item.content_hash) ?? null,
    url: text(item.url) ?? null,
    expiresAt: text(item.expires) ?? null,
    sharingInfo: record(item.sharing_info) ?? null,
    linkPermissions: record(item.link_permissions) ?? null,
  }
}

/** `files/list_folder` 与它的 continue 共用的出参形状。 */
function listFolderResult(payload: Json): Json {
  return {
    entries: objectArray(payload.entries).map(entry => mapMetadata(entry)),
    cursor: requiredText(payload.cursor, 'cursor'),
    hasMore: bool(payload.has_more) ?? false,
  }
}

/** `files/search_v2` 与它的 continue 共用的出参形状。 */
function searchResult(payload: Json): Json {
  return {
    matches: objectArray(payload.matches).map((match) => {
      const metadata = record(match.metadata) ?? {}
      return {
        matchType: text(record(match.match_type)?.['.tag']) ?? 'unknown',
        // search_v2 的 match.metadata 自己还套一层 metadata;两种形状都接。
        metadata: mapMetadata(record(metadata.metadata) ?? metadata),
        highlightSpans: objectArray(match.highlight_spans),
      }
    }),
    cursor: text(payload.cursor) ?? null,
    hasMore: bool(payload.has_more) ?? false,
  }
}

/** `files/save_url` 与它的 check_job_status 共用的出参形状(异步任务信封)。 */
function saveUrlResult(payload: Json): Json {
  const tag = text(payload['.tag']) ?? 'unknown'
  // 完成态的元数据可能在 `complete`、在 `metadata`,也可能就是载荷自身。
  const metadata = record(payload.complete)
    ?? record(payload.metadata)
    ?? (tag === 'complete' ? payload : undefined)
  return {
    tag,
    asyncJobId: text(payload.async_job_id) ?? null,
    metadata: metadata === undefined ? null : mapMetadata(metadata),
    failure: record(payload.failed) ?? record(payload.failure) ?? null,
  }
}

/** 下载类 action 的公共尾段:校验是文件、取名字与 MIME、把字节编成 base64。 */
function downloadResult(
  downloaded: { bytes: Uint8Array, contentType: string | null, metadata: Json },
  fileName: string | undefined,
  action: string,
): Json {
  const metadata = mapMetadata(downloaded.metadata)
  if (metadata.tag !== 'file') {
    // 文件夹路径没有可下载的字节 —— 这是调用方给错了路径。
    throw new TBError('invalid_argument', `${action} 只能下载文件,该路径不是文件`)
  }
  const fileId = metadata.id
  if (typeof fileId !== 'string' || fileId === '') throw contractError('下载元数据里的文件 id')

  return {
    fileId,
    name: text(fileName) ?? metadata.name,
    mimeType: text(downloaded.contentType) ?? DEFAULT_MIME_TYPE,
    sizeBytes: metadata.sizeBytes,
    contentBase64: bytesToBase64(downloaded.bytes),
  }
}

// ── 账户 ────────────────────────────────────────────────────────────────────────

export async function getCurrentAccount(
  _input: z.infer<typeof getCurrentAccountInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 这一路由不带 body(也就不带 content-type)—— 带了 Dropbox 会拒。
  const payload = await rpc(ctx, 'users/get_current_account')
  const name = record(payload.name) ?? {}
  const team = record(payload.team) ?? {}
  const accountType = record(payload.account_type) ?? {}

  return {
    accountId: requiredText(payload.account_id, 'account_id'),
    displayName: requiredText(name.display_name, 'name.display_name'),
    abbreviatedName: text(name.abbreviated_name) ?? null,
    givenName: text(name.given_name) ?? null,
    surname: text(name.surname) ?? null,
    email: text(payload.email) ?? null,
    emailVerified: bool(payload.email_verified) ?? null,
    disabled: bool(payload.disabled) ?? false,
    locale: text(payload.locale) ?? null,
    country: text(payload.country) ?? null,
    accountType: text(accountType['.tag']) ?? null,
    teamId: text(team.id) ?? null,
    teamName: text(team.name) ?? null,
  }
}

// ── 文件与文件夹 ────────────────────────────────────────────────────────────────

export async function listFolder(input: z.infer<typeof listFolderInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await rpc(ctx, 'files/list_folder', {
    body: compact<unknown>({
      // 根目录在 Dropbox 里是空串,不是 '/' —— 省略 path 等同列根。
      path: text(input.path) ?? '',
      recursive: input.recursive,
      include_deleted: input.includeDeleted,
      include_mounted_folders: input.includeMountedFolders,
      include_has_explicit_shared_members: input.includeHasExplicitSharedMembers,
      limit: input.limit,
    }),
  })
  return listFolderResult(payload)
}

export async function listFolderContinue(
  input: z.infer<typeof listFolderContinueInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listFolderResult(await rpc(ctx, 'files/list_folder/continue', { body: { cursor: required(input.cursor, 'cursor') } }))
}

export async function getMetadata(input: z.infer<typeof getMetadataInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await rpc(ctx, 'files/get_metadata', {
    body: compact<unknown>({
      path: required(input.path, 'path'),
      include_deleted: input.includeDeleted,
      include_has_explicit_shared_members: input.includeHasExplicitSharedMembers,
    }),
  })
  return { metadata: mapMetadata(payload) }
}

export async function downloadFile(input: z.infer<typeof downloadFileInput>, ctx: ProviderContext): Promise<Json> {
  const downloaded = await downloadContent(
    ctx,
    '/files/download',
    { path: required(input.path, 'path') },
    'Dropbox 下载失败',
  )
  return downloadResult(downloaded, input.fileName, 'download_file')
}

/** `mode` 的三种形态:字符串 add/overwrite,或 update 时的 `{'.tag':'update', update: rev}`。 */
function writeMode(mode: string | undefined, updateRev: string | undefined): unknown {
  if (mode === 'overwrite') return 'overwrite'
  if (mode === 'update') {
    const rev = text(updateRev)
    // 缺 rev 的 update 参数残缺,Dropbox 必然 400 —— 写请求不值得为此出门一趟。
    if (rev === undefined) throw new TBError('invalid_argument', 'mode 为 \'update\' 时必须给 updateRev')
    return { '.tag': 'update', 'update': rev }
  }
  return 'add'
}

/**
 * 上传内容的来源:`text` 与 `contentBase64` **恰好给一个**。
 *
 * 注意 `text: ''` 算给了(上传一个空文件是合法意图),而 `contentBase64: ''` 不算 ——
 * 上游对后者走 `optionalString`(空串视为未给),对前者只判 `!= null`。这层照抄。
 */
function uploadSource(input: z.infer<typeof uploadFileInput>): { bytes: Uint8Array, mimeType: string } {
  const inlineText = input.text
  const contentBase64 = text(input.contentBase64)
  const sources = Number(inlineText !== undefined) + Number(contentBase64 !== undefined)
  if (sources !== 1) {
    throw new TBError('invalid_argument', 'text 与 contentBase64 必须恰好给一个')
  }

  return {
    bytes: inlineText === undefined
      ? base64ToBytes(contentBase64 ?? '')
      : new TextEncoder().encode(inlineText),
    mimeType: text(input.mimeType) ?? DEFAULT_MIME_TYPE,
  }
}

export async function uploadFile(input: z.infer<typeof uploadFileInput>, ctx: ProviderContext): Promise<Json> {
  const source = uploadSource(input)
  if (source.bytes.byteLength > MAX_SIMPLE_UPLOAD_BYTES) {
    throw new TBError(
      'invalid_argument',
      'upload_file 单请求最多 150 MiB(更大的文件需要 upload_session,本 provider 尚未支持)',
    )
  }

  const arg = compact<unknown>({
    path: required(input.path, 'path'),
    mode: writeMode(input.mode, input.updateRev),
    autorename: input.autorename,
    client_modified: text(input.clientModified),
    mute: input.mute,
    strict_conflict: input.strictConflict,
    content_hash: text(input.contentHash),
  })

  const response = await guardedFetch(`${CONTENT_BASE}/files/upload`, {
    method: 'POST',
    headers: {
      'authorization': authHeader(ctx),
      // 内容面用 octet-stream 语义传字节,参数全在 Dropbox-API-Arg 头里。
      'content-type': source.mimeType,
      'Dropbox-API-Arg': JSON.stringify(arg),
    },
    body: source.bytes as BodyInit,
  })

  if (!response.ok) throw await readError(response, 'Dropbox 上传失败')

  let parsed: unknown
  try {
    parsed = JSON.parse(await response.text())
  } catch {
    throw new TBError('unavailable', 'Dropbox 返回了非 JSON 响应', { retryable: true })
  }
  return { metadata: mapMetadata(parsed) }
}

export async function createFolder(input: z.infer<typeof createFolderInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await rpc(ctx, 'files/create_folder_v2', {
    body: compact<unknown>({
      path: required(input.path, 'path'),
      autorename: input.autorename,
    }),
  })
  // _v2 路由把结果包在 metadata 里。
  return { metadata: mapMetadata(payload.metadata) }
}

/** move 与 copy 只差路由名,参数与出参完全一致。 */
async function relocate(
  input: z.infer<typeof copyInput>,
  ctx: ProviderContext,
  route: 'copy_v2' | 'move_v2',
): Promise<Json> {
  const payload = await rpc(ctx, `files/${route}`, {
    body: compact<unknown>({
      from_path: required(input.fromPath, 'fromPath'),
      to_path: required(input.toPath, 'toPath'),
      autorename: input.autorename,
      allow_ownership_transfer: input.allowOwnershipTransfer,
    }),
  })
  return { metadata: mapMetadata(payload.metadata) }
}

export function move(input: z.infer<typeof moveInput>, ctx: ProviderContext): Promise<Json> {
  return relocate(input, ctx, 'move_v2')
}

export function copy(input: z.infer<typeof copyInput>, ctx: ProviderContext): Promise<Json> {
  return relocate(input, ctx, 'copy_v2')
}

export async function deletePath(input: z.infer<typeof deleteInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await rpc(ctx, 'files/delete_v2', {
    body: compact<unknown>({
      path: required(input.path, 'path'),
      parent_rev: text(input.parentRev),
    }),
  })
  return { metadata: mapMetadata(payload.metadata) }
}

export async function searchFiles(input: z.infer<typeof searchFilesInput>, ctx: ProviderContext): Promise<Json> {
  const options = compact<unknown>({
    path: text(input.path),
    max_results: input.maxResults,
    file_status: text(input.fileStatus),
    filename_only: input.filenameOnly,
    file_categories: stringArray(input.fileCategories),
    file_extensions: stringArray(input.fileExtensions),
    order_by: text(input.orderBy),
  })

  const payload = await rpc(ctx, 'files/search_v2', {
    body: compact<unknown>({
      query: required(input.query, 'query'),
      // 一个都没给就整个 options 不发(空对象会被 Dropbox 当成显式的全默认)。
      options: Object.keys(options).length > 0 ? options : undefined,
      // 只在显式要 highlight 时才发这个信封。
      match_field_options: input.includeHighlights === true ? { include_highlights: true } : undefined,
    }),
  })
  return searchResult(payload)
}

export async function searchFilesContinue(
  input: z.infer<typeof searchFilesContinueInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return searchResult(await rpc(ctx, 'files/search/continue_v2', { body: { cursor: required(input.cursor, 'cursor') } }))
}

export async function getTemporaryLink(
  input: z.infer<typeof getTemporaryLinkInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await rpc(ctx, 'files/get_temporary_link', {
    body: { path: required(input.path, 'path') },
  })
  return {
    metadata: mapMetadata(payload.metadata),
    link: requiredText(payload.link, 'link'),
  }
}

export async function saveUrl(input: z.infer<typeof saveUrlInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await rpc(ctx, 'files/save_url', {
    body: {
      path: required(input.path, 'path'),
      url: required(input.url, 'url'),
    },
  })
  return saveUrlResult(payload)
}

export async function saveUrlCheckJobStatus(
  input: z.infer<typeof saveUrlCheckJobStatusInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await rpc(ctx, 'files/save_url/check_job_status', {
    body: { async_job_id: required(input.asyncJobId, 'asyncJobId') },
  })
  return saveUrlResult(payload)
}

export async function listRevisions(input: z.infer<typeof listRevisionsInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await rpc(ctx, 'files/list_revisions', {
    body: compact<unknown>({
      path: required(input.path, 'path'),
      mode: text(input.mode),
      before_rev: text(input.beforeRev),
      limit: input.limit,
    }),
  })
  return {
    entries: objectArray(payload.entries).map(entry => mapMetadata(entry)),
    isDeleted: bool(payload.is_deleted) ?? false,
    serverDeleted: text(payload.server_deleted) ?? null,
    hasMore: bool(payload.has_more) ?? false,
  }
}

export async function restore(input: z.infer<typeof restoreInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await rpc(ctx, 'files/restore', {
    body: {
      path: required(input.path, 'path'),
      rev: required(input.rev, 'rev'),
    },
  })
  // restore 直接回文件元数据,不包 metadata 层。
  return { metadata: mapMetadata(payload) }
}

export async function getTags(input: z.infer<typeof getTagsInput>, ctx: ProviderContext): Promise<Json> {
  const paths = stringArray(input.paths)
  // schema 只保证数组非空,不保证项非空白;全是空串时等于没给路径。
  if (paths === undefined) throw new TBError('invalid_argument', 'get_tags 至少需要一个非空路径')

  const payload = await rpc(ctx, 'files/tags/get', { body: { paths } })
  return {
    pathsToTags: objectArray(payload.paths_to_tags).map(entry => ({
      path: requiredText(entry.path, 'paths_to_tags[].path'),
      tags: objectArray(entry.tags).map(tag => ({
        tag: text(tag['.tag']) ?? 'unknown',
        tagText: text(tag.tag_text) ?? null,
      })),
    })),
  }
}

// ── 共享链接 ────────────────────────────────────────────────────────────────────

export async function createSharedLink(
  input: z.infer<typeof createSharedLinkInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const settings = compact<unknown>({
    requested_visibility: text(input.requestedVisibility),
    audience: text(input.audience),
    access: text(input.access),
    allow_download: input.allowDownload,
    password: text(input.password),
    expires: text(input.expiresAt),
  })

  const payload = await rpc(ctx, 'sharing/create_shared_link_with_settings', {
    body: compact<unknown>({
      path: required(input.path, 'path'),
      settings: Object.keys(settings).length > 0 ? settings : undefined,
    }),
  })
  return { link: mapMetadata(payload) }
}

export async function listSharedLinks(
  input: z.infer<typeof listSharedLinksInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await rpc(ctx, 'sharing/list_shared_links', {
    body: compact<unknown>({
      path: text(input.path),
      cursor: text(input.cursor),
      direct_only: input.directOnly,
    }),
  })
  return {
    links: objectArray(payload.links).map(link => mapMetadata(link)),
    cursor: text(payload.cursor) ?? null,
    hasMore: bool(payload.has_more) ?? false,
  }
}

export async function getSharedLinkMetadata(
  input: z.infer<typeof getSharedLinkMetadataInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await rpc(ctx, 'sharing/get_shared_link_metadata', {
    body: compact<unknown>({
      url: required(input.url, 'url'),
      path: text(input.path),
    }),
  })
  return { link: mapMetadata(payload) }
}

export async function getSharedLinkFile(
  input: z.infer<typeof getSharedLinkFileInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const downloaded = await downloadContent(
    ctx,
    '/sharing/get_shared_link_file',
    compact<unknown>({ url: required(input.url, 'url'), path: text(input.path) }),
    'Dropbox 共享链接下载失败',
  )
  return downloadResult(downloaded, input.fileName, 'get_shared_link_file')
}

export async function modifySharedLink(
  input: z.infer<typeof modifySharedLinkInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 注意字段名与 create 不同:这里是 `link_password`,create 那边是 `password`。
  const settings = compact<unknown>({
    requested_visibility: text(input.requestedVisibility),
    audience: text(input.audience),
    access: text(input.access),
    allow_download: input.allowDownload,
    link_password: text(input.password),
    expires: text(input.expiresAt),
  })

  const payload = await rpc(ctx, 'sharing/modify_shared_link_settings', {
    // 与 create 不同:这里的 settings 即便是空对象也照发(上游如此)。
    body: compact<unknown>({
      url: required(input.url, 'url'),
      settings,
      remove_expiration: input.removeExpiration,
    }),
  })
  return { link: mapMetadata(payload) }
}

export async function revokeSharedLink(
  input: z.infer<typeof revokeSharedLinkInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 这个路由成功时不回内容,故显式允许空响应。
  await rpc(ctx, 'sharing/revoke_shared_link', { body: { url: required(input.url, 'url') }, allowEmptyResponse: true })
  return { revoked: true }
}
