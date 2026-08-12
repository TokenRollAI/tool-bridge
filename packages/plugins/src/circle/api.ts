/**
 * Circle 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/circle/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * Circle Admin API v2 全部是 GET;list 响应是 `{records:[], page, per_page, ...}` 的
 * 平铺信封(分页字段与数据同层),故 `normalizePagination` 从整包读、缺字段时退回
 * 由 records 长度推出的保守值 —— 这是上游的既有行为,消费者依赖它。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getCommunityMemberInput,
  getPostInput,
  getSpaceGroupInput,
  listCommunityMembersInput,
  listPostsInput,
  listSpaceGroupsInput,
  listSpaceMembersInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'circle'
const API_BASE = 'https://app.circle.so/api/admin/v2'

type Json = Record<string, unknown>

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : undefined
}

/** Circle 的错误体:纯字符串、`error_details.message`、`message` 都出现过。 */
function errorMessage(payload: unknown, status: number): string {
  const direct = text(payload)
  if (direct !== undefined) return direct
  const object = record(payload)
  const details = record(object?.error_details)
  return text(details?.message) ?? text(object?.message) ?? `Circle request failed with status ${status}`
}

async function request(
  ctx: ProviderContext,
  path: string,
  query: Record<string, string | undefined> = {},
): Promise<Json> {
  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, value)
  }

  const response = await guardedFetch(url.toString(), {
    method: 'GET',
    headers: {
      'accept': 'application/json',
      'authorization': `Bearer ${requireApiKey(ctx, SERVICE)}`,
      'content-type': 'application/json',
    },
  })

  const body = await response.text()
  let payload: unknown = null
  if (body.trim() !== '') {
    try {
      payload = JSON.parse(body)
    } catch {
      throw new TBError('unavailable', 'Circle 返回了非法 JSON', { retryable: true })
    }
  }

  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response.status))
  const object = record(payload)
  if (object === undefined) {
    // 契约说好是对象;不是就是上游出问题,不是调用方的错。
    throw new TBError('unavailable', 'Circle 返回了非对象响应', { retryable: true })
  }
  return object
}

// —— 出参归一 ——

function nullableText(value: unknown): string | null {
  return text(value) ?? null
}

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

function nullableInteger(value: unknown): number | null {
  return integer(value) ?? null
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

/** 归一对象的主键缺失说明上游响应破损,不是调用方的错。 */
function requiredInteger(value: unknown, field: string): number {
  const parsed = integer(value)
  if (parsed === undefined) {
    throw new TBError('unavailable', `Circle 返回的 ${field} 非法`, { retryable: true })
  }
  return parsed
}

function readRecords(payload: Json): Json[] {
  if (!Array.isArray(payload.records)) return []
  return payload.records.map((item) => {
    const object = record(item)
    if (object === undefined) {
      throw new TBError('unavailable', 'Circle 返回的 record 不是对象', { retryable: true })
    }
    return object
  })
}

function normalizePagination(payload: Json): Json {
  const count = readRecords(payload).length
  return {
    page: integer(payload.page) ?? 1,
    per_page: integer(payload.per_page) ?? count,
    has_next_page: typeof payload.has_next_page === 'boolean' ? payload.has_next_page : false,
    count: integer(payload.count) ?? count,
    page_count: integer(payload.page_count) ?? 1,
  }
}

function normalizeCommunity(payload: Json): Json {
  return {
    id: requiredInteger(payload.id, 'community.id'),
    name: nullableText(payload.name),
    slug: nullableText(payload.slug),
    locale: nullableText(payload.locale),
    is_private: nullableBoolean(payload.is_private),
    created_at: nullableText(payload.created_at),
    updated_at: nullableText(payload.updated_at),
    raw: payload,
  }
}

function normalizeCommunityMember(payload: Json): Json {
  return {
    id: requiredInteger(payload.id, 'community_member.id'),
    user_id: nullableInteger(payload.user_id),
    name: nullableText(payload.name),
    first_name: nullableText(payload.first_name),
    last_name: nullableText(payload.last_name),
    email: nullableText(payload.email),
    headline: nullableText(payload.headline),
    status: nullableText(payload.status),
    profile_url: nullableText(payload.profile_url),
    public_uid: nullableText(payload.public_uid),
    avatar_url: nullableText(payload.avatar_url),
    community_id: nullableInteger(payload.community_id),
    created_at: nullableText(payload.created_at),
    updated_at: nullableText(payload.updated_at),
    raw: payload,
  }
}

function normalizePost(payload: Json): Json {
  return {
    id: requiredInteger(payload.id, 'post.id'),
    status: nullableText(payload.status),
    name: nullableText(payload.name),
    slug: nullableText(payload.slug),
    url: nullableText(payload.url),
    space_id: nullableInteger(payload.space_id),
    space_group_id: nullableInteger(payload.space_group_id),
    user_id: nullableInteger(payload.user_id),
    user_email: nullableText(payload.user_email),
    user_name: nullableText(payload.user_name),
    comments_count: nullableInteger(payload.comments_count),
    likes_count: nullableInteger(payload.likes_count),
    published_at: nullableText(payload.published_at),
    created_at: nullableText(payload.created_at),
    updated_at: nullableText(payload.updated_at),
    raw: payload,
  }
}

function normalizeSpaceGroup(payload: Json): Json {
  return {
    id: requiredInteger(payload.id, 'space_group.id'),
    name: nullableText(payload.name),
    slug: nullableText(payload.slug),
    community_id: nullableInteger(payload.community_id),
    spaces_count: nullableInteger(payload.spaces_count),
    space_group_members_count: nullableInteger(payload.space_group_members_count),
    is_hidden_from_non_members: nullableBoolean(payload.is_hidden_from_non_members),
    hide_members_count: nullableBoolean(payload.hide_members_count),
    created_at: nullableText(payload.created_at),
    updated_at: nullableText(payload.updated_at),
    raw: payload,
  }
}

function normalizeSpaceMember(payload: Json): Json {
  const communityMember = record(payload.community_member)
  return {
    id: requiredInteger(payload.id, 'space_member.id'),
    user_id: nullableInteger(payload.user_id),
    space_id: nullableInteger(payload.space_id),
    community_member_id: nullableInteger(payload.community_member_id),
    status: nullableText(payload.status),
    access_type: nullableText(payload.access_type),
    moderator: nullableBoolean(payload.moderator),
    notification_type: nullableText(payload.notification_type),
    // 嵌套成员不做字段归一(上游如此),只补一个自指的 raw。
    community_member: communityMember === undefined
      ? null
      : { ...communityMember, raw: communityMember },
    created_at: nullableText(payload.created_at),
    updated_at: nullableText(payload.updated_at),
    raw: payload,
  }
}

// —— handlers ——

export async function getCommunity(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return { community: normalizeCommunity(await request(ctx, '/community')) }
}

export async function listCommunityMembers(
  input: z.infer<typeof listCommunityMembersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/community_members', {
    page: input.page === undefined ? undefined : String(input.page),
    per_page: input.per_page === undefined ? undefined : String(input.per_page),
    status: input.status,
    // Circle 只认逗号分隔的一串 tag id,不认重复同名参数。
    member_tag_ids: input.member_tag_ids?.join(','),
  })
  return { pagination: normalizePagination(payload), members: readRecords(payload).map(normalizeCommunityMember) }
}

export async function getCommunityMember(
  input: z.infer<typeof getCommunityMemberInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return { member: normalizeCommunityMember(await request(ctx, `/community_members/${input.id}`)) }
}

export async function listPosts(
  input: z.infer<typeof listPostsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/posts', {
    page: input.page === undefined ? undefined : String(input.page),
    per_page: input.per_page === undefined ? undefined : String(input.per_page),
    space_id: input.space_id === undefined ? undefined : String(input.space_id),
    space_group_id: input.space_group_id === undefined ? undefined : String(input.space_group_id),
    status: input.status,
    search_text: input.search_text,
    sort: input.sort,
  })
  return { pagination: normalizePagination(payload), posts: readRecords(payload).map(normalizePost) }
}

export async function getPost(
  input: z.infer<typeof getPostInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return { post: normalizePost(await request(ctx, `/posts/${input.id}`)) }
}

export async function listSpaceGroups(
  input: z.infer<typeof listSpaceGroupsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/space_groups', {
    page: input.page === undefined ? undefined : String(input.page),
    per_page: input.per_page === undefined ? undefined : String(input.per_page),
    name: input.name,
  })
  return { pagination: normalizePagination(payload), space_groups: readRecords(payload).map(normalizeSpaceGroup) }
}

export async function getSpaceGroup(
  input: z.infer<typeof getSpaceGroupInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return { space_group: normalizeSpaceGroup(await request(ctx, `/space_groups/${input.id}`)) }
}

export async function listSpaceMembers(
  input: z.infer<typeof listSpaceMembersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/space_members', {
    page: input.page === undefined ? undefined : String(input.page),
    per_page: input.per_page === undefined ? undefined : String(input.per_page),
    space_id: String(input.space_id),
    status: input.status,
  })
  return { pagination: normalizePagination(payload), space_members: readRecords(payload).map(normalizeSpaceMember) }
}
