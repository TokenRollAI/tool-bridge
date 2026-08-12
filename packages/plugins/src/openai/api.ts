/**
 * OpenAI 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/openai/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 与上游的有意偏离:
 * - 上游 `assertOpenAiResponse` 把 404/422 压成 400、把其余非 2xx 压成 502。这里把原始
 *   状态原样交给 `upstreamError`(404 仍是 not_found、409 仍是 conflict),收敛各 provider
 *   互不相同的错误口径正是 `_runtime/upstreamError.ts` 存在的理由。
 * - 上游的 `mode: 'validate'` 分支只服务 `credentialValidators`(把 401/403 说成 400,
 *   因为那是"填错 key"而非"无权")。平台侧的 credentialProbe 自己做这层分账,故不迁。
 * - `node:buffer` 换成 `btoa`/`atob`:插件要能在 Workers 里跑,不依赖 Node 内建模块。
 *
 * 上游三个仍然保留的怪异行为(都是 OpenAI API 本身的形状,不是上游的疏漏):
 * - `stream` / `stream_format` 在 schema 里是合法字段,但连接器只支持非流式,故在本地
 *   拦成 invalid_argument 而不是让上游回一段没人能消费的 SSE。
 * - 音频上传的 `file` 是 url / content_base64 二选一,schema 表达不了,留在这里校验。
 * - 转写接口的数组字段在 multipart 里要带 `[]` 后缀(`include[]`),与 JSON 侧不同名。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  cancelBatchInput,
  createAudioTranscriptionInput,
  createAudioTranslationInput,
  createBatchInput,
  createEmbeddingsInput,
  createImageInput,
  createModerationInput,
  createResponseInput,
  createSpeechInput,
  getBatchInput,
  getInputTokenCountsInput,
  getModelInput,
  getResponseInput,
  listInputItemsInput,
  listModelsInput,
} from './schema'
import { assertPublicHttpUrl, guardedFetch } from '../_runtime/guardedFetch'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'openai'
const API_BASE = 'https://api.openai.com/v1'
/** OpenAI 音频接口本身的上限,提前挡住可以省掉一次 25 MB 的无效上传。 */
const AUDIO_SOURCE_MAX_BYTES = 25 * 1024 * 1024
const AUDIO_SOURCE_FETCH_TIMEOUT_MS = 30_000

type Json = Record<string, unknown>

/** 上游 `optionalString` 的等价物:非字符串、或去空白后为空,都算缺失。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function normalizedContentType(value: string | null, fallback: string): string {
  if (value === null || value === '') return fallback
  return value.split(';', 1)[0]?.trim() || fallback
}

/** 分块喂 `btoa`:一次性 `String.fromCharCode(...bytes)` 会在几 MB 的音频上爆参数上限。 */
function encodeBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function stripPadding(value: string): string {
  let end = value.length
  while (end > 0 && value[end - 1] === '=') end -= 1
  return value.slice(0, end)
}

/**
 * 解码后再编回去比对:`atob` 对某些残缺输入是宽容的,回不到原文就说明调用方给的
 * 不是它以为的那段字节 —— 与其把半截音频发给上游,不如当场说清是哪个字段错了。
 */
function decodeBase64Content(value: string, fieldName: string): Uint8Array<ArrayBuffer> {
  try {
    const binary = atob(value)
    if (binary.length === 0) throw new Error('empty')
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    if (stripPadding(encodeBase64(bytes)) !== stripPadding(value)) throw new Error('mismatch')
    return bytes
  } catch {
    throw new TBError('invalid_argument', `${fieldName} must be valid base64`)
  }
}

function assertAudioSourceSize(byteLength: number, fieldName: string): void {
  if (byteLength > AUDIO_SOURCE_MAX_BYTES) {
    throw new TBError('invalid_argument', `${fieldName} exceeds ${AUDIO_SOURCE_MAX_BYTES} bytes`)
  }
}

function baseHeaders(apiKey: string): Record<string, string> {
  return { accept: 'application/json', authorization: `Bearer ${apiKey}` }
}

function jsonHeaders(apiKey: string): Record<string, string> {
  return { ...baseHeaders(apiKey), 'content-type': 'application/json' }
}

/** OpenAI 的错误体是 `{error:{message}}`,少数边缘错误是顶层 `{message}` 或纯文本。 */
async function errorMessage(response: Response): Promise<string> {
  const fallback = `openai request failed with ${response.status}`
  const body = await response.text().catch(() => '')
  try {
    const payload = JSON.parse(body) as { error?: { message?: unknown }, message?: unknown }
    const message = payload.error?.message ?? payload.message
    if (typeof message === 'string' && message !== '') return message
  } catch {
    // 非 JSON 错误体(网关回的 HTML、空体)走下面的原文兜底。
  }
  return body.trim() || fallback
}

interface RequestInput {
  body?: FormData | Json
  headers?: Record<string, string>
  method?: 'GET' | 'POST'
  path: string
}

async function rawRequest(ctx: ProviderContext, input: RequestInput): Promise<Response> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  let body: BodyInit | undefined
  let headers: Record<string, string>
  if (input.body instanceof FormData) {
    // multipart 的 content-type 必须由运行时带 boundary 生成,手写会让上游解不出分段。
    body = input.body
    headers = input.headers ?? baseHeaders(apiKey)
  } else if (input.body !== undefined) {
    body = JSON.stringify(input.body)
    headers = input.headers ?? jsonHeaders(apiKey)
  } else {
    headers = input.headers ?? baseHeaders(apiKey)
  }

  const method = input.method ?? 'GET'
  let response: Response
  try {
    response = await guardedFetch(`${API_BASE}${input.path}`, { method, headers, body })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障,还丢掉唯一有诊断价值的那句消息。
    const message = error instanceof Error ? error.message : 'unknown network error'
    throw upstreamError(502, `openai ${method} ${input.path} failed before receiving response: ${message}`)
  }

  if (!response.ok) throw upstreamError(response.status, await errorMessage(response))
  return response
}

async function jsonRequest(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  return (await rawRequest(ctx, input)).json()
}

function assertStreamingDisabled(input: { stream?: boolean }): void {
  if (input.stream === true) {
    throw new TBError('invalid_argument', 'stream=true is not supported by connector actions')
  }
}

/** 数组值重复同名键;对象值序列化成 JSON(OpenAI 的 query 约定)。 */
function appendQueryValue(url: URL, key: string, value: unknown): void {
  if (value === undefined || value === null) return
  if (Array.isArray(value)) {
    for (const item of value) appendQueryValue(url, key, item)
    return
  }
  if (typeof value === 'object') {
    url.searchParams.append(key, JSON.stringify(value))
    return
  }
  url.searchParams.append(key, String(value))
}

function withQuery(path: string, query: Json): string {
  const url = new URL(path, API_BASE)
  for (const [key, value] of Object.entries(query)) appendQueryValue(url, key, value)
  return `${url.pathname}${url.search}`
}

/**
 * 边读边计数,超限立刻断流 —— 先 `arrayBuffer()` 再判大小等于把上限交给对端决定,
 * 一个谎报 content-length 的 URL 就能让插件把内存吃干。
 */
async function readBoundedBytes(response: Response, fieldName: string): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isSafeInteger(declared) && declared > 0) assertAudioSourceSize(declared, fieldName)

  if (response.body === null) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    assertAudioSourceSize(bytes.byteLength, fieldName)
    return bytes
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > AUDIO_SOURCE_MAX_BYTES) {
        await reader.cancel().catch(() => undefined)
        assertAudioSourceSize(total, fieldName)
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
  return bytes
}

async function fetchAudioSource(url: string): Promise<Response> {
  // 拉取的是**调用方给的** URL,判定失败属于入参问题(400),不是上游故障。
  try {
    assertPublicHttpUrl(url)
  } catch (error) {
    throw new TBError('invalid_argument', `file.url ${error instanceof Error ? error.message : '不可用'}`)
  }

  let response: Response
  try {
    // 不设超时会让一个挂死的第三方 URL 拖住整个调用;上游同样给了 30s 的独立预算。
    response = await guardedFetch(url, { signal: AbortSignal.timeout(AUDIO_SOURCE_FETCH_TIMEOUT_MS) })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw upstreamError(504, 'failed to fetch audio source: request timed out')
    }
    const message = error instanceof Error ? error.message : 'unknown network error'
    throw upstreamError(502, `failed to fetch audio source: ${message}`)
  }
  if (!response.ok) throw upstreamError(502, `failed to fetch audio source: ${response.status}`)
  return response
}

interface UploadSource {
  bytes: Uint8Array<ArrayBuffer>
  fileName: string
  mimeType: string
}

type AudioInput
  = | z.infer<typeof createAudioTranscriptionInput>
    | z.infer<typeof createAudioTranslationInput>

async function resolveAudioUploadSource(input: AudioInput): Promise<UploadSource> {
  const file = input.file
  const fileUrl = text(file.url)
  const contentBase64 = text(file.content_base64)
  const mimeType = text(file.mimetype)

  // url 与 content_base64 是"恰好一个"的关系;schema 只能各自标 optional,故留在这里判。
  if (fileUrl === undefined && contentBase64 === undefined) {
    throw new TBError('invalid_argument', 'file.url or file.content_base64 is required')
  }
  if (fileUrl !== undefined && contentBase64 !== undefined) {
    throw new TBError('invalid_argument', 'provide only one of file.url or file.content_base64')
  }

  if (fileUrl !== undefined) {
    const response = await fetchAudioSource(fileUrl)
    return {
      bytes: await readBoundedBytes(response, 'file.url'),
      fileName: file.name,
      mimeType: normalizedContentType(response.headers.get('content-type'), mimeType ?? 'application/octet-stream'),
    }
  }

  const bytes = decodeBase64Content(contentBase64!, 'file.content_base64')
  assertAudioSourceSize(bytes.byteLength, 'file.content_base64')
  return { bytes, fileName: file.name, mimeType: mimeType ?? 'application/octet-stream' }
}

function appendMultipartField(formData: FormData, key: string, value: unknown): void {
  if (value === undefined || value === null) return
  if (typeof value === 'string') {
    formData.append(key, value)
    return
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    formData.append(key, String(value))
    return
  }
  formData.append(key, JSON.stringify(value))
}

async function buildAudioFormData(
  input: AudioInput,
  arrayFieldMap: Record<string, string> = {},
): Promise<FormData> {
  const source = await resolveAudioUploadSource(input)
  const formData = new FormData()
  formData.set('file', new File([source.bytes], source.fileName, { type: source.mimeType }))

  for (const [key, value] of Object.entries(input)) {
    if (key === 'file' || value === undefined || value === null) continue
    if (Array.isArray(value)) {
      const targetKey = arrayFieldMap[key] ?? key
      for (const item of value) appendMultipartField(formData, targetKey, item)
      continue
    }
    appendMultipartField(formData, key, value)
  }
  return formData
}

/** 转写/翻译可以要求 `response_format: 'text'|'srt'|'vtt'`,那时回的不是 JSON。 */
async function readJsonOrTextResponse(response: Response): Promise<unknown> {
  if (normalizedContentType(response.headers.get('content-type'), '') === 'application/json') {
    return response.json()
  }
  return { text: await response.text() }
}

function inferSpeechContentType(responseFormat: unknown): string {
  switch (responseFormat) {
    case 'wav': return 'audio/wav'
    case 'opus': return 'audio/opus'
    case 'aac': return 'audio/aac'
    case 'flac': return 'audio/flac'
    case 'pcm': return 'audio/pcm'
    default: return 'audio/mpeg'
  }
}

export async function listModels(
  _input: z.infer<typeof listModelsInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return jsonRequest(ctx, { path: '/models' })
}

export async function getModel(
  input: z.infer<typeof getModelInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return jsonRequest(ctx, { path: `/models/${encodeURIComponent(input.model)}` })
}

export async function createResponse(
  input: z.infer<typeof createResponseInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  assertStreamingDisabled(input)
  return jsonRequest(ctx, { method: 'POST', path: '/responses', body: input })
}

export async function getResponse(
  input: z.infer<typeof getResponseInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return jsonRequest(ctx, {
    path: withQuery(`/responses/${encodeURIComponent(input.response_id)}`, { include: input.include }),
  })
}

export async function listInputItems(
  input: z.infer<typeof listInputItemsInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return jsonRequest(ctx, {
    path: withQuery(`/responses/${encodeURIComponent(input.response_id)}/input_items`, {
      after: input.after,
      include: input.include,
      limit: input.limit,
      order: input.order,
    }),
  })
}

export async function getInputTokenCounts(
  input: z.infer<typeof getInputTokenCountsInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return jsonRequest(ctx, { method: 'POST', path: '/responses/input_tokens', body: input })
}

export async function createEmbeddings(
  input: z.infer<typeof createEmbeddingsInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return jsonRequest(ctx, { method: 'POST', path: '/embeddings', body: input })
}

export async function createModeration(
  input: z.infer<typeof createModerationInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return jsonRequest(ctx, { method: 'POST', path: '/moderations', body: input })
}

export async function createImage(
  input: z.infer<typeof createImageInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  assertStreamingDisabled(input)
  return jsonRequest(ctx, { method: 'POST', path: '/images/generations', body: input })
}

export async function createSpeech(
  input: z.infer<typeof createSpeechInput>,
  ctx: ProviderContext,
): Promise<{ content_base64: string, content_type: string }> {
  if (input.stream_format === 'sse') {
    throw new TBError('invalid_argument', 'stream_format=sse is not supported by connector actions')
  }
  const response = await rawRequest(ctx, {
    method: 'POST',
    path: '/audio/speech',
    body: input,
    // 语音接口回的是音频字节,accept 必须放开,否则上游会按 JSON 协商拒绝。
    headers: { ...jsonHeaders(requireApiKey(ctx, SERVICE)), accept: '*/*' },
  })

  return {
    content_base64: encodeBase64(new Uint8Array(await response.arrayBuffer())),
    content_type: normalizedContentType(
      response.headers.get('content-type'),
      inferSpeechContentType(input.response_format),
    ),
  }
}

export async function createAudioTranscription(
  input: z.infer<typeof createAudioTranscriptionInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  assertStreamingDisabled(input)
  const response = await rawRequest(ctx, {
    method: 'POST',
    path: '/audio/transcriptions',
    body: await buildAudioFormData(input, {
      include: 'include[]',
      timestamp_granularities: 'timestamp_granularities[]',
    }),
  })
  return readJsonOrTextResponse(response)
}

export async function createAudioTranslation(
  input: z.infer<typeof createAudioTranslationInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  const response = await rawRequest(ctx, {
    method: 'POST',
    path: '/audio/translations',
    body: await buildAudioFormData(input),
  })
  return readJsonOrTextResponse(response)
}

export async function createBatch(
  input: z.infer<typeof createBatchInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return jsonRequest(ctx, { method: 'POST', path: '/batches', body: input })
}

export async function getBatch(
  input: z.infer<typeof getBatchInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return jsonRequest(ctx, { path: `/batches/${encodeURIComponent(input.batch_id)}` })
}

export async function cancelBatch(
  input: z.infer<typeof cancelBatchInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return jsonRequest(ctx, { method: 'POST', path: `/batches/${encodeURIComponent(input.batch_id)}/cancel` })
}
