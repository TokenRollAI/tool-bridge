/**
 * Docker Hub 的业务逻辑(Hub API 上的 14 个 action)。
 *
 * 迁移自 open-connector `src/providers/docker_hub/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 四处上游细节决定了这里的形状:
 * - **凭证是 `identifier:secret`,还要先换 token**。Docker Hub 的业务接口只认 bearer,
 *   故每次调用先 `POST /v2/auth/token` 换一个短期令牌再打业务接口 —— 两跳。
 *   **不做进程级缓存**:插件是模块级单例、同时服务多个挂载与租户,缓存 token 等于把
 *   A 租户的令牌发给 B。上游也是每次执行现换,这里保持一致。
 * - **响应要整形**。上游把 snake_case 的原始字段逐个映成 camelCase 并补齐缺省值
 *   (缺席的字符串归一成 null、缺席的计数归一成 0),出参声明就是按整形后的形状写的。
 *   直接透传原始 JSON 会让 `~help` 里宣告的契约与实际返回对不上。
 * - **`get_image` 是客户端分页扫描**:Hub 没有"按 digest 查镜像"的接口,只能翻 tag 列表
 *   逐页找。翻到 `next` 为空或到 `maxPages` 上限还没找到就报 not_found —— 这段循环
 *   是整个 provider 里最容易迁丢的地方。
 * - **`errinfo` 里才有真正的错误原因**。Hub 的一部分错误既不在 `message` 也不在 `detail`,
 *   而在 `errinfo` 的任意一个字段里(值可能是字符串,也可能是字符串数组)。
 *
 * 没有 credentialProbe:所有 read action 都要一个业务 id(namespace / orgName),
 * 拿不到"空转"的调用,不硬凑。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  addOrgMemberInput,
  createRepositoryInput,
  deleteTeamInput,
  getImageInput,
  getRepositoryInput,
  getTagInput,
  getTeamInput,
  listOrgAccessTokensInput,
  listOrgMembersInput,
  listRepositoriesInput,
  listTeamMembersInput,
  listTeamsInput,
  removeOrgMemberInput,
  removeTeamMemberInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'docker_hub'
const API_BASE = 'https://hub.docker.com'
const TOKEN_PATH = '/v2/auth/token'
/** `get_image` 扫描 tag 列表时的缺省页大小与最多翻几页。 */
const DEFAULT_IMAGE_PAGE_SIZE = 25
const DEFAULT_IMAGE_MAX_PAGES = 20

type Json = Record<string, unknown>
type QueryValue = boolean | number | string | undefined

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 上游 `optionalString` 的等价物:去空白后仍非空才算有值。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 上游 `readNullableText`:拿不到字符串一律落 null(出参声明里这些字段都是 nullable)。 */
function nullableText(value: unknown): string | null {
  return text(value) ?? null
}

function int(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

/** 只有真的是布尔才当布尔,其余(含缺席)落 null。 */
function nullableBool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function objectArray(value: unknown): Json[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Json => record(item) !== undefined)
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

/** 丢掉值为 undefined 的键(上游 `compactObject`);`null` 与 `false` 要留住。 */
function compact<T>(input: Record<string, T | undefined>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Record<string, T>
}

/** 上游回的形状不符合契约 —— 是上游的问题,不是调用方的错。 */
function responseError(message: string): TBError {
  return new TBError('unavailable', message, { retryable: true })
}

function requireRecord(value: unknown): Json {
  const result = record(value)
  if (result === undefined) throw responseError('Docker Hub 响应不是对象')
  return result
}

/**
 * 拆错误消息。前两处是常规位置,第三处 `errinfo` 才是 Hub 真正放原因的地方:
 * 它的值可能是字符串,也可能是字符串数组(逐字段校验错误),取第一个非空的。
 */
function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') return text(payload)
  const body = record(payload)
  if (body === undefined) return undefined
  const direct = text(body.message) ?? text(body.detail)
  if (direct !== undefined) return direct
  const errinfo = record(body.errinfo)
  if (errinfo === undefined) return undefined
  for (const value of Object.values(errinfo)) {
    const item = text(value) ?? (Array.isArray(value) ? stringArray(value).map(text).find(Boolean) : undefined)
    if (item !== undefined) return item
  }
  return undefined
}

/** 空正文回 null;非 JSON 正文当成 `{message}`(错误响应上回 HTML 错误页很常见)。 */
async function readPayload(response: Response): Promise<unknown> {
  const raw = await response.text()
  if (raw === '') return null
  try {
    return JSON.parse(raw)
  } catch {
    return { message: raw }
  }
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(path, API_BASE)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

/** 凭证形如 `identifier:secret`;secret 里可能含冒号,故只按**第一个**冒号切。 */
function credential(ctx: ProviderContext): { identifier: string, secret: string } {
  const raw = requireApiKey(ctx, SERVICE).trim()
  const separator = raw.indexOf(':')
  const identifier = separator <= 0 ? '' : raw.slice(0, separator).trim()
  const secret = separator < 0 ? '' : raw.slice(separator + 1).trim()
  if (identifier === '' || secret === '') {
    throw new TBError(
      'invalid_argument',
      `${SERVICE} 的凭证要写成 identifier:secret(Docker 用户名或组织名 + 访问令牌)`,
    )
  }
  return { identifier, secret }
}

/** 换短期 bearer token。每次调用现换 —— 见文件头注释里"为什么不缓存"。 */
async function accessToken(ctx: ProviderContext): Promise<string> {
  const response = await guardedFetch(buildUrl(TOKEN_PATH), {
    method: 'POST',
    headers: { 'accept': 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(credential(ctx)),
  })

  const payload = await readPayload(response)
  if (!response.ok) {
    throw upstreamError(response.status, errorMessage(payload) ?? `Docker Hub 换取令牌失败(HTTP ${response.status})`)
  }
  const token = text(requireRecord(payload).access_token)
  if (token === undefined) throw responseError('Docker Hub 换取令牌的响应里没有 access_token')
  return token
}

interface RequestInput {
  body?: Json
  method?: string
  path: string
  query?: Record<string, QueryValue>
}

async function send(ctx: ProviderContext, input: RequestInput): Promise<{ payload: unknown, response: Response }> {
  const response = await guardedFetch(buildUrl(input.path, input.query), {
    method: input.method ?? 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${await accessToken(ctx)}`,
      ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  })
  const payload = await readPayload(response)
  if (!response.ok) {
    throw upstreamError(response.status, errorMessage(payload) ?? `Docker Hub 返回 HTTP ${response.status}`)
  }
  return { payload, response }
}

async function requestJson(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  return (await send(ctx, input)).payload
}

/** DELETE 类接口不回正文,成功与否只看状态。 */
async function requestNoContent(ctx: ProviderContext, input: RequestInput): Promise<void> {
  await send(ctx, input)
}

// ── 响应整形 ────────────────────────────────────────────────────────────────

interface Page {
  count: number
  next: string | null
  previous: string | null
  results: Json[]
}

function pageContainer(payload: unknown): Page {
  const body = requireRecord(payload)
  return {
    count: int(body.count) ?? 0,
    next: nullableText(body.next),
    previous: nullableText(body.previous),
    results: objectArray(body.results),
  }
}

function repositorySummary(payload: unknown): Json {
  const body = requireRecord(payload)
  return {
    name: text(body.name) ?? '',
    namespace: text(body.namespace) ?? '',
    repositoryType: nullableText(body.repository_type),
    status: int(body.status) ?? 0,
    statusDescription: text(body.status_description) ?? '',
    description: nullableText(body.description),
    isPrivate: Boolean(body.is_private),
    starCount: int(body.star_count) ?? 0,
    pullCount: int(body.pull_count) ?? 0,
    lastUpdated: nullableText(body.last_updated),
    lastModified: nullableText(body.last_modified),
    dateRegistered: nullableText(body.date_registered),
    affiliation: nullableText(body.affiliation),
    mediaTypes: stringArray(body.media_types),
    contentTypes: stringArray(body.content_types),
    categories: objectArray(body.categories).map(item => ({
      name: text(item.name) ?? '',
      slug: text(item.slug) ?? '',
    })),
    storageSize: int(body.storage_size) ?? null,
  }
}

function repositoryDetail(payload: unknown): Json {
  const body = requireRecord(payload)
  const permissions = record(body.permissions)
  const immutable = record(body.immutable_tags_settings)
  return {
    ...repositorySummary(body),
    user: nullableText(body.user),
    hubUser: nullableText(body.hub_user),
    collaboratorCount: int(body.collaborator_count) ?? null,
    fullDescription: nullableText(body.full_description),
    hasStarred: nullableBool(body.has_starred),
    permissions: permissions === undefined
      ? null
      : { read: Boolean(permissions.read), write: Boolean(permissions.write), admin: Boolean(permissions.admin) },
    immutableTagsSettings: immutable === undefined
      ? null
      : { enabled: Boolean(immutable.enabled), rules: stringArray(immutable.rules) },
    source: nullableText(body.source),
  }
}

function image(payload: unknown): Json {
  const body = requireRecord(payload)
  return {
    architecture: nullableText(body.architecture),
    features: nullableText(body.features),
    variant: nullableText(body.variant),
    digest: nullableText(body.digest),
    layers: objectArray(body.layers).map(layer => ({
      digest: nullableText(layer.digest),
      size: int(layer.size) ?? null,
      instruction: nullableText(layer.instruction),
    })),
    os: nullableText(body.os),
    osFeatures: nullableText(body.os_features),
    osVersion: nullableText(body.os_version),
    size: int(body.size) ?? null,
    status: nullableText(body.status),
    lastPulled: nullableText(body.last_pulled),
    lastPushed: nullableText(body.last_pushed),
  }
}

/** `images` 既可能是数组,也可能是单个对象(单架构镜像);统一成数组。 */
function imageCollection(value: unknown): Json[] {
  if (Array.isArray(value)) return value.map(item => image(item))
  return record(value) === undefined ? [] : [image(value)]
}

function tag(payload: unknown): Json {
  const body = requireRecord(payload)
  return {
    id: int(body.id) ?? null,
    name: text(body.name) ?? '',
    creator: int(body.creator) ?? null,
    lastUpdated: nullableText(body.last_updated),
    lastUpdater: int(body.last_updater) ?? null,
    lastUpdaterUsername: nullableText(body.last_updater_username),
    repository: int(body.repository) ?? null,
    fullSize: int(body.full_size) ?? null,
    status: nullableText(body.status),
    tagLastPulled: nullableText(body.tag_last_pulled),
    tagLastPushed: nullableText(body.tag_last_pushed),
    images: imageCollection(body.images),
  }
}

function orgMember(payload: unknown): Json {
  const body = requireRecord(payload)
  return {
    id: nullableText(body.id),
    username: nullableText(body.username),
    fullName: nullableText(body.full_name),
    email: nullableText(body.email),
    type: nullableText(body.type),
    role: nullableText(body.role),
    groups: stringArray(body.groups),
    isGuest: nullableBool(body.is_guest),
    dateJoined: nullableText(body.date_joined),
    lastLoggedInAt: nullableText(body.last_logged_in_at),
    lastSeenAt: nullableText(body.last_seen_at),
    lastDesktopVersion: nullableText(body.last_desktop_version),
  }
}

function team(payload: unknown): Json {
  const body = requireRecord(payload)
  return {
    id: int(body.id) ?? null,
    uuid: nullableText(body.uuid),
    name: nullableText(body.name),
    description: nullableText(body.description),
    memberCount: int(body.member_count) ?? null,
  }
}

function teamMember(payload: unknown): Json {
  const body = requireRecord(payload)
  return {
    id: nullableText(body.id),
    username: nullableText(body.username),
    fullName: nullableText(body.full_name),
    email: nullableText(body.email),
    company: nullableText(body.company),
    location: nullableText(body.location),
    profileUrl: nullableText(body.profile_url),
    type: nullableText(body.type),
    dateJoined: nullableText(body.date_joined),
  }
}

function orgAccessToken(payload: unknown): Json {
  const body = requireRecord(payload)
  return compact({
    id: nullableText(body.id),
    label: nullableText(body.label),
    createdBy: nullableText(body.created_by),
    isActive: nullableBool(body.is_active),
    createdAt: nullableText(body.created_at),
    expiresAt: nullableText(body.expires_at),
    lastUsedAt: nullableText(body.last_used_at),
    // 上游对 resources 用 compactObject:不是数组就整个键不出现(而不是给个空数组)。
    resources: Array.isArray(body.resources)
      ? body.resources.map((item) => {
          const resource = requireRecord(item)
          return {
            type: nullableText(resource.type),
            path: nullableText(resource.path),
            scopes: stringArray(resource.scopes),
          }
        })
      : undefined,
  })
}

/** 批量邀请的结果可能多包一层 `invitees.invitees`,两种形状都要认。 */
function bulkInviteResults(payload: unknown): Json[] {
  const body = requireRecord(payload)
  const nested = record(body.invitees)?.invitees ?? body.invitees
  return objectArray(nested).map((item) => {
    const invite = record(item.invite)
    return {
      invitee: nullableText(item.invitee),
      status: nullableText(item.status),
      invite: invite === undefined
        ? null
        : {
            id: nullableText(invite.id),
            inviterUsername: nullableText(invite.inviter_username),
            invitee: nullableText(invite.invitee),
            org: nullableText(invite.org),
            team: nullableText(invite.team),
            createdAt: nullableText(invite.created_at),
          },
    }
  })
}

function mapPage(payload: unknown, item: (value: unknown) => Json): Json {
  const page = pageContainer(payload)
  return { count: page.count, next: page.next, previous: page.previous, results: page.results.map(item) }
}

// ── action ─────────────────────────────────────────────────────────────────

const path = {
  repositories: (namespace: string) => `/v2/namespaces/${encodeURIComponent(namespace)}/repositories`,
  repository: (namespace: string, repository: string) =>
    `${path.repositories(namespace)}/${encodeURIComponent(repository)}`,
  org: (orgName: string) => `/v2/orgs/${encodeURIComponent(orgName)}`,
  team: (orgName: string, teamName: string) => `${path.org(orgName)}/groups/${encodeURIComponent(teamName)}`,
}

export async function listRepositories(
  input: z.infer<typeof listRepositoriesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await requestJson(ctx, {
    path: path.repositories(input.namespace),
    query: compact({
      page: input.page,
      page_size: input.pageSize,
      name: text(input.name),
      ordering: text(input.ordering),
    }),
  })
  return mapPage(payload, repositorySummary)
}

export async function getRepository(input: z.infer<typeof getRepositoryInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await requestJson(ctx, { path: path.repository(input.namespace, input.repository) })
  return { repository: repositoryDetail(payload) }
}

export async function createRepository(
  input: z.infer<typeof createRepositoryInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await requestJson(ctx, {
    path: path.repositories(input.namespace),
    method: 'POST',
    body: compact({
      namespace: input.namespace,
      name: input.name,
      description: text(input.description),
      full_description: text(input.fullDescription),
      registry: text(input.registry),
      is_private: input.isPrivate,
    }),
  })
  return { repository: repositoryDetail(payload) }
}

export async function getTag(input: z.infer<typeof getTagInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await requestJson(ctx, {
    path: `${path.repository(input.namespace, input.repository)}/tags/${encodeURIComponent(input.tag)}`,
  })
  return { tag: tag(payload) }
}

/**
 * Hub 没有"按 digest 查镜像"的接口,只能翻 tag 列表逐页找。翻到 `next` 为空(最后一页)
 * 或到 `maxPages` 上限还没命中就报 not_found —— 后者是**扫描没扫完**,消息里要说清楚,
 * 免得调用方把"没扫到"当成"不存在"。
 */
export async function getImage(input: z.infer<typeof getImageInput>, ctx: ProviderContext): Promise<Json> {
  const pageSize = input.pageSize ?? DEFAULT_IMAGE_PAGE_SIZE
  const maxPages = input.maxPages ?? DEFAULT_IMAGE_MAX_PAGES

  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await requestJson(ctx, {
      path: `${path.repository(input.namespace, input.repository)}/tags`,
      query: { page, page_size: pageSize },
    })
    const current = pageContainer(payload)
    for (const item of current.results) {
      const normalized = tag(item)
      const found = (normalized.images as Json[]).find(candidate => candidate.digest === input.digest)
      if (found !== undefined) return { tag: normalized, image: found }
    }
    if (current.next === null) break
  }

  throw upstreamError(404, `在 ${input.namespace}/${input.repository} 里没找到 digest 为 ${input.digest} 的镜像`)
}

export async function listOrgMembers(input: z.infer<typeof listOrgMembersInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await requestJson(ctx, {
    path: `${path.org(input.orgName)}/members`,
    query: compact({
      search: text(input.search),
      page: input.page,
      page_size: input.pageSize,
      invites: input.invites,
      type: text(input.type),
      role: text(input.role),
    }),
  })
  // Hub 这个接口偶尔把分页对象再包一层数组,第一项才是那一页。
  const unwrapped = Array.isArray(payload) && payload.length > 0 && payload.every(item => record(item) !== undefined)
    ? payload[0]
    : payload
  return mapPage(unwrapped, orgMember)
}

export async function addOrgMember(input: z.infer<typeof addOrgMemberInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await requestJson(ctx, {
    path: '/v2/invites/bulk',
    method: 'POST',
    body: compact({
      org: input.orgName,
      team: text(input.teamName),
      role: text(input.role),
      // 单人邀请也走批量接口,故 invitee 要包成数组。
      invitees: [input.invitee],
      dry_run: input.dryRun,
    }),
  })
  return { invitees: bulkInviteResults(payload) }
}

export async function removeOrgMember(
  input: z.infer<typeof removeOrgMemberInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await requestNoContent(ctx, {
    path: `${path.org(input.orgName)}/members/${encodeURIComponent(input.username)}`,
    method: 'DELETE',
  })
  return { removed: true }
}

export async function listOrgAccessTokens(
  input: z.infer<typeof listOrgAccessTokensInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await requestJson(ctx, {
    path: `${path.org(input.orgName)}/access-tokens`,
    query: compact({ page: input.page, page_size: input.pageSize }),
  })
  // 这个接口的分页字段是 `total` 而不是 `count`(Hub 自身的不一致,照抄)。
  const body = requireRecord(payload)
  return {
    total: int(body.total) ?? 0,
    next: nullableText(body.next),
    previous: nullableText(body.previous),
    results: objectArray(body.results).map(item => orgAccessToken(item)),
  }
}

export async function listTeams(input: z.infer<typeof listTeamsInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await requestJson(ctx, {
    path: `${path.org(input.orgName)}/groups`,
    query: compact({
      page: input.page,
      page_size: input.pageSize,
      username: text(input.username),
      search: text(input.search),
    }),
  })
  return mapPage(payload, team)
}

export async function getTeam(input: z.infer<typeof getTeamInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await requestJson(ctx, { path: path.team(input.orgName, input.teamName) })
  return { team: team(payload) }
}

export async function deleteTeam(input: z.infer<typeof deleteTeamInput>, ctx: ProviderContext): Promise<Json> {
  await requestNoContent(ctx, { path: path.team(input.orgName, input.teamName), method: 'DELETE' })
  return { deleted: true }
}

export async function listTeamMembers(
  input: z.infer<typeof listTeamMembersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await requestJson(ctx, {
    path: `${path.team(input.orgName, input.teamName)}/members`,
    query: compact({ page: input.page, page_size: input.pageSize, search: text(input.search) }),
  })
  return mapPage(payload, teamMember)
}

export async function removeTeamMember(
  input: z.infer<typeof removeTeamMemberInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await requestNoContent(ctx, {
    path: `${path.team(input.orgName, input.teamName)}/members/${encodeURIComponent(input.username)}`,
    method: 'DELETE',
  })
  return { removed: true }
}
