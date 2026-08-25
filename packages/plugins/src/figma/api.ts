/**
 * Figma 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/figma/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 凭证走 **`X-Figma-Token` 请求头**,不进 URL。上游同时支持 personal access token
 * (`X-Figma-Token`)与 OAuth(`authorization: Bearer`),两种认证的**头不一样**;本次迁移
 * 只落 PAT 这一种 —— OAuth 要等平台侧的 providerOAuth 就绪,那时才有办法在运行期区分。
 * 拿 OAuth access token 配到这里会稳定 403,不会静默走错路。
 *
 * 四处上游细节决定了这里的形状:
 * - 多个 node id 是**逗号拼成一个 `ids` 参数**发的,不是重复同名参数;拼之前逐项去空白、
 *   丢空项,全空则该参数不发(必填的那几个 action 则本地报错)。
 * - 响应体解析不出 JSON 时**保留原文字符串**当 payload —— Figma 的错误消息有时就是纯文本,
 *   丢掉它错误就只剩一个状态码。
 * - 错误消息在 `message` / `err` / `error` / `status` / `error.message` / `error.detail`
 *   六个位置之一,按这个顺序找(Figma 各端点不统一)。
 * - 出参不是原样透传:各 action 取自己那一族(`comments` / `meta.components` / `dev_resources`…)
 *   并同时带上 `raw`,形状不合契约就报 unavailable 而不是把半个响应发下去。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createDevResourcesInput,
  deleteCommentInput,
  deleteCommentReactionInput,
  deleteDevResourceInput,
  getComponentInput,
  getComponentSetInput,
  getDevResourcesInput,
  getFileInput,
  getFileMetadataInput,
  getFileNodesInput,
  getImageFillsInput,
  getProjectMetadataInput,
  getStyleInput,
  listCommentReactionsInput,
  listCommentsInput,
  listFileComponentSetsInput,
  listFileComponentsInput,
  listFileStylesInput,
  listFileVersionsInput,
  listProjectFilesInput,
  listTeamProjectsInput,
  postCommentInput,
  postCommentReactionInput,
  renderImagesInput,
} from './schema'
import type { updateDevResourcesInput } from './schema.handwritten'
import { compactDefined as compact, asJsonObject as record, trimmedText as text } from '../_runtime/jsonValue'
import { createProviderHttpClient, type ProviderQuery } from '../_runtime/providerHttp'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'figma'
const API_BASE = 'https://api.figma.com'
const http = createProviderHttpClient({ baseUrl: API_BASE, service: SERVICE })

type Json = Record<string, unknown>
type QueryValue = boolean | number | string | undefined

interface RequestInput {
  body?: Json
  method?: 'DELETE' | 'GET' | 'POST' | 'PUT'
  path: string
  query?: Record<string, QueryValue>
}

/**
 * 上游 `readInputString`:去空白后必须非空。
 *
 * Zod 的 `min(1)` 拦不住纯空白串,而纯空白的 fileKey 拼进路径就是一次必然 404 的调用,
 * 故这层必须保留。
 */
function requireInput(value: string, field: string): string {
  const result = text(value)
  if (result === undefined) throw new TBError('invalid_argument', `${field} 不能是空白`)
  return result
}

/** 上游 `joinOptionalStringArray`:逐项去空白、丢空,逗号拼成一个参数值;全空则不发。 */
function joinIds(value: string[] | undefined): string | undefined {
  if (value === undefined) return undefined
  const joined = value.map(item => item.trim()).filter(item => item !== '').join(',')
  return joined === '' ? undefined : joined
}

/** 上游 `joinRequiredStringArray`:同上,但全空是调用方的错。 */
function requireIds(value: string[], field: string): string {
  const joined = joinIds(value)
  if (joined === undefined) throw new TBError('invalid_argument', `${field} 至少要有一个非空项`)
  return joined
}

/** 契约说好是对象;不是就是上游出问题,不是调用方的错。 */
function requireRecord(value: unknown, label: string): Json {
  const result = record(value)
  if (result === undefined) throw new TBError('unavailable', `${label}不是对象`, { retryable: true })
  return result
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TBError('unavailable', `${label}不是数组`, { retryable: true })
  return value
}

/** Figma 的错误消息散在六个位置,按上游的顺序找。payload 是纯文本时它本身就是消息。 */
function errorMessage(payload: unknown, status: number): string {
  if (typeof payload === 'string') return text(payload) ?? `Figma 返回 HTTP ${status}`
  const body = record(payload)
  const error = record(body?.error)
  return text(body?.message)
    ?? text(body?.err)
    ?? text(body?.error)
    ?? text(body?.status)
    ?? text(error?.message)
    ?? text(error?.detail)
    ?? `Figma 返回 HTTP ${status}`
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  const hasBody = input.body !== undefined
  const { data } = await http.request({
    path: input.path,
    method: input.method ?? 'GET',
    query: Object.entries(input.query ?? {}) satisfies ProviderQuery,
    headers: {
      'accept': 'application/json',
      'x-figma-token': requireApiKey(ctx, SERVICE),
    },
    ...(hasBody ? { json: input.body } : {}),
    // Figma 的错误消息有时是纯文本；成功响应也保留旧实现的原文 payload 语义。
    invalidJson: 'text',
    mapError: ({ data: payload, status }) => upstreamError(status, errorMessage(payload, status)),
    mapTransportError: () => new TBError('unavailable', 'Figma 请求失败', { retryable: true }),
  })
  return data ?? null
}

/** 多个读接口共用的文件级 query(版本、节点、深度…)。 */
function fileQuery(input: {
  branchData?: boolean
  depth?: number
  geometry?: string
  nodeIds?: string[]
  pluginData?: string[]
  version?: string
}): Record<string, QueryValue> {
  return compact({
    version: text(input.version),
    ids: joinIds(input.nodeIds),
    depth: input.depth,
    geometry: text(input.geometry),
    plugin_data: joinIds(input.pluginData),
    branch_data: input.branchData,
  }) as Record<string, QueryValue>
}

/** `/v1/files/<key>/components|component_sets|styles` 三个接口是同一形状。 */
async function libraryItems(
  ctx: ProviderContext,
  path: string,
  itemField: string,
): Promise<Json> {
  const raw = requireRecord(await request(ctx, { path }), 'Figma 库列表响应')
  const meta = requireRecord(raw.meta, 'Figma 库列表的 meta')
  return {
    items: requireArray(meta[itemField], `Figma ${itemField} 列表`),
    // 上游把游标放在 meta.cursor;没有就给空对象,免得消费者要区分"没有"与"没分页"。
    pagination: record(meta.cursor) ?? {},
    raw,
  }
}

/** `/v1/components|component_sets|styles/<key>` 三个接口是同一形状。 */
async function libraryItem(ctx: ProviderContext, path: string): Promise<Json> {
  const raw = requireRecord(await request(ctx, { path }), 'Figma 库条目响应')
  return {
    item: requireRecord(raw.meta, 'Figma 库条目的 meta'),
    raw,
  }
}

/** create 与 update 的响应形状一致,只有"哪一族有内容"不同。 */
function devResourceMutation(payload: unknown, field: 'links_created' | 'links_updated'): Json {
  const raw = requireRecord(payload, 'Figma dev resource 变更响应')
  const links = requireArray(raw[field], `Figma ${field}`)
  return {
    linksCreated: field === 'links_created' ? links : [],
    linksUpdated: field === 'links_updated' ? links : [],
    // errors 不是数组就当没有:上游对这一项容忍,它是附带信息不是主结果。
    errors: Array.isArray(raw.errors) ? raw.errors : [],
    raw,
  }
}

function filePath(fileKey: string, suffix = ''): string {
  return `/v1/files/${encodeURIComponent(requireInput(fileKey, 'fileKey'))}${suffix}`
}

function commentPath(fileKey: string, commentId: string, suffix = ''): string {
  return `${filePath(fileKey, '/comments')}/${encodeURIComponent(requireInput(commentId, 'commentId'))}${suffix}`
}

export async function getCurrentUser(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return { user: requireRecord(await request(ctx, { path: '/v1/me' }), 'Figma 当前用户响应') }
}

export async function getFileMetadata(
  input: z.infer<typeof getFileMetadataInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, { path: filePath(input.fileKey, '/meta') })
  return { metadata: requireRecord(payload, 'Figma 文件元数据响应') }
}

export async function getFile(input: z.infer<typeof getFileInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, { path: filePath(input.fileKey), query: fileQuery(input) })
  return { file: requireRecord(payload, 'Figma 文件响应') }
}

export async function getFileNodes(input: z.infer<typeof getFileNodesInput>, ctx: ProviderContext): Promise<Json> {
  const raw = requireRecord(
    await request(ctx, {
      path: filePath(input.fileKey, '/nodes'),
      query: { ...fileQuery(input), ids: requireIds(input.nodeIds, 'nodeIds') },
    }),
    'Figma 节点响应',
  )
  return {
    nodes: requireRecord(raw.nodes, 'Figma 节点表'),
    raw,
  }
}

export async function renderImages(input: z.infer<typeof renderImagesInput>, ctx: ProviderContext): Promise<Json> {
  const raw = requireRecord(
    await request(ctx, {
      path: `/v1/images/${encodeURIComponent(requireInput(input.fileKey, 'fileKey'))}`,
      query: compact({
        ids: requireIds(input.nodeIds, 'nodeIds'),
        version: text(input.version),
        scale: input.scale,
        format: text(input.format),
        svg_include_id: input.svgIncludeId,
        svg_simplify_stroke: input.svgSimplifyStroke,
        use_absolute_bounds: input.useAbsoluteBounds,
      }) as Record<string, QueryValue>,
    }),
    'Figma 渲染响应',
  )
  return {
    images: requireRecord(raw.images, 'Figma 渲染结果表'),
    // err 总是给出来:渲染是"部分成功"的接口,消费者要能一眼看到有没有出错。
    err: raw.err === null ? null : (text(raw.err) ?? null),
    raw,
  }
}

export async function getImageFills(input: z.infer<typeof getImageFillsInput>, ctx: ProviderContext): Promise<Json> {
  const raw = requireRecord(await request(ctx, { path: filePath(input.fileKey, '/images') }), 'Figma 图片填充响应')
  const meta = requireRecord(raw.meta, 'Figma 图片填充的 meta')
  return {
    images: requireRecord(meta.images, 'Figma 图片填充表'),
    raw,
  }
}

export async function listFileVersions(
  input: z.infer<typeof listFileVersionsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const raw = requireRecord(
    await request(ctx, {
      path: filePath(input.fileKey, '/versions'),
      query: compact({
        page_size: input.pageSize,
        before: text(input.before),
        after: text(input.after),
      }) as Record<string, QueryValue>,
    }),
    'Figma 版本列表响应',
  )
  return {
    versions: requireArray(raw.versions, 'Figma 版本列表'),
    pagination: record(raw.pagination) ?? {},
    raw,
  }
}

export async function listComments(input: z.infer<typeof listCommentsInput>, ctx: ProviderContext): Promise<Json> {
  const raw = requireRecord(await request(ctx, { path: filePath(input.fileKey, '/comments') }), 'Figma 评论响应')
  return {
    comments: requireArray(raw.comments, 'Figma 评论列表'),
    raw,
  }
}

export async function postComment(input: z.infer<typeof postCommentInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    method: 'POST',
    path: filePath(input.fileKey, '/comments'),
    body: compact({
      message: requireInput(input.message, 'message'),
      client_meta: record(input.clientMeta),
      comment_id: text(input.commentId),
    }),
  })
  return { comment: requireRecord(payload, 'Figma 评论响应') }
}

export async function deleteComment(input: z.infer<typeof deleteCommentInput>, ctx: ProviderContext): Promise<Json> {
  await request(ctx, { method: 'DELETE', path: commentPath(input.fileKey, input.commentId) })
  return { deleted: true }
}

export async function listCommentReactions(
  input: z.infer<typeof listCommentReactionsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const raw = requireRecord(
    await request(ctx, {
      path: commentPath(input.fileKey, input.commentId, '/reactions'),
      query: compact({ cursor: text(input.cursor) }) as Record<string, QueryValue>,
    }),
    'Figma 评论表情响应',
  )
  return {
    reactions: requireArray(raw.reactions, 'Figma 评论表情列表'),
    pagination: record(raw.pagination) ?? {},
    raw,
  }
}

export async function postCommentReaction(
  input: z.infer<typeof postCommentReactionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await request(ctx, {
    method: 'POST',
    path: commentPath(input.fileKey, input.commentId, '/reactions'),
    body: { emoji: requireInput(input.emoji, 'emoji') },
  })
  return { posted: true }
}

export async function deleteCommentReaction(
  input: z.infer<typeof deleteCommentReactionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await request(ctx, {
    method: 'DELETE',
    path: commentPath(input.fileKey, input.commentId, '/reactions'),
    // 删表情靠 query 指定是哪一个,不是请求体 —— 上游 API 如此。
    query: { emoji: requireInput(input.emoji, 'emoji') },
  })
  return { deleted: true }
}

export async function listTeamProjects(
  input: z.infer<typeof listTeamProjectsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const raw = requireRecord(
    await request(ctx, { path: `/v1/teams/${encodeURIComponent(requireInput(input.teamId, 'teamId'))}/projects` }),
    'Figma 团队项目响应',
  )
  return {
    projects: requireArray(raw.projects, 'Figma 项目列表'),
    raw,
  }
}

export async function getProjectMetadata(
  input: z.infer<typeof getProjectMetadataInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/v1/projects/${encodeURIComponent(requireInput(input.projectId, 'projectId'))}/meta`,
  })
  return { metadata: requireRecord(payload, 'Figma 项目元数据响应') }
}

export async function listProjectFiles(
  input: z.infer<typeof listProjectFilesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const raw = requireRecord(
    await request(ctx, {
      path: `/v1/projects/${encodeURIComponent(requireInput(input.projectId, 'projectId'))}/files`,
      query: compact({ branch_data: input.branchData }) as Record<string, QueryValue>,
    }),
    'Figma 项目文件响应',
  )
  return {
    files: requireArray(raw.files, 'Figma 项目文件列表'),
    raw,
  }
}

export async function listFileComponents(
  input: z.infer<typeof listFileComponentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return libraryItems(ctx, filePath(input.fileKey, '/components'), 'components')
}

export async function listFileComponentSets(
  input: z.infer<typeof listFileComponentSetsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return libraryItems(ctx, filePath(input.fileKey, '/component_sets'), 'component_sets')
}

export async function listFileStyles(
  input: z.infer<typeof listFileStylesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return libraryItems(ctx, filePath(input.fileKey, '/styles'), 'styles')
}

export async function getComponent(input: z.infer<typeof getComponentInput>, ctx: ProviderContext): Promise<Json> {
  return libraryItem(ctx, `/v1/components/${encodeURIComponent(requireInput(input.key, 'key'))}`)
}

export async function getComponentSet(
  input: z.infer<typeof getComponentSetInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return libraryItem(ctx, `/v1/component_sets/${encodeURIComponent(requireInput(input.key, 'key'))}`)
}

export async function getStyle(input: z.infer<typeof getStyleInput>, ctx: ProviderContext): Promise<Json> {
  return libraryItem(ctx, `/v1/styles/${encodeURIComponent(requireInput(input.key, 'key'))}`)
}

export async function getDevResources(
  input: z.infer<typeof getDevResourcesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const raw = requireRecord(
    await request(ctx, {
      path: filePath(input.fileKey, '/dev_resources'),
      query: compact({ node_ids: joinIds(input.nodeIds) }) as Record<string, QueryValue>,
    }),
    'Figma dev resource 响应',
  )
  return {
    devResources: requireArray(raw.dev_resources, 'Figma dev resource 列表'),
    raw,
  }
}

export async function createDevResources(
  input: z.infer<typeof createDevResourcesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    method: 'POST',
    // 建 dev resource 不在文件路径下:每条自带 file_key,一次可以跨文件建。
    path: '/v1/dev_resources',
    body: {
      dev_resources: input.devResources.map(resource => ({
        name: requireInput(resource.name, 'name'),
        url: requireInput(resource.url, 'url'),
        file_key: requireInput(resource.fileKey, 'fileKey'),
        node_id: requireInput(resource.nodeId, 'nodeId'),
      })),
    },
  })
  return devResourceMutation(payload, 'links_created')
}

/** "每条至少改 name 或 url 之一"由 schema 的 refine 拦(见 schema.handwritten.ts)。 */
export async function updateDevResources(
  input: z.infer<typeof updateDevResourcesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    method: 'PUT',
    path: '/v1/dev_resources',
    body: {
      dev_resources: input.devResources.map(resource => compact({
        id: requireInput(resource.id, 'id'),
        name: text(resource.name),
        url: text(resource.url),
      })),
    },
  })
  return devResourceMutation(payload, 'links_updated')
}

export async function deleteDevResource(
  input: z.infer<typeof deleteDevResourceInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await request(ctx, {
    method: 'DELETE',
    path: `${filePath(input.fileKey, '/dev_resources')}/`
      + `${encodeURIComponent(requireInput(input.devResourceId, 'devResourceId'))}`,
  })
  return { deleted: true }
}
