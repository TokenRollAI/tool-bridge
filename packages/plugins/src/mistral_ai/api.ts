/**
 * Mistral AI 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/mistral_ai/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 这个 provider 的 54 个 action **不是 54 段独立逻辑**,而是一张 `{method, path, pathKeys,
 * queryKeys, kind}` 规格表驱动的同一段代码 —— 上游就是这么组织的,照搬:
 * - `pathKeys` 里的入参替换进路径模板并从入参里摘掉;
 * - GET(以及不带 body 的 DELETE)把**剩余全部入参**当 query;POST/PUT/PATCH 只把
 *   `queryKeys` 列出的那几个提成 query,其余进 JSON body;
 * - `kind: 'multipart'` 走 FormData,`kind: 'download'` 走二进制下载。
 *
 * **两处与上游有别,需要人工复核**(见 `download_file` 与 `resolveUpload` 的注释):
 * tool-bridge 没有 open-connector 的 transit file 存储,故依赖它的两条路径改为显式拒绝,
 * 而不是静默降级成一个形状不符出参 schema 的返回值。
 */

import { TBError } from '@tool-bridge/plugin-sdk'
import { assertPublicHttpUrl, guardedFetch } from '../_runtime/guardedFetch'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { readBoundedResponseBytes } from '../_runtime/responseBytes'
import { createProviderHttpClient } from '../_runtime/providerHttp'
import { asJsonObject as toRecord } from '../_runtime/jsonValue'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'mistral_ai'
const API_BASE = 'https://api.mistral.ai'
/** 从 file.url 拉取上传源时的字节上限,照搬上游。 */
const MAX_REMOTE_UPLOAD_BYTES = 100 * 1024 * 1024
const http = createProviderHttpClient({ baseUrl: API_BASE, service: SERVICE })

type Json = Record<string, unknown>
type Method = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'

interface ActionSpec {
  /** DELETE 默认把剩余入参当 query;置 true 则改为发 JSON body。 */
  bodyOnDelete?: boolean
  kind?: 'download' | 'multipart'
  method: Method
  path: string
  /** 要替换进路径模板、并从入参里摘掉的键。 */
  pathKeys?: string[]
  /** 仅对写方法有意义:这几个键提成 query,其余进 body。 */
  queryKeys?: string[]
}

/** action 名 → 端点规格。键集合必须与 schema.ts 的 `mistralAiActions` 完全一致。 */
const SPECS: Record<string, ActionSpec> = {
  list_models: { method: 'GET', path: '/v1/models' },
  get_model: { method: 'GET', path: '/v1/models/{model_id}', pathKeys: ['model_id'] },
  list_conversations: { method: 'GET', path: '/v1/conversations' },
  start_conversation: { method: 'POST', path: '/v1/conversations' },
  get_conversation: { method: 'GET', path: '/v1/conversations/{conversation_id}', pathKeys: ['conversation_id'] },
  delete_conversation: { method: 'DELETE', path: '/v1/conversations/{conversation_id}', pathKeys: ['conversation_id'] },
  append_to_conversation: { method: 'POST', path: '/v1/conversations/{conversation_id}', pathKeys: ['conversation_id'] },
  get_conversation_history: {
    method: 'GET',
    path: '/v1/conversations/{conversation_id}/history',
    pathKeys: ['conversation_id'],
  },
  get_conversation_messages: {
    method: 'GET',
    path: '/v1/conversations/{conversation_id}/messages',
    pathKeys: ['conversation_id'],
  },
  restart_conversation: {
    method: 'POST',
    path: '/v1/conversations/{conversation_id}/restart',
    pathKeys: ['conversation_id'],
  },
  list_agents: { method: 'GET', path: '/v1/agents' },
  create_agent: { method: 'POST', path: '/v1/agents' },
  get_agent: { method: 'GET', path: '/v1/agents/{agent_id}', pathKeys: ['agent_id'] },
  update_agent: { method: 'PATCH', path: '/v1/agents/{agent_id}', pathKeys: ['agent_id'] },
  delete_agent: { method: 'DELETE', path: '/v1/agents/{agent_id}', pathKeys: ['agent_id'] },
  update_agent_version: {
    method: 'PATCH',
    path: '/v1/agents/{agent_id}/version',
    pathKeys: ['agent_id'],
    queryKeys: ['version'],
  },
  list_agent_versions: { method: 'GET', path: '/v1/agents/{agent_id}/versions', pathKeys: ['agent_id'] },
  get_agent_version: {
    method: 'GET',
    path: '/v1/agents/{agent_id}/versions/{version}',
    pathKeys: ['agent_id', 'version'],
  },
  create_or_update_agent_alias: {
    method: 'PUT',
    path: '/v1/agents/{agent_id}/aliases',
    pathKeys: ['agent_id'],
    queryKeys: ['alias', 'version'],
  },
  list_agent_aliases: { method: 'GET', path: '/v1/agents/{agent_id}/aliases', pathKeys: ['agent_id'] },
  create_chat_completion: { method: 'POST', path: '/v1/chat/completions' },
  create_fim_completion: { method: 'POST', path: '/v1/fim/completions' },
  create_agents_completion: { method: 'POST', path: '/v1/agents/completions' },
  create_embeddings: { method: 'POST', path: '/v1/embeddings' },
  create_moderation: { method: 'POST', path: '/v1/moderations' },
  create_chat_moderation: { method: 'POST', path: '/v1/chat/moderations' },
  create_ocr: { method: 'POST', path: '/v1/ocr' },
  create_audio_transcription: { method: 'POST', path: '/v1/audio/transcriptions', kind: 'multipart' },
  list_files: { method: 'GET', path: '/v1/files' },
  upload_file: { method: 'POST', path: '/v1/files', kind: 'multipart' },
  retrieve_file: { method: 'GET', path: '/v1/files/{file_id}', pathKeys: ['file_id'] },
  delete_file: { method: 'DELETE', path: '/v1/files/{file_id}', pathKeys: ['file_id'] },
  download_file: { method: 'GET', path: '/v1/files/{file_id}/content', pathKeys: ['file_id'], kind: 'download' },
  get_file_signed_url: { method: 'GET', path: '/v1/files/{file_id}/url', pathKeys: ['file_id'] },
  get_fine_tuning_jobs: { method: 'GET', path: '/v1/fine_tuning/jobs' },
  list_batch_jobs: { method: 'GET', path: '/v1/batch/jobs' },
  list_libraries: { method: 'GET', path: '/v1/libraries' },
  create_library: { method: 'POST', path: '/v1/libraries' },
  get_library: { method: 'GET', path: '/v1/libraries/{library_id}', pathKeys: ['library_id'] },
  update_library: { method: 'PUT', path: '/v1/libraries/{library_id}', pathKeys: ['library_id'] },
  delete_library: { method: 'DELETE', path: '/v1/libraries/{library_id}', pathKeys: ['library_id'] },
  list_library_documents: {
    method: 'GET',
    path: '/v1/libraries/{library_id}/documents',
    pathKeys: ['library_id'],
  },
  upload_library_document: {
    method: 'POST',
    path: '/v1/libraries/{library_id}/documents',
    pathKeys: ['library_id'],
    kind: 'multipart',
  },
  get_library_document: {
    method: 'GET',
    path: '/v1/libraries/{library_id}/documents/{document_id}',
    pathKeys: ['library_id', 'document_id'],
  },
  update_library_document: {
    method: 'PUT',
    path: '/v1/libraries/{library_id}/documents/{document_id}',
    pathKeys: ['library_id', 'document_id'],
  },
  delete_library_document: {
    method: 'DELETE',
    path: '/v1/libraries/{library_id}/documents/{document_id}',
    pathKeys: ['library_id', 'document_id'],
  },
  get_document_text_content: {
    method: 'GET',
    path: '/v1/libraries/{library_id}/documents/{document_id}/text_content',
    pathKeys: ['library_id', 'document_id'],
  },
  get_document_status: {
    method: 'GET',
    path: '/v1/libraries/{library_id}/documents/{document_id}/status',
    pathKeys: ['library_id', 'document_id'],
  },
  get_document_signed_url: {
    method: 'GET',
    path: '/v1/libraries/{library_id}/documents/{document_id}/signed-url',
    pathKeys: ['library_id', 'document_id'],
  },
  get_document_extracted_text_url: {
    method: 'GET',
    path: '/v1/libraries/{library_id}/documents/{document_id}/extracted-text-signed-url',
    pathKeys: ['library_id', 'document_id'],
  },
  reprocess_document: {
    method: 'POST',
    path: '/v1/libraries/{library_id}/documents/{document_id}/reprocess',
    pathKeys: ['library_id', 'document_id'],
  },
  list_library_shares: { method: 'GET', path: '/v1/libraries/{library_id}/share', pathKeys: ['library_id'] },
  create_library_share: { method: 'PUT', path: '/v1/libraries/{library_id}/share', pathKeys: ['library_id'] },
  delete_library_share: {
    method: 'DELETE',
    path: '/v1/libraries/{library_id}/share',
    pathKeys: ['library_id'],
    bodyOnDelete: true,
  },
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** 递归剔掉 `undefined`;上游 `compactJson` 的等价物(Mistral 把显式 null 当"清空")。 */
function compactJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => compactJson(item))
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, compactJson(child)]),
  )
}

/** query 值:数组重复同名键,对象序列化成 JSON 串(Mistral 的 metadata 过滤就是这么传的)。 */
function appendQuery(url: URL, key: string, value: unknown): void {
  if (value === undefined || value === null) return
  if (Array.isArray(value)) {
    for (const item of value) appendQuery(url, key, item)
    return
  }
  if (typeof value === 'object') {
    url.searchParams.append(key, JSON.stringify(value))
    return
  }
  url.searchParams.append(key, String(value))
}

function appendMultipart(form: FormData, key: string, value: unknown): void {
  if (value === undefined || value === null) return
  if (Array.isArray(value)) {
    for (const item of value) appendMultipart(form, key, item)
    return
  }
  form.append(key, typeof value === 'string'
    ? value
    : (
        typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value)
      ))
}

/** Mistral 的错误文案依次落在 detail / message / error 三处。 */
async function errorMessage(response: Response): Promise<string> {
  const fallback = `mistral_ai request failed with ${response.status}`
  const body = await response.text().catch(() => '')
  if (body.trim() === '') return fallback
  try {
    const payload = toRecord(JSON.parse(body))
    return text(payload?.detail) ?? text(payload?.message) ?? text(payload?.error) ?? fallback
  } catch {
    return body
  }
}

async function assertOk(response: Response): Promise<void> {
  if (response.ok) return
  const message = await errorMessage(response)
  // 上游把 404 与 422 一并压成 400。这里保留 400/422→invalid_argument,但**不压 404**:
  // 共用的 upstreamError 让 404 落 not_found,调用方才能区分"参数不对"和"资源不存在"。
  throw upstreamError(response.status === 422 ? 400 : (response.status || 502), message)
}

/** 响应按 content-type 分流:JSON 解析,其余按文本原样透出。 */
async function readResponse(response: Response): Promise<unknown> {
  if ((response.headers.get('content-type') ?? '').includes('application/json')) {
    try {
      return await response.json()
    } catch {
      throw upstreamError(502, 'mistral_ai returned malformed JSON')
    }
  }
  return await response.text()
}

interface BuiltUrl {
  remaining: Json
  url: string
}

function buildUrl(spec: ActionSpec, input: Json): BuiltUrl {
  const remaining = { ...input }
  let path = spec.path
  for (const key of spec.pathKeys ?? []) {
    const value = remaining[key]
    // schema 已保证这些键必填非空,但 `version` 这类是 string|int 的联合,先统一成串。
    if (value === undefined || value === null || String(value) === '') {
      throw new TBError('invalid_argument', `${key} is required.`)
    }
    path = path.replace(`{${key}}`, encodeURIComponent(String(value)))
    delete remaining[key]
  }

  const url = new URL(path, API_BASE)
  // GET 与"不带 body 的 DELETE"把剩余入参**全部**当 query;写方法只提 queryKeys 那几个。
  const takesAllAsQuery = spec.method === 'GET' || (spec.method === 'DELETE' && spec.bodyOnDelete !== true)
  if (takesAllAsQuery) {
    for (const [key, value] of Object.entries(remaining)) appendQuery(url, key, value)
    return { url: url.toString(), remaining }
  }
  for (const key of spec.queryKeys ?? []) {
    if (key in remaining) {
      appendQuery(url, key, remaining[key])
      delete remaining[key]
    }
  }
  return { url: url.toString(), remaining }
}

interface UploadSource {
  bytes: Uint8Array<ArrayBuffer>
  fileName: string
  mimeType: string
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  let binary: string
  try {
    binary = atob(value)
  } catch {
    throw new TBError('invalid_argument', 'file.content_base64 不是合法的 base64')
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * 边界读取:**边读边计数,超限当场断流**,而不是先整个读进内存再判长度 ——
 * 后者对一个恶意的巨大响应等于没有上限。
 */
async function readBounded(
  response: Response,
  maxBytes: number,
  field: string,
): Promise<Uint8Array<ArrayBuffer>> {
  return readBoundedResponseBytes(response, {
    checkContentLength: false,
    maxBytes,
    tooLarge: () => new TBError('invalid_argument', `${field} 超过 ${maxBytes} 字节上限`),
  })
}

async function resolveUpload(remaining: Json): Promise<UploadSource> {
  const file = toRecord(remaining.file)
  if (file === undefined) throw new TBError('invalid_argument', 'file is required.')

  if (text(file.fileId) !== undefined) {
    // 上游这一支读的是 open-connector 的 transit file 存储(POST /api/files 存下的临时文件)。
    // tool-bridge 没有这层存储,静默降级会让调用方以为传了个空文件,故显式拒绝。
    throw new TBError(
      'invalid_argument',
      'file.fileId(transit file)在 tool-bridge 上不可用,请改用 file.url 或 file.content_base64',
    )
  }

  const fileName = text(file.name)
  if (fileName === undefined) throw new TBError('invalid_argument', 'file.name is required.')
  const mimeType = text(file.mimeType) ?? text(file.mimetype)
  const fileUrl = text(file.url)
  const contentBase64 = text(file.content_base64)

  if (fileUrl !== undefined && contentBase64 !== undefined) {
    throw new TBError('invalid_argument', 'provide only one of file.url or file.content_base64')
  }
  if (contentBase64 !== undefined) {
    return { bytes: decodeBase64(contentBase64), fileName, mimeType: mimeType ?? 'application/octet-stream' }
  }
  if (fileUrl === undefined) {
    throw new TBError('invalid_argument', 'file must include url or content_base64')
  }

  const response = await guardedFetch(fileUrl, { headers: { accept: '*/*' } })
  if (!response.ok) {
    throw upstreamError(response.status >= 500 ? 502 : response.status, `failed to fetch file.url: ${response.status}`)
  }
  return {
    bytes: await readBounded(response, MAX_REMOTE_UPLOAD_BYTES, 'file.url'),
    fileName,
    mimeType: mimeType ?? response.headers.get('content-type') ?? 'application/octet-stream',
  }
}

function authHeaders(ctx: ProviderContext, json: boolean): Record<string, string> {
  const headers: Record<string, string> = { authorization: `Bearer ${requireApiKey(ctx, SERVICE)}` }
  if (json) headers['content-type'] = 'application/json'
  return headers
}

async function executeJson(spec: ActionSpec, input: Json, ctx: ProviderContext): Promise<unknown> {
  const { url, remaining } = buildUrl(spec, input)
  const sendsBody = spec.method === 'POST' || spec.method === 'PUT' || spec.method === 'PATCH'
    || (spec.method === 'DELETE' && spec.bodyOnDelete === true)

  const result = await http.request({
    path: url,
    method: spec.method,
    headers: authHeaders(ctx, true),
    ...(sendsBody ? { json: compactJson(remaining) } : {}),
    responseType: 'auto',
    invalidJsonMessage: 'mistral_ai returned malformed JSON',
    mapError: ({ data, rawText, status }) => {
      const payload = toRecord(data)
      const fallback = `mistral_ai request failed with ${status}`
      const message = text(payload?.detail)
        ?? text(payload?.message)
        ?? text(payload?.error)
        ?? text(rawText)
        ?? fallback
      return upstreamError(status === 422 ? 400 : (status || 502), message)
    },
  })
  // 204 没有 body,但删除类 action 的出参 schema 要一个 `{deleted:true}`。
  if (result.status === 204) return { deleted: true }
  return result.bodyKind === 'empty' ? '' : result.data
}

async function executeMultipart(spec: ActionSpec, input: Json, ctx: ProviderContext): Promise<unknown> {
  const { url, remaining } = buildUrl(spec, input)
  const source = await resolveUpload(remaining)
  const form = new FormData()
  form.set('file', new File([source.bytes], source.fileName, { type: source.mimeType }))
  for (const [key, value] of Object.entries(remaining)) {
    if (key !== 'file') appendMultipart(form, key, value)
  }

  const response = await guardedFetch(url, {
    method: spec.method,
    headers: authHeaders(ctx, false),
    body: form,
  })
  await assertOk(response)
  return await readResponse(response)
}

async function executeAudioTranscription(
  spec: ActionSpec,
  input: Json,
  ctx: ProviderContext,
): Promise<unknown> {
  const { url, remaining } = buildUrl(spec, input)
  const file = toRecord(remaining.file)
  const fileId = text(remaining.file_id)
  const fileUrl = text(file?.url)
  const inline = text(file?.content_base64) ?? text(file?.fileId)

  // 三种音频来源互斥;schema 的 union 只能保证 file 内部单选,挡不住 file 与 file_id 同时给。
  const sources = [fileId, fileUrl, inline].filter(item => item !== undefined).length
  if (sources > 1) {
    throw new TBError(
      'invalid_argument',
      'provide only one of file_id, file.url, file.fileId, or file.content_base64',
    )
  }

  const form = new FormData()
  if (fileId !== undefined) {
    form.set('file_id', fileId)
  } else if (fileUrl !== undefined) {
    // 这个 URL 是**交给 Mistral 去拉**的,不经我们出站,guardedFetch 管不到;
    // 不校验就等于把上游当开放代理打内网(转发型 SSRF),故显式过同一层策略。
    try {
      assertPublicHttpUrl(fileUrl)
    } catch {
      throw new TBError('invalid_argument', 'file.url 必须是公网可达的 http(s) 地址')
    }
    form.set('file_url', fileUrl)
  } else {
    const source = await resolveUpload(remaining)
    form.set('file', new File([source.bytes], source.fileName, { type: source.mimeType }))
  }

  for (const [key, value] of Object.entries(remaining)) {
    if (key !== 'file' && key !== 'file_id') appendMultipart(form, key, value)
  }

  const response = await guardedFetch(url, {
    method: spec.method,
    headers: authHeaders(ctx, false),
    body: form,
  })
  await assertOk(response)
  return await readResponse(response)
}

/**
 * `download_file` 的出参 schema 要求一个存进本地 transit storage 的文件句柄
 * (`content.fileId` / `downloadUrl` / `sizeBytes`)。tool-bridge 没有这层存储,
 * 拿不到可返回的句柄,故 fail closed —— 而不是回一个形状对不上出参 schema 的东西。
 * 需要文件内容的调用方可以改用 `get_file_signed_url`。
 */
function downloadFile(): Promise<never> {
  return Promise.reject(new TBError(
    'unavailable',
    'download_file 需要本地 transit file 存储,tool-bridge 尚未提供;请改用 get_file_signed_url',
    { httpStatus: 501 },
  ))
}

async function execute(name: string, input: Json, ctx: ProviderContext): Promise<unknown> {
  const spec = SPECS[name]!
  // 连接器不转发 SSE:上游流式响应在这条链路上没有承载,给 true 直接拒绝而不是静默降级。
  if (input.stream === true) {
    throw new TBError('invalid_argument', `${name} does not support stream=true in connector actions`)
  }

  if (spec.kind === 'download') return await downloadFile()
  if (name === 'create_audio_transcription') return await executeAudioTranscription(spec, input, ctx)
  if (spec.kind === 'multipart') return await executeMultipart(spec, input, ctx)
  return await executeJson(spec, input, ctx)
}

/**
 * action 名 → handler。由规格表生成,故键集合与 `SPECS` 恒等;
 * `createProviderPlugin` 会再拿它与 schema.ts 的规格表对一次,少一个多一个都在装配期炸。
 */
export const mistralAiHandlers: Record<
  string,
  (input: Json, ctx: ProviderContext) => Promise<unknown>
> = Object.fromEntries(
  Object.keys(SPECS).map(name => [name, (input: Json, ctx: ProviderContext) => execute(name, input, ctx)]),
)
