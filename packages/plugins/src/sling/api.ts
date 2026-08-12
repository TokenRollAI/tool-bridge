/**
 * Sling 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/sling/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 全部 14 个 action 都是 GET,响应统一套进一个具名键(`session`/`users`/`shift`…),
 * 差别只在路径与 query 过滤器。
 *
 * 两处有意偏离上游:
 * - 上游 `createSlingError` 把 5xx 压成 502。这里把原始状态交给 `upstreamError`,归一后
 *   同为 unavailable+retryable,少一次状态改写。
 * - 上游对路径里的 id 直接 `String(input.xxx)`,入参缺失时会去请求 `/users/undefined`
 *   并拿回一个含糊的 4xx。schema 把这些 id 标成了可选(上游 action 定义如此),这里改成
 *   本地挡下,不发一个必定失败的请求。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getDetailedShiftInput,
  getGroupInput,
  getNextShiftInput,
  getShiftInput,
  getTaskInput,
  getUserInput,
  listCalendarEventsInput,
  listGroupsInput,
  listShiftCoworkersInput,
  listTasksInput,
  listUsersInput,
  listWorkingUsersInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'sling'
const API_BASE = 'https://api.getsling.com/v1/'

type Json = Record<string, unknown>
type QueryValue = boolean | number | string | readonly (number | string)[] | undefined

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') return text(payload)
  const body = record(payload)
  return text(body?.message) ?? text(body?.error) ?? text(body?.detail)
}

/**
 * 成功响应必须是合法 JSON;失败响应允许是纯文本(Sling 的 4xx 有时回一句话),
 * 此时把原文交给消息提取,而不是把它当成"响应损坏"。
 */
async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text().catch(() => '')
  if (body.trim() === '') return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    if (!response.ok) return body.trim()
    throw upstreamError(502, 'Sling returned invalid JSON')
  }
}

async function get(ctx: ProviderContext, path: string, query: Record<string, QueryValue> = {}): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  const url = new URL(path.startsWith('/') ? path.slice(1) : path, API_BASE)
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    // 多值过滤器是逗号拼接,不是重复同名键。
    url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value))
  }

  let response: Response
  let payload: unknown
  try {
    response = await guardedFetch(url.toString(), {
      // Sling 的凭证是**裸 token**,没有 Bearer 前缀。
      method: 'GET',
      headers: { accept: 'application/json', authorization: apiKey },
    })
    payload = await readPayload(response)
  } catch (error) {
    if (error instanceof TBError) throw error
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error" 500。
    throw upstreamError(502, error instanceof Error ? `Sling request failed: ${error.message}` : 'Sling request failed')
  }

  if (!response.ok) {
    throw upstreamError(
      response.status,
      errorMessage(payload) ?? `Sling request failed with status ${response.status}`,
    )
  }
  // 空体归一成 `{}`,让每个 action 的出参形状稳定(调用方总能拿到那个具名键)。
  return payload ?? {}
}

/** 每个 action 都把上游 payload 套进一个具名键;这层就是那个约定。 */
async function wrapped(
  ctx: ProviderContext,
  key: string,
  path: string,
  query?: Record<string, QueryValue>,
): Promise<Json> {
  return { [key]: await get(ctx, path, query) }
}

/**
 * schema 把若干路径 id 标成了可选(上游 action 定义如此),但它们是路径的一部分,缺了就
 * 拼不出 URL。以上游 executor 的实际要求为准在本地挡下。
 */
function requirePathId(value: number | string | undefined, fieldName: string): string {
  if (value === undefined) throw new TBError('invalid_argument', `${fieldName} is required`)
  return encodeURIComponent(String(value))
}

export async function getCurrentSession(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return wrapped(ctx, 'session', '/account/session')
}

export async function listUsers(
  input: z.infer<typeof listUsersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return wrapped(ctx, 'users', '/users', {
    query: input.query,
    ids: input.ids,
    includeDeleted: input.includeDeleted,
  })
}

export async function getUser(
  input: z.infer<typeof getUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return wrapped(ctx, 'user', `/users/${requirePathId(input.userId, 'userId')}`)
}

export async function listGroups(
  input: z.infer<typeof listGroupsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return wrapped(ctx, 'groups', '/groups', { ids: input.ids, type: input.type })
}

export async function getGroup(
  input: z.infer<typeof getGroupInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return wrapped(ctx, 'group', `/groups/${requirePathId(input.groupId, 'groupId')}`)
}

export async function listCalendarEvents(
  input: z.infer<typeof listCalendarEventsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/calendar/${encodeURIComponent(String(input.orgId))}/users/${encodeURIComponent(String(input.userId))}`
  return wrapped(ctx, 'events', path, {
    dates: input.dates,
    locationIds: input.locationIds,
    positionIds: input.positionIds,
    tagIds: input.tagIds,
    excludeTagIds: input.excludeTagIds,
    userIds: input.userIds,
    groupIds: input.groupIds,
    excludeGroupIds: input.excludeGroupIds,
    dayPartIds: input.dayPartIds,
    excludeDayPartIds: input.excludeDayPartIds,
    eventTypes: input.eventTypes,
    groupBy: input.groupBy,
    pageSize: input.pageSize,
    page: input.page,
    skipUnscheduled: input.skipUnscheduled,
    showPlanningEvents: input.showPlanningEvents,
  })
}

export async function getShift(
  input: z.infer<typeof getShiftInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return wrapped(ctx, 'shift', `/shifts/${encodeURIComponent(input.shiftId)}`, {
    includeTimesheets: input.includeTimesheets,
  })
}

export async function getDetailedShift(
  input: z.infer<typeof getDetailedShiftInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return wrapped(ctx, 'shift', `/shifts/${requirePathId(input.shiftId, 'shiftId')}/detailed`)
}

export async function listShiftCoworkers(
  input: z.infer<typeof listShiftCoworkersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return wrapped(ctx, 'coworkers', `/shifts/${requirePathId(input.shiftId, 'shiftId')}/coworkers`)
}

export async function getCurrentShift(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return wrapped(ctx, 'shift', '/shifts/current')
}

export async function getNextShift(
  input: z.infer<typeof getNextShiftInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return wrapped(ctx, 'shift', '/shifts/next', { referenceDate: input.referenceDate })
}

export async function listWorkingUsers(
  input: z.infer<typeof listWorkingUsersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return wrapped(ctx, 'users', '/calendar/working', { date: input.date })
}

export async function listTasks(
  input: z.infer<typeof listTasksInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return wrapped(ctx, 'tasks', '/tasks', {
    filter: input.filter,
    since: input.since,
    before: input.before,
    // 官方 query 键是全小写的 `pagesize`,与入参名 `pageSize` 不同,别写顺手了。
    pagesize: input.pageSize,
  })
}

export async function getTask(
  input: z.infer<typeof getTaskInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return wrapped(ctx, 'task', `/tasks/${requirePathId(input.taskId, 'taskId')}`)
}
