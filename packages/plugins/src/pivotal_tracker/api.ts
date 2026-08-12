/**
 * Pivotal Tracker 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/pivotal_tracker/executors.ts`(它走的是共用的
 * `http-json-runtime`,这里把那层展开成本地实现),语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 两处需要留意:
 * - 凭证走 **`X-TrackerToken` 头**,不是 Bearer。
 * - base URL 带 `/services/v5` 路径段,`new URL(path, base)` 会把它吃掉,所以拼接时
 *   给 base 补尾斜杠、给 path 去前导斜杠(上游 `buildJsonRequestUrl` 也是这么做的)。
 *
 * 上游把 400/404/422 一律压成 400 的分支不保留:状态码归一由共用的 `upstreamError`
 * 统一口径(404 → not_found)。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createStoryCommentInput,
  createStoryInput,
  getProjectInput,
  getStoryInput,
  listProjectsInput,
  listProjectStoriesInput,
  listStoryCommentsInput,
  updateStoryStateInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'pivotal_tracker'
const API_BASE = 'https://www.pivotaltracker.com/services/v5'

type Json = Record<string, unknown>

function asRecord(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined
}

/** 上游 `optionalString` 的语义:先 trim,空则视为缺失。 */
function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 上游 `definedBody` 的语义:丢掉值为 undefined 的键,而不是发 null。 */
function defined(input: Json): Json {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

/**
 * 路径参数拼进 URL 前先挡住。
 *
 * 生成的 schema 把 update_story_state / create_story_comment 的 projectId、storyId 放成了
 * optional(生成器对"没有 optional 列表的 `s.object`"整体判为可选),而上游要求必填 ——
 * 缺了就本地 400,免得打出 `/projects/undefined/stories/undefined`。
 *
 * 另:上游 `pathId` 走 `requiredString`,只收字符串,可 schema 声明的是整数,即上游对任何
 * 合乎自己 schema 的入参都会炸。这里以 schema 为准收整数再 stringify。
 */
function pathId(value: number | undefined, field: string): string {
  if (value === undefined) throw new TBError('invalid_argument', `${field} 不能为空`)
  return encodeURIComponent(String(value))
}

/** Tracker 的错误消息在这八个键里挑第一个能用的。 */
function errorMessage(payload: unknown): string | undefined {
  const direct = optionalText(payload)
  if (direct !== undefined) return direct
  const record = asRecord(payload)
  if (record === undefined) return undefined
  return optionalText(record.message)
    ?? optionalText(record.Message)
    ?? optionalText(record.error)
    ?? optionalText(record.Error)
    ?? optionalText(record.detail)
    ?? optionalText(record.Detail)
    ?? optionalText(record.title)
    ?? optionalText(record.Title)
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.trim() === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw upstreamError(502, 'Pivotal Tracker 返回了非法 JSON')
  }
}

/** list 类响应契约上是数组;不是就是上游破了契约,不是调用方的错。 */
function arrayPayload(payload: unknown, field: string): unknown[] {
  if (Array.isArray(payload)) return payload
  throw upstreamError(502, `Pivotal Tracker 的 ${field} 返回了非数组`)
}

interface RequestInput {
  body?: Json
  method?: 'GET' | 'POST' | 'PUT'
  path: string
  query?: Record<string, unknown>
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  const apiKey = requireApiKey(ctx, SERVICE)
  const url = new URL(input.path.replace(/^\//, ''), `${API_BASE}/`)
  for (const [key, value] of Object.entries(input.query ?? {})) {
    // 上游 `queryParams` 的口径:undefined / null / 空串都不发。
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = {
    'accept': 'application/json',
    'X-TrackerToken': apiKey,
  }
  if (input.body !== undefined) headers['content-type'] = 'application/json'

  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method: input.method ?? (input.body === undefined ? 'GET' : 'POST'),
      headers,
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障,还丢掉唯一有诊断价值的那句消息。
    throw upstreamError(
      502,
      error instanceof Error
        ? `Pivotal Tracker 请求失败: ${error.message}`
        : 'Pivotal Tracker 请求失败',
    )
  }

  const payload = await readPayload(response)
  if (!response.ok) {
    throw upstreamError(
      response.status,
      errorMessage(payload) ?? `Pivotal Tracker 请求失败(HTTP ${response.status})`,
    )
  }
  return payload
}

/** limit / offset / fields 三个参数在四个 list 动作里同名同义。 */
function paginationQuery(
  input: { fields?: string, limit?: number, offset?: number },
): Record<string, unknown> {
  return { limit: input.limit, offset: input.offset, fields: input.fields }
}

export async function getCurrentUser(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return { user: await request(ctx, { path: '/me' }) }
}

export async function listProjects(
  input: z.infer<typeof listProjectsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, { path: '/projects', query: paginationQuery(input) })
  return { projects: arrayPayload(payload, 'projects') }
}

export async function getProject(
  input: z.infer<typeof getProjectInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/projects/${pathId(input.projectId, 'projectId')}`
  return { project: await request(ctx, { path, query: { fields: input.fields } }) }
}

export async function listProjectStories(
  input: z.infer<typeof listProjectStoriesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/projects/${pathId(input.projectId, 'projectId')}/stories`
  const payload = await request(ctx, {
    path,
    query: {
      filter: input.filter,
      with_state: input.withState,
      with_story_type: input.withStoryType,
      ...paginationQuery(input),
    },
  })
  return { stories: arrayPayload(payload, 'stories') }
}

export async function getStory(
  input: z.infer<typeof getStoryInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/projects/${pathId(input.projectId, 'projectId')}`
    + `/stories/${pathId(input.storyId, 'storyId')}`
  return { story: await request(ctx, { path, query: { fields: input.fields } }) }
}

export async function createStory(
  input: z.infer<typeof createStoryInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/projects/${pathId(input.projectId, 'projectId')}/stories`
  return {
    story: await request(ctx, {
      method: 'POST',
      path,
      body: defined({
        name: input.name,
        story_type: input.storyType,
        current_state: input.currentState,
        description: input.description,
        estimate: input.estimate,
        requested_by_id: input.requestedById,
        owner_ids: input.ownerIds,
        // Tracker 的标签是对象数组,入参给的是纯名字。
        labels: input.labelNames?.map(name => ({ name })),
      }),
    }),
  }
}

export async function updateStoryState(
  input: z.infer<typeof updateStoryStateInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/projects/${pathId(input.projectId, 'projectId')}`
    + `/stories/${pathId(input.storyId, 'storyId')}`
  if (input.currentState === undefined) {
    throw new TBError('invalid_argument', 'currentState 不能为空')
  }
  return {
    story: await request(ctx, { method: 'PUT', path, body: { current_state: input.currentState } }),
  }
}

export async function listStoryComments(
  input: z.infer<typeof listStoryCommentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/projects/${pathId(input.projectId, 'projectId')}`
    + `/stories/${pathId(input.storyId, 'storyId')}/comments`
  const payload = await request(ctx, { path, query: paginationQuery(input) })
  return { comments: arrayPayload(payload, 'comments') }
}

export async function createStoryComment(
  input: z.infer<typeof createStoryCommentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/projects/${pathId(input.projectId, 'projectId')}`
    + `/stories/${pathId(input.storyId, 'storyId')}/comments`
  if (input.text === undefined) {
    throw new TBError('invalid_argument', 'text 不能为空')
  }
  return { comment: await request(ctx, { method: 'POST', path, body: { text: input.text } }) }
}
