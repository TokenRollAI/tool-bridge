/**
 * Todoist(API v1)的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/todoist/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。凭证走 `Authorization: Bearer` 请求头,不进 URL。
 *
 * **端点是 `https://api.todoist.com/api/v1`**(不是已停用的 REST v2):上游钉死的就是 v1,
 * 它的分页是 `{results, next_cursor}`、写操作统统用 POST(没有 PUT/PATCH)—— 出参形状与
 * 请求方法都由此而来。
 *
 * 只迁 api_key 这条凭证路径。上游 `definition.ts` 还声明了 OAuth2(authorize/token 端点),
 * 那条路径要平台的 providerOAuth 支撑;好在两者拿到的都是 Bearer token,handler 一行都不用改,
 * 补 OAuth 时只需在 index.ts 上加 `oauth` 声明(那时要去掉 credentialProbe/credentialFields ——
 * SDK 侧互斥)。
 *
 * 五处上游细节决定了这里的形状:
 * - **写操作全是 POST**,更新与创建打同一族路径(`/tasks/{id}` 而不是 PATCH),漏了这点会 405。
 * - **分页是 opaque cursor**:出参的 `nextCursor` 直接来自上游 `next_cursor`,拿不到给 `null`
 *   (不是省略键)—— 调用方靠它判断"还有没有下一页"。
 * - **`results` 缺失是契约破了**:list 类端点必须回 `{results: [...]}`,不是就归 unavailable。
 * - **update 类 action 的字段是"三态"**:未给(不改)、`null`(清空)、有值(改成它)。故这几个
 *   body 字段**原样透传**,只丢 undefined 而保留 null —— 用 `optionalString` 那种"空即无"的
 *   语义会把"清空"变成"不改"。
 * - **评论的附件键上游有两个名字**(`attachment` 与 `file_attachment`),整形时归一到 `attachment`。
 *
 * 与上游的两处有意偏离:
 * - **错误归一**:上游把 `notFoundAsInvalidInput` 的 404 压成 400、5xx 压成 502。这里走公共
 *   `upstreamError` 按状态归一 —— 调用方要能区分"参数不对"和"这个 task 不存在"。
 * - **`folderId` / `workspaceId` 的字符串形态**:上游用 `optionalInteger` 取它们,于是 schema
 *   明明声明了 `int | string`、传字符串却被**静默丢掉** —— 调用方以为筛过了,拿到的是全量。
 *   这里两种形态都发出去(由 Todoist 判合法性),不做静默丢弃。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  closeTaskInput,
  createCommentInput,
  createProjectInput,
  createSectionInput,
  createTaskInput,
  getCommentInput,
  getProjectInput,
  getSectionInput,
  getTaskInput,
  listCommentsInput,
  listLabelsInput,
  listProjectsInput,
  listSectionsInput,
  listTasksInput,
  updateCommentInput,
  updateProjectInput,
  updateSectionInput,
  updateTaskInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'todoist'
const API_BASE = 'https://api.todoist.com/api/v1'
const USER_PATH = '/user'

type Json = Record<string, unknown>
type QueryValue = number | string | string[] | undefined

interface RequestInput {
  body?: Json
  method?: 'GET' | 'POST'
  path: string
  query?: Record<string, QueryValue>
}

/** 上游 `optionalString` 的等价物:去空白后仍非空才算有值(Zod 的 `min(1)` 拦不住纯空白串)。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 丢掉值为 undefined 的键(上游 `compactObject`);**`null` 要留住**(update 的"清空"语义)。 */
function compact(input: Record<string, unknown>): Json {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

/**
 * 上游 `requiredString(..., invalidInput)`:生成的 schema 里这些 id 一半是 optional
 * (上游 34% 的 action 没有 required 声明),必填断言只能留在本层。消息与上游逐字一致。
 */
function requireText(value: unknown, field: string): string {
  const result = text(value)
  if (result === undefined) throw new TBError('invalid_argument', `${field} is required.`)
  return result
}

/** 上游 `buildStringArray`:逐项去空白、丢空,全空则整个字段不发。 */
function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.map(item => text(item)).filter((item): item is string => item !== undefined)
  return items.length > 0 ? items : undefined
}

function requireRecord(value: unknown, label: string): Json {
  const result = record(value)
  // 契约说好是对象;不是就是上游出问题,不是调用方的错。
  if (result === undefined) throw new TBError('unavailable', `${label}不是对象`, { retryable: true })
  return result
}

/** Todoist 的错误文案:error / error_description / message / detail,最后 errors[] 里的第一条串。 */
function errorMessage(status: number, payload: unknown): string {
  const body = record(payload)
  const direct = text(body?.error)
    ?? text(body?.error_description)
    ?? text(body?.message)
    ?? text(body?.detail)
  if (direct !== undefined) return direct
  if (Array.isArray(body?.errors)) {
    const first = body.errors.find((item): item is string => text(item) !== undefined)
    if (first !== undefined) return first
  }
  return `todoist request failed with ${status}`
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  const url = new URL(input.path.replace(/^\/+/, ''), `${API_BASE}/`)
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value === undefined) continue
    // 多值参数(list_tasks 的 ids)是**逗号串**,不是重复的同名参数。
    url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value))
  }

  const hasBody = input.body !== undefined
  const response = await guardedFetch(url.toString(), {
    method: input.method ?? 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
    },
    body: hasBody ? JSON.stringify(input.body) : undefined,
  })

  const raw = await response.text()
  let payload: unknown = {}
  if (raw !== '') {
    try {
      payload = JSON.parse(raw)
    } catch {
      // 2xx 上回非 JSON 只能是上游坏了;错误响应回 HTML 错误页很常见,那时把正文当消息、
      // 按 HTTP 状态归一,比报"响应不是 JSON"准。
      if (response.ok) {
        throw new TBError('unavailable', 'Todoist 返回了非 JSON 响应', { retryable: true })
      }
      payload = { message: raw }
    }
  }

  if (!response.ok) throw upstreamError(response.status, errorMessage(response.status, payload))
  return payload
}

/** list 类端点的 `{results, next_cursor}`:results 缺失或不是数组即契约破了。 */
function results(payload: unknown, label: string): Json[] {
  const body = requireRecord(payload, `${label} 响应`)
  if (!Array.isArray(body.results)) {
    throw new TBError('unavailable', `${label} 响应缺少 results`, { retryable: true })
  }
  return body.results.map(item => record(item)).filter((item): item is Json => item !== undefined)
}

/** 拿不到游标时给 `null`,不是省略键 —— 调用方靠它判断有没有下一页。 */
function nextCursor(payload: unknown): string | null {
  return text(record(payload)?.next_cursor) ?? null
}

/**
 * `folderId` / `workspaceId` 在 schema 里是 `int | string`。上游用 `optionalInteger` 取,
 * 于是字符串形态被**静默丢掉**(声明接受、实际忽略)—— 这里两种形态都发,让 Todoist 判合法性。
 */
function idValue(value: unknown): number | string | undefined {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  return text(value)
}

/** 上游 `normalizeComment`:附件上游有 `attachment` 与 `file_attachment` 两个名字,归一到前者。 */
function normalizeComment(payload: unknown): Json {
  const comment = requireRecord(payload, 'todoist comment')
  return compact({
    ...comment,
    attachment: record(comment.attachment) ?? record(comment.file_attachment),
  })
}

/** 上游 `buildCommentAttachment`:snake_case 化,逐字段去空白后仍非空才发。 */
function commentAttachment(value: unknown): Json | undefined {
  const attachment = record(value)
  if (attachment === undefined) return undefined
  return compact({
    file_url: text(attachment.fileUrl),
    file_name: text(attachment.fileName),
    file_type: text(attachment.fileType),
    resource_type: text(attachment.resourceType),
  })
}

/** 上游 `buildNotifyUserIds`:只留整数,全空则整个字段不发。 */
function notifyUserIds(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const ids = value.filter((item): item is number => typeof item === 'number' && Number.isInteger(item))
  return ids.length > 0 ? ids : undefined
}

/**
 * create 与 update 共用一份 task body。差别只在 `content`:创建时必填,更新时可不带
 * (**其余字段一律原样透传** —— 更新的 `null` 表示"清空",用"空即无"的语义会把它吃掉)。
 */
function taskBody(input: Json, isCreate: boolean): Json {
  return compact({
    content: isCreate ? requireText(input.content, 'content') : text(input.content),
    description: input.description,
    project_id: text(input.projectId),
    section_id: text(input.sectionId),
    parent_id: text(input.parentId),
    order: input.order,
    labels: stringArray(input.labels),
    priority: input.priority,
    assignee_id: input.assigneeId,
    due_string: text(input.dueString),
    due_date: text(input.dueDate),
    due_datetime: text(input.dueDatetime),
    due_lang: text(input.dueLang),
    duration: input.duration,
    duration_unit: input.durationUnit,
    deadline_date: input.deadlineDate,
    child_order: input.childOrder,
    is_collapsed: input.isCollapsed,
    day_order: input.dayOrder,
  })
}

export async function getCurrentUser(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return { user: requireRecord(await request(ctx, { path: USER_PATH }), 'todoist user 响应') }
}

export async function listProjects(
  input: z.infer<typeof listProjectsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: '/projects',
    query: {
      folder_id: idValue(input.folderId),
      workspace_id: idValue(input.workspaceId),
      cursor: text(input.cursor),
      limit: input.limit,
    },
  })
  return { projects: results(payload, 'todoist projects'), nextCursor: nextCursor(payload) }
}

export async function getProject(input: z.infer<typeof getProjectInput>, ctx: ProviderContext): Promise<Json> {
  const path = `/projects/${encodeURIComponent(requireText(input.projectId, 'projectId'))}`
  return { project: requireRecord(await request(ctx, { path }), 'todoist project 响应') }
}

export async function createProject(
  input: z.infer<typeof createProjectInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: '/projects',
    method: 'POST',
    body: compact({
      name: requireText(input.name, 'name'),
      description: text(input.description),
      // 上游显式区分 null(建成顶层项目)与"未给"(不带这个键)。
      parent_id: input.parentId === null ? null : text(input.parentId),
      color: input.color,
      is_favorite: input.isFavorite,
      view_style: text(input.viewStyle),
      workspace_id: idValue(input.workspaceId),
    }),
  })
  return { project: requireRecord(payload, 'todoist project 响应') }
}

export async function updateProject(
  input: z.infer<typeof updateProjectInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/projects/${encodeURIComponent(requireText(input.projectId, 'projectId'))}`,
    method: 'POST',
    // 更新是三态字段:未给不改、null 清空、有值改成它 —— 故原样透传。
    body: compact({
      name: input.name,
      description: input.description,
      color: input.color,
      is_favorite: input.isFavorite,
      view_style: input.viewStyle,
      child_order: input.childOrder,
      is_collapsed: input.isCollapsed,
      folder_id: input.folderId,
    }),
  })
  return { project: requireRecord(payload, 'todoist project 响应') }
}

export async function listSections(
  input: z.infer<typeof listSectionsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: '/sections',
    query: { project_id: text(input.projectId), cursor: text(input.cursor), limit: input.limit },
  })
  return { sections: results(payload, 'todoist sections'), nextCursor: nextCursor(payload) }
}

export async function getSection(input: z.infer<typeof getSectionInput>, ctx: ProviderContext): Promise<Json> {
  const path = `/sections/${encodeURIComponent(requireText(input.sectionId, 'sectionId'))}`
  return { section: requireRecord(await request(ctx, { path }), 'todoist section 响应') }
}

export async function createSection(
  input: z.infer<typeof createSectionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: '/sections',
    method: 'POST',
    body: compact({
      name: requireText(input.name, 'name'),
      project_id: requireText(input.projectId, 'projectId'),
      order: input.order,
    }),
  })
  return { section: requireRecord(payload, 'todoist section 响应') }
}

export async function updateSection(
  input: z.infer<typeof updateSectionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/sections/${encodeURIComponent(requireText(input.sectionId, 'sectionId'))}`,
    method: 'POST',
    body: compact({
      name: input.name,
      section_order: input.sectionOrder,
      is_collapsed: input.isCollapsed,
    }),
  })
  return { section: requireRecord(payload, 'todoist section 响应') }
}

export async function listTasks(input: z.infer<typeof listTasksInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    path: '/tasks',
    query: {
      project_id: text(input.projectId),
      section_id: text(input.sectionId),
      parent_id: text(input.parentId),
      label: text(input.label),
      ids: stringArray(input.ids),
      goal_id: text(input.goalId),
      cursor: text(input.cursor),
      limit: input.limit,
    },
  })
  return { tasks: results(payload, 'todoist tasks'), nextCursor: nextCursor(payload) }
}

export async function getTask(input: z.infer<typeof getTaskInput>, ctx: ProviderContext): Promise<Json> {
  const path = `/tasks/${encodeURIComponent(requireText(input.taskId, 'taskId'))}`
  return { task: requireRecord(await request(ctx, { path }), 'todoist task 响应') }
}

export async function createTask(input: z.infer<typeof createTaskInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, { path: '/tasks', method: 'POST', body: taskBody(input, true) })
  return { task: requireRecord(payload, 'todoist task 响应') }
}

export async function updateTask(input: z.infer<typeof updateTaskInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    path: `/tasks/${encodeURIComponent(requireText(input.taskId, 'taskId'))}`,
    method: 'POST',
    body: taskBody(input, false),
  })
  return { task: requireRecord(payload, 'todoist task 响应') }
}

export async function closeTask(input: z.infer<typeof closeTaskInput>, ctx: ProviderContext): Promise<Json> {
  // 关闭成功时 Todoist 回 204 空体,没有可裁剪的出参 —— 出参声明就是 {success: true}。
  await request(ctx, {
    path: `/tasks/${encodeURIComponent(requireText(input.taskId, 'taskId'))}/close`,
    method: 'POST',
  })
  return { success: true }
}

export async function listComments(
  input: z.infer<typeof listCommentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: '/comments',
    query: {
      task_id: text(input.taskId),
      project_id: text(input.projectId),
      cursor: text(input.cursor),
      limit: input.limit,
    },
  })
  return {
    comments: results(payload, 'todoist comments').map(comment => normalizeComment(comment)),
    nextCursor: nextCursor(payload),
  }
}

export async function getComment(input: z.infer<typeof getCommentInput>, ctx: ProviderContext): Promise<Json> {
  const path = `/comments/${encodeURIComponent(requireText(input.commentId, 'commentId'))}`
  return { comment: normalizeComment(await request(ctx, { path })) }
}

export async function createComment(
  input: z.infer<typeof createCommentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: '/comments',
    method: 'POST',
    body: compact({
      content: requireText(input.content, 'content'),
      task_id: text(input.taskId),
      project_id: text(input.projectId),
      attachment: commentAttachment(input.attachment),
      uids_to_notify: notifyUserIds(input.uidsToNotify),
    }),
  })
  return { comment: normalizeComment(payload) }
}

export async function updateComment(
  input: z.infer<typeof updateCommentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/comments/${encodeURIComponent(requireText(input.commentId, 'commentId'))}`,
    method: 'POST',
    // 更新评论只改正文,且正文必填(生成的 schema 里它是 optional,断言留在本层)。
    body: { content: requireText(input.content, 'content') },
  })
  return { comment: normalizeComment(payload) }
}

export async function listLabels(input: z.infer<typeof listLabelsInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    path: '/labels',
    query: { cursor: text(input.cursor), limit: input.limit },
  })
  return { labels: results(payload, 'todoist labels'), nextCursor: nextCursor(payload) }
}
