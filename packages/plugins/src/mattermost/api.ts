/**
 * Mattermost(自建实例 / Cloud)的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/mattermost/runtime.ts`,语义等价、写法本地化:
 * 凭证经 `ctx.credentials` 取(多字段),出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 凭证是**两个字段**(对应上游 `definition.ts` 的 api_key + extraFields,字段名逐字一致):
 * `apiKey`(Personal Access Token,走 `Authorization: Bearer`,**不进 URL**)与
 * `instanceUrl`(实例根地址)。
 *
 * ## base URL 每次调用现算
 *
 * 上游在凭证校验时把归一化后的 `apiBaseUrl` 存进 credential metadata,业务路径直接读缓存;
 * tool-bridge 的凭证只存字段,故每次调用现拼,并把上游 `normalizeMattermostUrls` 的全部
 * 校验一并带过来(见 `apiBaseUrl`)。这些校验不只是口味问题 —— `instanceUrl` 是**租户填的
 * 主机名**,是本插件唯一一处"出站目标由用户决定"的地方,故除了 `guardedFetch` 的逐跳
 * 检查之外,这里再挡一道:必须 https、不得内嵌凭证、不得带 query/fragment。
 *
 * ## 三处上游细节决定了这里的形状
 *
 * 1. **入参名与 query 名不一样**:`perPage`→`per_page`、`beforePostId`→`before`、
 *    `afterPostId`→`after`。照抄入参名会让分页参数被 Mattermost 静默忽略。
 * 2. **`since` 与其他分页参数互斥**:Mattermost 收到 `since` 时会忽略 `page`/`before`/`after`,
 *    于是"我明明翻了页"却拿回同一批数据。上游在本地就把这种组合拒掉,保留。
 * 3. **帖子列表是 `{order, posts}` 的字典形态**:`posts` 是 id→post 的映射(无序),真正的
 *    时间顺序在 `order` 数组里。必须按 `order` 重排,直接 `Object.values(posts)` 拿到的
 *    顺序是不确定的。
 *
 * ## 与上游的有意偏离
 *
 * - **不发 `user-agent`**:上游报的是它自己的名字,照抄等于把流量记在别人账上。
 * - 上游把 401/403 都压成 401、把其余 4xx(含 404)全压成 400;这里把原始状态交给公共
 *   `upstreamError` —— 404 归 `not_found`、403 归 `permission_denied`,与其他 provider 一致
 *   (公共归一表存在的理由正是收掉这种各自为政的压缩)。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createPostInput,
  getChannelInput,
  getCurrentUserInput,
  getTeamInput,
  listChannelPostsInput,
  listTeamChannelsInput,
  listUserTeamsInput,
} from './schema'
import {
  createProviderHttpClient,
  type ProviderQuery,
  type ResponseBodyKind,
} from '../_runtime/providerHttp'
import { asJsonObject as record, trimmedText as text } from '../_runtime/jsonValue'
import { type ProviderContext, requireCredential } from '../_runtime/plugin'
import { assertPublicHttpUrl } from '../_runtime/guardedFetch'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'mattermost'
const API_PATH_PREFIX = '/api/v4'
/** 照搬上游的 30s 单请求上限。 */
const REQUEST_TIMEOUT_MS = 30_000
const http = createProviderHttpClient({ service: SERVICE })
/** `since` 不能与这些参数同时出现(见文件头第 2 条)。 */
const SINCE_CONFLICTING_FIELDS = ['page', 'perPage', 'beforePostId', 'afterPostId'] as const

type Json = Record<string, unknown>
type QueryValue = number | string | undefined

interface MattermostRequest {
  body?: Json
  method?: 'GET' | 'POST'
  path: string
  query?: Record<string, QueryValue>
}

/** 上游违约(说好是对象/数组却不是)—— 不是调用方的错,归可重试。 */
function invalidResponse(message: string): TBError {
  return new TBError('unavailable', message, { retryable: true })
}

function requireRecord(value: unknown, label: string): Json {
  const result = record(value)
  if (result === undefined) throw invalidResponse(`${label}不是对象`)
  return result
}

function requireRecordArray(value: unknown, label: string): Json[] {
  if (!Array.isArray(value)) throw invalidResponse(`${label}不是数组`)
  return value.map((item, index) => requireRecord(item, `${label} 的第 ${index} 项`))
}

/**
 * schema 把 `teamId` / `channelId` 标成 `.optional()`(生成时忠实反映了上游 action 声明),
 * 但上游 executor 里是必填。保留那道断言 —— 少了它会打出 `/teams/undefined` 这种请求。
 */
function requireText(value: unknown, field: string): string {
  const result = text(value)
  if (result === undefined) throw new TBError('invalid_argument', `${field} 是必填的`)
  return result
}

/**
 * 路径段:Mattermost 的 id 是不含分隔符的 26 字符串。上游额外挡掉 `/` `?` `#` ——
 * 那不是为了编码正确(`encodeURIComponent` 会编掉它们),而是为了让"传了一整段路径进来"
 * 这种误用报成参数错误,而不是变成一个查不出来的 404。
 */
function pathSegment(value: unknown, field: string): string {
  const segment = requireText(value, field)
  if (segment.includes('/') || segment.includes('?') || segment.includes('#')) {
    throw new TBError('invalid_argument', `${field} 必须是单个 Mattermost 路径段`)
  }
  return encodeURIComponent(segment)
}

/**
 * 上游 `normalizeMattermostUrls`:补 https 协议、校 https、拒内嵌凭证、去掉 query/fragment
 * 与尾部斜杠,已经带 `/api/v4` 的地址去掉后缀再统一补回 —— 用户两种写法都能用。
 */
function apiBaseUrl(ctx: ProviderContext): string {
  const raw = requireCredential(ctx, SERVICE, 'instanceUrl')
  // 出站目标由租户填写,先过公网可达性校验(与 guardedFetch 同一套判据,但报错能指到字段)。
  const url = assertPublicHttpUrl(raw.includes('://') ? raw : `https://${raw}`)
  if (url.protocol !== 'https:') {
    throw new TBError('invalid_argument', 'instanceUrl 必须用 https')
  }
  if (url.username !== '' || url.password !== '') {
    throw new TBError('invalid_argument', 'instanceUrl 不能内嵌用户名或密码')
  }
  url.search = ''
  url.hash = ''
  const path = (url.pathname === '/' ? '' : url.pathname).replace(/\/+$/, '')
  url.pathname = path.endsWith(API_PATH_PREFIX) ? path.slice(0, -API_PATH_PREFIX.length) : path
  return `${url.toString().replace(/\/$/, '')}${API_PATH_PREFIX}`
}

/** 空体读成 null；非 JSON 的错误响应把原文放进 message，保持旧错误 envelope。 */
function responsePayload(data: unknown, bodyKind: ResponseBodyKind): unknown {
  if (bodyKind === 'empty') return null
  return bodyKind === 'invalid-json' ? { message: data } : data
}

/** Mattermost 的错误消息散在 `message` / `error` / `details` / `id` 四个键上。 */
function errorMessage(payload: unknown, status: number): string {
  const body = record(payload)
  return text(body?.message)
    ?? text(body?.error)
    ?? text(body?.details)
    ?? text(body?.id)
    ?? `Mattermost 返回 HTTP ${status}`
}

async function request(ctx: ProviderContext, input: MattermostRequest): Promise<unknown> {
  const result = await http.request({
    baseUrl: `${apiBaseUrl(ctx)}/`,
    path: input.path,
    method: input.method ?? 'GET',
    query: Object.entries(input.query ?? {}) satisfies ProviderQuery,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${requireCredential(ctx, SERVICE, 'apiKey')}`,
    },
    ...(input.body === undefined ? {} : { json: input.body }),
    timeoutMs: REQUEST_TIMEOUT_MS,
    invalidJsonMessage: 'Mattermost 返回了非 JSON 响应',
    mapError: ({ bodyKind, data, status }) => upstreamError(
      status,
      errorMessage(responsePayload(data, bodyKind), status),
    ),
    mapTransportError: ({ kind, message }) => kind === 'timeout'
      ? upstreamError(504, `Mattermost 请求超时(${REQUEST_TIMEOUT_MS / 1000} 秒)`)
      : upstreamError(502, `Mattermost 请求失败:${message ?? 'unknown network error'}`),
  })
  return responsePayload(result.data, result.bodyKind)
}

export async function getCurrentUser(
  _input: z.infer<typeof getCurrentUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, { path: '/users/me' })
  return { user: requireRecord(payload, 'Mattermost 用户'), raw: payload }
}

export async function listUserTeams(
  _input: z.infer<typeof listUserTeamsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, { path: '/users/me/teams' })
  return { teams: requireRecordArray(payload, 'Mattermost 团队列表'), raw: payload }
}

export async function getTeam(input: z.infer<typeof getTeamInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, { path: `/teams/${pathSegment(input.teamId, 'teamId')}` })
  return { team: requireRecord(payload, 'Mattermost 团队'), raw: payload }
}

export async function listTeamChannels(
  input: z.infer<typeof listTeamChannelsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/teams/${pathSegment(input.teamId, 'teamId')}/channels`,
    query: { page: input.page, per_page: input.perPage },
  })
  return { channels: requireRecordArray(payload, 'Mattermost 频道列表'), raw: payload }
}

export async function getChannel(input: z.infer<typeof getChannelInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, { path: `/channels/${pathSegment(input.channelId, 'channelId')}` })
  return { channel: requireRecord(payload, 'Mattermost 频道'), raw: payload }
}

/**
 * 帖子列表整形(见文件头第 3 条)。
 *
 * `order` 里出现但 `posts` 里没有的 id 补成 `{ id }`:那条帖子对调用方仍是"存在但取不到
 * 内容",丢掉它会让 `posts` 与 `order` 长度不一致,翻页逻辑就错了。
 */
function normalizePostList(payload: unknown): Json {
  const raw = requireRecord(payload, 'Mattermost 帖子列表')
  const order = Array.isArray(raw.order)
    ? raw.order.filter((item): item is string => typeof item === 'string')
    : []
  const postsById = record(raw.posts)
  const posts = postsById !== undefined && order.length > 0
    ? order.map(id => record(postsById[id]) ?? { id })
    // 没有 order(或 posts 不是字典)时只能原样列出,顺序不保证 —— 与上游一致。
    : Object.values(postsById ?? {}).map(item => record(item) ?? { value: item })
  return { posts, order, raw }
}

export async function listChannelPosts(
  input: z.infer<typeof listChannelPostsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  if (input.since !== undefined) {
    const conflicting = SINCE_CONFLICTING_FIELDS.filter(field => input[field] !== undefined)
    if (conflicting.length > 0) {
      throw new TBError(
        'invalid_argument',
        `since 不能与 ${SINCE_CONFLICTING_FIELDS.join(' / ')} 同时使用(本次给了 ${conflicting.join(' / ')})`,
      )
    }
  }

  const payload = await request(ctx, {
    path: `/channels/${pathSegment(input.channelId, 'channelId')}/posts`,
    // 见文件头第 1 条:这四个参数在 wire 上是另一套名字。
    query: {
      page: input.page,
      per_page: input.perPage,
      since: input.since,
      before: text(input.beforePostId),
      after: text(input.afterPostId),
    },
  })
  return normalizePostList(payload)
}

export async function createPost(input: z.infer<typeof createPostInput>, ctx: ProviderContext): Promise<Json> {
  const rootId = text(input.rootId)
  const props = record(input.props)
  const payload = await request(ctx, {
    path: '/posts',
    method: 'POST',
    body: {
      channel_id: requireText(input.channelId, 'channelId'),
      message: requireText(input.message, 'message'),
      // 缺省时整个键不发(上游 `compactObject`):发 `null` 会被 Mattermost 当成非法入参。
      ...(rootId === undefined ? {} : { root_id: rootId }),
      ...(props === undefined ? {} : { props }),
    },
  })
  return { post: requireRecord(payload, 'Mattermost 帖子'), raw: payload }
}
