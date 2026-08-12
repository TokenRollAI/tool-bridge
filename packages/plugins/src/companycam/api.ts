/**
 * CompanyCam 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/companycam/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * CompanyCam 的两个特点决定了这里的形状:
 * - 入参用 camelCase,上游 API 用 snake_case,两边的映射是逐字段手写的(不是通用转换);
 * - 响应被**归一**成固定字段集,同时把原始对象原样放进 `raw` —— 归一表漏掉的字段
 *   仍然能从 `raw` 取到,所以归一只做映射不做过滤。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  archiveProjectInput,
  createProjectInput,
  createTagInput,
  deleteTagInput,
  getProjectInput,
  getTagInput,
  getUserInput,
  listProjectsInput,
  listTagsInput,
  listUsersInput,
  restoreProjectInput,
  updateProjectInput,
  updateTagInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'companycam'
const API_BASE = 'https://api.companycam.com/v2'

type Json = Record<string, unknown>

interface RequestInput {
  body?: unknown
  /** 写进 `X-CompanyCam-User`:CompanyCam 用它把操作记在某个成员名下,而非令牌所有者。 */
  currentUserEmail?: string
  method: string
  path: string
  query?: Record<string, string | undefined>
}

/** 上游 `optionalString`:只有非空(去空白后)字符串才算给了值。 */
function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : undefined
}

/** 路径参数必须非空:schema 把这些 id 标成了 optional,拼进 URL 前得自己挡一道。 */
function pathSegment(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new TBError('invalid_argument', `${field} 不能为空`)
  }
  return encodeURIComponent(value)
}

/** CompanyCam 的错误体形状不固定:`errors` 数组、`error`、`message`、`detail` 都出现过。 */
function errorMessage(payload: unknown, status: number): string {
  const object = record(payload)
  if (object !== undefined) {
    const errors = object.errors
    if (Array.isArray(errors)) {
      const first = errors.find(item => typeof item === 'string')
      if (typeof first === 'string' && first !== '') return first
    }
    const message = text(object.error) ?? text(object.message) ?? text(object.detail)
    if (message !== undefined) return message
  }
  return `CompanyCam request failed with status ${status}`
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  const url = new URL(`${API_BASE}${input.path}`)
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value)
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
  }
  if (input.body !== undefined) headers['content-type'] = 'application/json'
  if (input.currentUserEmail !== undefined) headers['x-companycam-user'] = input.currentUserEmail

  const response = await guardedFetch(url.toString(), {
    method: input.method,
    headers,
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  })

  // 空体是合法的成功响应(DELETE 常这样),先按文本读再决定要不要解析。
  const body = await response.text().catch(() => '')
  let payload: unknown = {}
  if (body.trim() !== '') {
    try {
      payload = JSON.parse(body)
    } catch {
      throw new TBError('unavailable', 'CompanyCam 返回了非 JSON 响应', { retryable: true })
    }
  }

  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response.status))
  return payload
}

// —— 出参归一 ——

/** 上游 `asNullableString`:非字符串或空白串一律落成 null,不让 undefined 漏进出参。 */
function nullableText(value: unknown): string | null {
  return text(value) ?? null
}

function nullableInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function objectArray(value: unknown): Json[] {
  return Array.isArray(value) ? value.map(item => record(item) ?? {}) : []
}

function normalizeImage(input: Json): Json {
  return {
    type: nullableText(input.type),
    uri: nullableText(input.uri),
    url: nullableText(input.url),
  }
}

function normalizeAddress(input: Json): Json {
  return {
    streetAddress1: nullableText(input.street_address_1),
    streetAddress2: nullableText(input.street_address_2),
    city: nullableText(input.city),
    state: nullableText(input.state),
    postalCode: nullableText(input.postal_code),
    country: nullableText(input.country),
  }
}

function nullableAddress(value: unknown): Json | null {
  const object = record(value)
  return object === undefined ? null : normalizeAddress(object)
}

function normalizeCoordinate(input: Json): Json {
  return {
    lat: typeof input.lat === 'number' && Number.isFinite(input.lat) ? input.lat : 0,
    lon: typeof input.lon === 'number' && Number.isFinite(input.lon) ? input.lon : 0,
  }
}

function nullableCoordinate(value: unknown): Json | null {
  const object = record(value)
  return object === undefined ? null : normalizeCoordinate(object)
}

function normalizeCompany(input: Json): Json {
  return {
    id: nullableText(input.id),
    name: nullableText(input.name),
    status: nullableText(input.status),
    address: nullableAddress(input.address),
    logo: objectArray(input.logo).map(normalizeImage),
    raw: input,
  }
}

function normalizeProject(input: Json): Json {
  return {
    id: nullableText(input.id),
    companyId: nullableText(input.company_id),
    creatorId: nullableText(input.creator_id),
    creatorType: nullableText(input.creator_type),
    creatorName: nullableText(input.creator_name),
    status: nullableText(input.status),
    archived: nullableBoolean(input.archived),
    name: nullableText(input.name),
    address: nullableAddress(input.address),
    coordinates: nullableCoordinate(input.coordinates),
    featuredImage: objectArray(input.featured_image).map(normalizeImage),
    projectUrl: nullableText(input.project_url),
    embeddedProjectUrl: nullableText(input.embedded_project_url),
    slug: nullableText(input.slug),
    public: nullableBoolean(input.public),
    geofence: objectArray(input.geofence).map(normalizeCoordinate),
    notepad: nullableText(input.notepad),
    createdAt: nullableInteger(input.created_at),
    updatedAt: nullableInteger(input.updated_at),
    raw: input,
  }
}

function normalizeUser(input: Json): Json {
  return {
    id: nullableText(input.id),
    companyId: nullableText(input.company_id),
    emailAddress: nullableText(input.email_address),
    status: nullableText(input.status),
    firstName: nullableText(input.first_name),
    lastName: nullableText(input.last_name),
    profileImage: objectArray(input.profile_image).map(normalizeImage),
    phoneNumber: nullableText(input.phone_number),
    createdAt: nullableInteger(input.created_at),
    updatedAt: nullableInteger(input.updated_at),
    userUrl: nullableText(input.user_url),
    raw: input,
  }
}

function normalizeTag(input: Json): Json {
  return {
    id: nullableText(input.id),
    companyId: nullableText(input.company_id),
    displayValue: nullableText(input.display_value),
    value: nullableText(input.value),
    createdAt: nullableInteger(input.created_at),
    updatedAt: nullableInteger(input.updated_at),
    raw: input,
  }
}

// —— 入参映射 ——

/** `undefined` 的键不进对象:JSON.stringify 会丢弃它们,但显式构造更好读。 */
function compact(input: Json): Json {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

function paginationQuery(input: { page?: number, perPage?: number }): Record<string, string | undefined> {
  return {
    page: input.page === undefined ? undefined : String(input.page),
    per_page: input.perPage === undefined ? undefined : String(input.perPage),
  }
}

type ProjectMutation = z.infer<typeof createProjectInput> | z.infer<typeof updateProjectInput>

function projectMutationBody(input: ProjectMutation): Json {
  const address = 'address' in input ? input.address : undefined
  const coordinates = input.coordinates
  const primaryContact = 'primaryContact' in input ? input.primaryContact : undefined
  return compact({
    name: input.name,
    address: address === undefined
      ? undefined
      : compact({
          street_address_1: address.streetAddress1,
          street_address_2: address.streetAddress2,
          city: address.city,
          state: address.state,
          postal_code: address.postalCode,
          country: address.country,
        }),
    coordinates: coordinates === undefined
      ? undefined
      : compact({ lat: coordinates.lat, lon: coordinates.lon }),
    geofence: input.geofence?.map(point => compact({ lat: point.lat, lon: point.lon })),
    primary_contact: primaryContact === undefined
      ? undefined
      : compact({
          name: primaryContact.name,
          email: primaryContact.email,
          phone_number: primaryContact.phoneNumber,
        }),
  })
}

// —— handlers ——

export async function getCompany(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const payload = record(await request(ctx, { method: 'GET', path: '/company' })) ?? {}
  return { company: normalizeCompany(payload), raw: payload }
}

export async function getCurrentUser(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const payload = record(await request(ctx, { method: 'GET', path: '/users/current' })) ?? {}
  return { user: normalizeUser(payload), raw: payload }
}

export async function listProjects(
  input: z.infer<typeof listProjectsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const items = objectArray(await request(ctx, {
    method: 'GET',
    path: '/projects',
    query: { ...paginationQuery(input), query: input.query, modified_since: input.modifiedSince },
  }))
  return { projects: items.map(normalizeProject), raw: items }
}

export async function getProject(
  input: z.infer<typeof getProjectInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = record(await request(ctx, {
    method: 'GET',
    path: `/projects/${pathSegment(input.projectId, 'projectId')}`,
  })) ?? {}
  return { project: normalizeProject(payload), raw: payload }
}

export async function createProject(
  input: z.infer<typeof createProjectInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = record(await request(ctx, {
    method: 'POST',
    path: '/projects',
    body: projectMutationBody(input),
    currentUserEmail: input.currentUserEmail,
  })) ?? {}
  return { project: normalizeProject(payload), raw: payload }
}

export async function updateProject(
  input: z.infer<typeof updateProjectInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = record(await request(ctx, {
    method: 'PUT',
    path: `/projects/${pathSegment(input.projectId, 'projectId')}`,
    body: projectMutationBody(input),
  })) ?? {}
  return { project: normalizeProject(payload), raw: payload }
}

export async function archiveProject(
  input: z.infer<typeof archiveProjectInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 归档是 PATCH、恢复是 PUT —— 不对称是 CompanyCam API 本身如此,别顺手对齐。
  const payload = record(await request(ctx, {
    method: 'PATCH',
    path: `/projects/${pathSegment(input.projectId, 'projectId')}/archive`,
  })) ?? {}
  return { project: normalizeProject(payload), raw: payload }
}

export async function restoreProject(
  input: z.infer<typeof restoreProjectInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = record(await request(ctx, {
    method: 'PUT',
    path: `/projects/${pathSegment(input.projectId, 'projectId')}/restore`,
  })) ?? {}
  return { project: normalizeProject(payload), raw: payload }
}

export async function listUsers(
  input: z.infer<typeof listUsersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const items = objectArray(await request(ctx, {
    method: 'GET',
    path: '/users',
    query: paginationQuery(input),
  }))
  return { users: items.map(normalizeUser), raw: items }
}

export async function getUser(
  input: z.infer<typeof getUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = record(await request(ctx, {
    method: 'GET',
    path: `/users/${pathSegment(input.userId, 'userId')}`,
  })) ?? {}
  return { user: normalizeUser(payload), raw: payload }
}

export async function listTags(
  input: z.infer<typeof listTagsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const items = objectArray(await request(ctx, {
    method: 'GET',
    path: '/tags',
    query: paginationQuery(input),
  }))
  return { tags: items.map(normalizeTag), raw: items }
}

export async function getTag(
  input: z.infer<typeof getTagInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = record(await request(ctx, {
    method: 'GET',
    path: `/tags/${pathSegment(input.tagId, 'tagId')}`,
  })) ?? {}
  return { tag: normalizeTag(payload), raw: payload }
}

export async function createTag(
  input: z.infer<typeof createTagInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = record(await request(ctx, {
    method: 'POST',
    path: '/tags',
    body: { tag: { display_value: input.displayValue } },
  })) ?? {}
  return { tag: normalizeTag(payload), raw: payload }
}

export async function updateTag(
  input: z.infer<typeof updateTagInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = record(await request(ctx, {
    method: 'PUT',
    path: `/tags/${pathSegment(input.tagId, 'tagId')}`,
    body: { tag: { display_value: input.displayValue } },
  })) ?? {}
  return { tag: normalizeTag(payload), raw: payload }
}

export async function deleteTag(
  input: z.infer<typeof deleteTagInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = record(await request(ctx, {
    method: 'DELETE',
    path: `/tags/${pathSegment(input.tagId, 'tagId')}`,
  })) ?? {}
  return { deleted: true, raw: payload }
}
