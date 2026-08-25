/**
 * Memos 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/memos/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。凭证走 **header**(`authorization: Bearer <personal access token>`),
 * 不进 URL。
 *
 * Memos 只有**自建实例**,故实例地址是必配项。上游把 `baseUrl` 放在 api_key 的 `extraFields`
 * (`required: true`、`secret: false`),这里落在 **`providerConfig`(`ctx.config.baseUrl`)**
 * —— 按四条凭证通道的分界,base URL override 不是密钥,不该占 secret 通道(同 `outline`
 * 与 `grafana`)。
 *
 * 六处上游细节决定了这里的形状:
 * - **`baseUrl` 要补 `/api/v1`**:用户多半照着浏览器地址栏填 `https://memos.example.com`,
 *   少了这段每个请求都 404。已经以 `/api/v1` 结尾就不重复补。同时拒绝 URL 里带凭证
 *   (`https://user:pass@host`)—— 那会让凭证进日志。
 * - **资源名是 AIP 风格的 `memos/{id}` / `attachments/{id}` / `users/{id}`**,不是裸 id。
 *   `resourcePath()` 校验"恰好两段、集合名对得上、第二段不是 `.` / `..`"再逐段 encode ——
 *   这是**路径穿越**的闸门:`memos/../users/1` 若原样拼进 URL 就越出了资源边界。
 * - **`update_memo` 是 field mask 语义**:改哪些字段由 `updateMask` query 决定,按**键在不在**
 *   算(不是"值是否 undefined"),故显式给 `location: null` 表示"抹掉位置"。mask 名要转
 *   snake_case(`createTime` → `create_time`),转错的字段会被 Memos 静默忽略。
 * - **`upload_attachment` 是"取回再转发"**:先按 `fileUrl` 下载(同样走 `guardedFetch`,
 *   URL 来自调用方,是最典型的 SSRF 入口),再 base64 塞进 JSON body。下载**有 20 MiB 上限**
 *   且边读边计数 —— 插件与网关同进程,不设上限等于让调用方用一个大文件把网关的内存吃掉。
 * - **列表出参的 `nextPageToken` 缺席时给 `null`**(不是丢键):出参 schema 声明的就是 nullable,
 *   `null` 明确表示"没有下一页"。
 * - **`get_current_user` 期望 `{user: {...}}` 信封**:上游就是这么读的,照抄。若某个 Memos 版本
 *   把 user 放在顶层,这里会归成 `unavailable`("响应缺 user")而不是编一个空对象 ——
 *   把版本不符报成故障比静默返回半个结果好。
 *
 * 与上游的有意偏离:
 * - 上游 `mapMemosHttpError` 把 403/404/409/422 一律压成 400、把 5xx 压成 502。这里把原始状态
 *   交给 `upstreamError`(403 仍是 permission_denied、404 仍是 not_found、409 仍是 conflict),
 *   收敛各 provider 互不相同的错误口径正是 `_runtime/upstreamError.ts` 存在的理由。
 * - 上游的 `phase: 'validate'` 分支只服务 `credentialValidators`,平台侧的 credentialProbe
 *   自己做这层分账,故不迁。
 * - 上游用 `node:buffer` 做 base64,这里换成 `btoa`(分块喂)—— 插件要能在 Workers 里跑。
 * - 不发 `user-agent`:上游那个值标识的是 open-connector 进程,在这里已无意义。
 * - 上游按超时/`AbortError` 把传输失败分成 504/502;本地没有 signal 可传,那条分支不可达,
 *   故只保留 502。
 * - **http 的 baseUrl 仍然放行**(上游明确支持 "HTTP or HTTPS"),但 PAT 会以明文过链路;
 *   与 `outline` / `grafana` 强制 https 不同,那两家上游自己就要求 https。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createMemoInput,
  deleteAttachmentInput,
  deleteMemoInput,
  getAttachmentInput,
  getCurrentUserInput,
  getMemoInput,
  getUserInput,
  listAttachmentsInput,
  listMemoAttachmentsInput,
  listMemosInput,
  listUsersInput,
  setMemoAttachmentsInput,
  uploadAttachmentInput,
} from './schema'
import type { updateMemoInput } from './schema.handwritten'
import { compactDefined as compact, asJsonObject as record, trimmedText as text } from '../_runtime/jsonValue'
import { createProviderHttpClient, type ProviderQuery } from '../_runtime/providerHttp'
import { assertPublicHttpUrl, guardedFetch } from '../_runtime/guardedFetch'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'memos'
/** Memos 的 REST 前缀;`baseUrl` 没带就补上。 */
const API_SUFFIX = '/api/v1'
/** 附件下载上限(上游同值)。插件与网关同进程,这个上限是内存保护,不是礼貌。 */
const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024
/** `String.fromCharCode(...chunk)` 的分块大小:整块展开会爆调用栈。 */
const BASE64_CHUNK = 8192
const http = createProviderHttpClient({ service: SERVICE })

type Collection = 'attachments' | 'memos' | 'users'
type Json = Record<string, unknown>
type Method = 'DELETE' | 'GET' | 'PATCH' | 'POST'
type QueryValue = boolean | number | string | undefined

/** `update_memo` 的可改字段 → Memos 的 field mask 名(mask 用 snake_case)。 */
const UPDATE_MASKS: ReadonlyArray<readonly [string, string]> = [
  ['content', 'content'],
  ['visibility', 'visibility'],
  ['pinned', 'pinned'],
  ['state', 'state'],
  ['createTime', 'create_time'],
  ['location', 'location'],
]

/** 这次调用要打的实例与用的凭证。 */
interface Target {
  apiKey: string
  baseUrl: string
}

/** 上游 `requiredInputString`:schema 的 `min(n)` 放过纯空白串,必填断言落在这层。 */
function requireText(value: unknown, field: string): string {
  const result = text(value)
  if (result === undefined) throw new TBError('invalid_argument', `${field} is required.`)
  return result
}

/** 上游回的形状不符合契约 —— 是上游的问题,不是调用方的错。 */
function responseError(message: string): TBError {
  return new TBError('unavailable', message, { retryable: true })
}

function requireResponseObject(value: unknown, operation: string): Json {
  const object = record(value)
  if (object === undefined) throw responseError(`Memos ${operation} response did not include an object`)
  return object
}

function requireResponseObjects(value: unknown, operation: string): Json[] {
  if (!Array.isArray(value)) throw responseError(`Memos ${operation} response did not include an array`)
  return value.map(item => requireResponseObject(item, operation))
}

/** 配置错误(providerConfig.baseUrl 不合规):调用方要改配置,重试没有意义。 */
function configError(message: string): TBError {
  return new TBError('invalid_argument', `${SERVICE} 的 baseUrl ${message}`)
}

/**
 * 归一挂载配置里的实例地址:去掉 query / hash / 末尾斜杠,不以 `/api/v1` 结尾就补上。
 *
 * 自建实例若只有内网地址,`assertPublicHttpUrl` 会拒 —— 插件与网关同进程,放行等于把网关
 * 变成打内网的跳板(SSRF)。
 */
function resolveBaseUrl(ctx: ProviderContext): string {
  const configured = ctx.config?.baseUrl
  if (configured !== undefined && typeof configured !== 'string') throw configError('必须是字符串')
  const candidate = text(configured)
  if (candidate === undefined) {
    throw configError(
      '是必配项:给挂载节点配 providerConfig.baseUrl 指向你的 Memos 实例'
      + '(如 https://memos.example.com)。Memos 只有自建实例,没有公共缺省地址',
    )
  }

  let url: URL
  try {
    url = assertPublicHttpUrl(candidate)
  } catch (error) {
    const detail = error instanceof Error ? error.message : '不可用'
    throw configError(
      `不可用(${detail})。自建 Memos 必须是**公网可达**的地址:`
      + '插件与网关同进程,指向内网或保留地址会被出站校验拒绝',
    )
  }
  // URL 里带凭证会跟着日志与错误消息漏出去,而且 Memos 根本不认这种认证。
  if (url.username !== '' || url.password !== '') throw configError('不能带用户名/密码')

  url.search = ''
  url.hash = ''
  const path = url.pathname.replace(/\/+$/, '')
  const normalized = `${url.origin}${path}`
  return normalized.endsWith(API_SUFFIX) ? normalized : `${normalized}${API_SUFFIX}`
}

function resolveTarget(ctx: ProviderContext): Target {
  // 两者都抛配置错误,放在传输 try 外面,不该被 502 兜底吞掉。
  return { apiKey: requireApiKey(ctx, SERVICE), baseUrl: resolveBaseUrl(ctx) }
}

/**
 * 把 AIP 资源名(`memos/{id}`)转成请求路径,顺带把它当**输入校验**用。
 *
 * 恰好两段、集合名对得上、第二段非空且不是 `.` / `..` —— 少了这层,`memos/../users/1`
 * 会原样拼进 URL,一次读备注的调用就越权读到了用户。
 */
function resourcePath(name: string, collection: Collection): string {
  const segments = name.split('/')
  const id = segments[1]
  if (segments.length !== 2 || segments[0] !== collection || id === undefined || id === ''
    || id === '.' || id === '..') {
    throw new TBError('invalid_argument', `name must use the ${collection}/{id} resource format`)
  }
  return `/${collection}/${encodeURIComponent(id)}`
}

/** Memos 的错误消息就一个 `message` 键(gRPC-gateway 的形状);非 JSON 体则是整段文本。 */
function errorMessage(payload: unknown): string {
  const direct = text(payload)
  if (direct !== undefined) return direct
  return text(record(payload)?.message) ?? 'Memos request failed'
}

interface RequestInput {
  body?: Json
  method?: Method
  path: string
  query?: Record<string, QueryValue>
}

async function request(target: Target, input: RequestInput): Promise<unknown> {
  const result = await http.request({
    baseUrl: `${target.baseUrl}/`,
    path: input.path,
    method: input.method ?? 'GET',
    query: Object.entries(input.query ?? {}) satisfies ProviderQuery,
    headers: { accept: 'application/json', authorization: `Bearer ${target.apiKey}` },
    ...(input.body === undefined ? {} : { json: input.body }),
    invalidJsonMessage: 'Memos returned invalid JSON',
    mapError: ({ data, status }) => upstreamError(status, errorMessage(data)),
    mapTransportError: ({ message }) => upstreamError(
      502,
      `Memos ${input.path} request failed: ${message ?? 'unknown network error'}`,
    ),
  })
  return result.data === undefined ? null : result.data
}

/** 上游 `readBoundedResponseBytes`:边读边计数,超限就地掐断,不把整个响应先收下来。 */
async function readBoundedBytes(response: Response): Promise<Uint8Array> {
  const tooLarge = (): TBError => new TBError(
    'invalid_argument',
    `fileUrl 指向的文件超过 ${ATTACHMENT_MAX_BYTES} 字节的上限`,
  )
  // 上游声明的长度可信就先用它挡掉,省得白下载一遍。
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > ATTACHMENT_MAX_BYTES) throw tooLarge()

  const body = response.body
  if (body === null) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > ATTACHMENT_MAX_BYTES) throw tooLarge()
    return bytes
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > ATTACHMENT_MAX_BYTES) {
      await reader.cancel()
      throw tooLarge()
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/** 分块喂 `btoa`:一次性展开 20 MiB 会爆调用栈。 */
function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK))
  }
  return btoa(binary)
}

interface AttachmentSource {
  bytes: Uint8Array
  mimeType: string
}

/**
 * 按调用方给的 URL 取回文件。
 *
 * `fileUrl` 来自调用方,是最典型的 SSRF 入口,故同样走 `guardedFetch`(逐跳校验 + 跨源剥
 * 凭证)。注意这一跳**不带 Memos 的凭证** —— 它打的是第三方地址。
 */
async function downloadAttachment(fileUrl: string, declaredType: string | undefined): Promise<AttachmentSource> {
  let response: Response
  try {
    response = await guardedFetch(fileUrl, { method: 'GET' })
  } catch (error) {
    if (error instanceof TBError) throw error
    const detail = error instanceof Error ? error.message : 'unknown network error'
    throw upstreamError(502, `failed to fetch fileUrl: ${detail}`)
  }
  if (!response.ok) throw upstreamError(502, `failed to fetch fileUrl: ${response.status}`)

  const bytes = await readBoundedBytes(response)
  // 调用方给的 type 优先(它知道自己要存什么),再退回响应头,最后兜底二进制流。
  const responseType = text(response.headers.get('content-type')?.split(';', 1)[0])
  return { bytes, mimeType: declaredType ?? responseType ?? 'application/octet-stream' }
}

export async function createMemo(input: z.infer<typeof createMemoInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(resolveTarget(ctx), {
    method: 'POST',
    path: '/memos',
    // memoId 是**query** 参数而不是 body 字段(Memos 的 AIP 风格:资源 id 走 query)。
    query: compact({ memoId: text(input.memoId) }),
    body: compact({
      content: input.content,
      visibility: text(input.visibility),
      createTime: text(input.createTime),
      pinned: input.pinned,
      location: input.location,
    }),
  })
  return { memo: requireResponseObject(payload, 'create memo') }
}

export async function listMemos(input: z.infer<typeof listMemosInput>, ctx: ProviderContext): Promise<Json> {
  const payload = requireResponseObject(await request(resolveTarget(ctx), {
    path: '/memos',
    query: compact({
      pageSize: input.pageSize,
      pageToken: text(input.pageToken),
      state: text(input.state),
      orderBy: text(input.orderBy),
      filter: text(input.filter),
      showDeleted: input.showDeleted,
    }),
  }), 'list memos')
  return {
    // 一页都没有时 Memos 干脆不给 `memos` 键,补成空数组;非数组则是上游坏了。
    memos: requireResponseObjects(payload.memos ?? [], 'list memos'),
    nextPageToken: text(payload.nextPageToken) ?? null,
  }
}

export async function getMemo(input: z.infer<typeof getMemoInput>, ctx: ProviderContext): Promise<Json> {
  const path = resourcePath(requireText(input.name, 'name'), 'memos')
  const payload = await request(resolveTarget(ctx), { path })
  return { memo: requireResponseObject(payload, 'get memo') }
}

export async function updateMemo(input: z.infer<typeof updateMemoInput>, ctx: ProviderContext): Promise<Json> {
  const name = requireText(input.name, 'name')
  // 按**键在不在**算 mask:显式给 `location: null` 是"抹掉位置",与不传 location 不是一回事。
  const updateMask = UPDATE_MASKS
    .filter(([field]) => Object.hasOwn(input, field))
    .map(([, mask]) => mask)
  // schema 的 refine 已经拦过一次;这层是它被改宽时的最后一道闸(空 mask 打过去是一次空更新)。
  if (updateMask.length === 0) {
    throw new TBError('invalid_argument', 'Provide at least one memo field to update.')
  }

  const payload = await request(resolveTarget(ctx), {
    method: 'PATCH',
    path: resourcePath(name, 'memos'),
    query: { updateMask: updateMask.join(',') },
    body: compact({
      name,
      content: input.content,
      visibility: input.visibility,
      pinned: input.pinned,
      state: input.state,
      createTime: input.createTime,
      location: input.location,
    }),
  })
  return { memo: requireResponseObject(payload, 'update memo') }
}

export async function deleteMemo(input: z.infer<typeof deleteMemoInput>, ctx: ProviderContext): Promise<Json> {
  const name = requireText(input.name, 'name')
  await request(resolveTarget(ctx), {
    method: 'DELETE',
    path: resourcePath(name, 'memos'),
    query: compact({ force: input.force }),
  })
  return { deleted: true, name }
}

export async function uploadAttachment(
  input: z.infer<typeof uploadAttachmentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const target = resolveTarget(ctx)
  const source = await downloadAttachment(requireText(input.fileUrl, 'fileUrl'), text(input.type))
  const payload = await request(target, {
    method: 'POST',
    path: '/attachments',
    query: compact({ attachmentId: text(input.attachmentId) }),
    body: compact({
      filename: requireText(input.filename, 'filename'),
      content: base64(source.bytes),
      type: source.mimeType,
      memo: text(input.memo),
    }),
  })
  return { attachment: requireResponseObject(payload, 'upload attachment') }
}

export async function listAttachments(
  input: z.infer<typeof listAttachmentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = requireResponseObject(await request(resolveTarget(ctx), {
    path: '/attachments',
    query: compact({
      pageSize: input.pageSize,
      pageToken: text(input.pageToken),
      filter: text(input.filter),
      orderBy: text(input.orderBy),
    }),
  }), 'list attachments')
  return {
    attachments: requireResponseObjects(payload.attachments ?? [], 'list attachments'),
    nextPageToken: text(payload.nextPageToken) ?? null,
  }
}

export async function getAttachment(input: z.infer<typeof getAttachmentInput>, ctx: ProviderContext): Promise<Json> {
  const path = resourcePath(requireText(input.name, 'name'), 'attachments')
  const payload = await request(resolveTarget(ctx), { path })
  return { attachment: requireResponseObject(payload, 'get attachment') }
}

export async function deleteAttachment(
  input: z.infer<typeof deleteAttachmentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const name = requireText(input.name, 'name')
  await request(resolveTarget(ctx), { method: 'DELETE', path: resourcePath(name, 'attachments') })
  return { deleted: true, name }
}

export async function listMemoAttachments(
  input: z.infer<typeof listMemoAttachmentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const name = requireText(input.name, 'name')
  const payload = requireResponseObject(await request(resolveTarget(ctx), {
    path: `${resourcePath(name, 'memos')}/attachments`,
    query: compact({ pageSize: input.pageSize, pageToken: text(input.pageToken) }),
  }), 'list memo attachments')
  return {
    attachments: requireResponseObjects(payload.attachments ?? [], 'list memo attachments'),
    nextPageToken: text(payload.nextPageToken) ?? null,
  }
}

export async function setMemoAttachments(
  input: z.infer<typeof setMemoAttachmentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const name = requireText(input.name, 'name')
  const attachmentNames = input.attachmentNames.map(item => requireText(item, 'attachmentNames'))
  // 只为**校验**跑一遍:每个附件名都要是合法的 `attachments/{id}`,坏名字在这里就拒,
  // 而不是让 Memos 收下一半再报错(这个 PATCH 是整集合替换,半成品状态最难善后)。
  for (const attachmentName of attachmentNames) resourcePath(attachmentName, 'attachments')

  await request(resolveTarget(ctx), {
    method: 'PATCH',
    path: `${resourcePath(name, 'memos')}/attachments`,
    body: { name, attachments: attachmentNames.map(attachmentName => ({ name: attachmentName })) },
  })
  return { updated: true, name, attachmentNames }
}

export async function getCurrentUser(
  _input: z.infer<typeof getCurrentUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = requireResponseObject(await request(resolveTarget(ctx), { path: '/auth/me' }), 'get current user')
  return { user: requireResponseObject(payload.user, 'get current user') }
}

export async function listUsers(input: z.infer<typeof listUsersInput>, ctx: ProviderContext): Promise<Json> {
  const payload = requireResponseObject(await request(resolveTarget(ctx), {
    path: '/users',
    query: compact({
      pageSize: input.pageSize,
      pageToken: text(input.pageToken),
      filter: text(input.filter),
      showDeleted: input.showDeleted,
    }),
  }), 'list users')
  return {
    users: requireResponseObjects(payload.users ?? [], 'list users'),
    nextPageToken: text(payload.nextPageToken) ?? null,
  }
}

export async function getUser(input: z.infer<typeof getUserInput>, ctx: ProviderContext): Promise<Json> {
  const path = resourcePath(requireText(input.name, 'name'), 'users')
  const payload = await request(resolveTarget(ctx), {
    path,
    query: compact({ readMask: text(input.readMask) }),
  })
  return { user: requireResponseObject(payload, 'get user') }
}
