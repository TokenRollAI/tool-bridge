/**
 * freeBusy 的两个 action:`free_busy_query`(原样透出 Google 的忙闲结果)与
 * `find_free_slots`(在忙闲结果之上算出空档)。
 *
 * 迁移自 open-connector `src/providers/googlecalendar/executors.ts` 的 freeBusy 一段。
 *
 * ## `find_free_slots` 的核心是"这个结果可不可信"
 *
 * Google 的 freeBusy 会**部分失败**:某个日历没权限、某个 group 展开超限,响应里那一族就
 * 带 `errors`,或干脆缺席。此时"忙的区间"是不完整的,于是"空档"就是错的 —— 拿一个漏了
 * 会议的空档去约会比直接报错更糟。故每个日历都带 `isReliable`,**不可信时 `free` 一律
 * 给空数组**,把判断权交回调用方。
 *
 * 三种不可信来源,一个都不能漏:
 * 1. 该日历自己回了 `errors`(没权限、不存在)。
 * 2. 该日历在响应里**整个缺席**,但调用方明确点名要它。
 * 3. 该日历是**从 group 展开**出来的,而那个 group 报了错或撞上了 `groupExpansionMax`
 *    —— 展开被截断时,漏掉的日历不会出现在响应里,能看出来的只有"这一组的数量刚好顶格"。
 *
 * ## 忙区间要先归一再算空档
 *
 * Google 回的 busy 区间可能超出查询窗、可能互相重叠、可能倒挂。不先裁剪到窗内、排序、
 * 合并重叠,算出来的"空档"会出现负长度或跨过一场会议的区间。
 */

import type { z } from 'zod/v4'
import type { findFreeSlotsInput, freeBusyQueryInput } from '../schema'
import {
  API_BASE,
  compact,
  type Json,
  type ProviderContext,
  record,
  requestRecord,
  requireText,
  text,
} from './shared'

const DEFAULT_TIME_ZONE = 'UTC'
const DEFAULT_GROUP_EXPANSION_MAX = 100
const DEFAULT_CALENDAR_EXPANSION_MAX = 50

interface FreeBusyRequestBody {
  calendarExpansionMax: number
  groupExpansionMax: number
  items: Array<{ id: string }>
  timeMax: string
  timeMin: string
  timeZone: string
}

interface Window {
  end: string
  endMs: number
  start: string
  startMs: number
}

interface CalendarIssue {
  code: string
  message: string
}

/**
 * `items` 既收 `['a@x','b@x']` 也收 `[{id:'a@x'}]`,统一成后者。
 *
 * 与上游的**一处偏离**:上游对字符串形态只判 `length > 0`,纯空白串会被原样发出去;
 * 这里两种形态都去空白后判空,与其他 id 字段的处理一致。
 */
function normalizeItems(items: Array<{ id: string }> | string[]): Array<{ id: string }> {
  return items.map((item, index) => (
    typeof item === 'string'
      ? { id: requireText(item, `items[${index}]`) }
      : { id: requireText(item.id, `items[${index}].id`) }
  ))
}

function buildRequestBody(input: z.infer<typeof freeBusyQueryInput>): FreeBusyRequestBody {
  return {
    items: normalizeItems(input.items),
    timeMin: requireText(input.timeMin, 'timeMin'),
    timeMax: requireText(input.timeMax, 'timeMax'),
    timeZone: text(input.timeZone) ?? DEFAULT_TIME_ZONE,
    groupExpansionMax: input.groupExpansionMax ?? DEFAULT_GROUP_EXPANSION_MAX,
    calendarExpansionMax: input.calendarExpansionMax ?? DEFAULT_CALENDAR_EXPANSION_MAX,
  }
}

async function queryFreeBusy(body: FreeBusyRequestBody, ctx: ProviderContext): Promise<Json> {
  return requestRecord(ctx, { url: `${API_BASE}/freeBusy`, body })
}

/** 上游 `asRecord`:不是对象就当空对象,不报错 —— 少一族结果比整个调用失败好。 */
function asRecord(value: unknown): Json {
  return record(value) ?? {}
}

/**
 * 裁剪到窗内、丢掉倒挂/零长度的区间、按起点排序、合并重叠。
 *
 * 被裁剪过的端点用**窗边界的原字符串**呈现(而不是回显上游那个越界的时刻),这样出参里的
 * 时间字符串都落在调用方给的窗内。
 */
function normalizeBusyWindows(value: unknown, windowStart: string, windowEnd: string): Window[] {
  if (!Array.isArray(value)) return []
  const rangeStart = Date.parse(windowStart)
  const rangeEnd = Date.parse(windowEnd)

  const windows = value
    .map((item) => {
      const entry = record(item)
      const start = text(entry?.start)
      const end = text(entry?.end)
      if (start === undefined || end === undefined) return undefined
      const startMs = Math.max(Date.parse(start), rangeStart)
      const endMs = Math.min(Date.parse(end), rangeEnd)
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) return undefined
      return {
        start: startMs === Date.parse(start) ? start : windowStart,
        end: endMs === Date.parse(end) ? end : windowEnd,
        startMs,
        endMs,
      }
    })
    .filter((item): item is Window => item !== undefined)
    .sort((left, right) => left.startMs - right.startMs)

  if (windows.length === 0) return windows

  const merged: Window[] = [windows[0]!]
  for (const window of windows.slice(1)) {
    const current = merged[merged.length - 1]!
    if (window.startMs <= current.endMs) {
      // 只有真的把区间拉长了才换 `end` 的字符串(被完全包含的区间不改端点)。
      const extendsCurrent = window.endMs >= current.endMs
      current.endMs = Math.max(current.endMs, window.endMs)
      if (extendsCurrent) current.end = window.end
      continue
    }
    merged.push(window)
  }
  return merged
}

function findFreeWindows(busy: Window[], timeMin: string, timeMax: string): Array<{ end: string, start: string }> {
  const rangeEnd = Date.parse(timeMax)
  let cursorMs = Date.parse(timeMin)
  let cursor = timeMin
  const free: Array<{ end: string, start: string }> = []

  for (const window of busy) {
    if (cursorMs < window.startMs) free.push({ start: cursor, end: window.start })
    if (window.endMs > cursorMs) {
      cursorMs = window.endMs
      cursor = window.end
    }
  }
  if (cursorMs < rangeEnd) free.push({ start: cursor, end: timeMax })

  return free.filter(({ start, end }) => Date.parse(end) > Date.parse(start))
}

/** 日历自己回的 errors → issue。没有 `reason` 的条目说不清问题,丢掉。 */
function normalizeCalendarErrors(value: unknown): CalendarIssue[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const reason = text(record(item)?.reason)
      return reason === undefined ? undefined : { code: reason, message: `calendar returned error: ${reason}` }
    })
    .filter((item): item is CalendarIssue => item !== undefined)
}

function normalizeGroupErrors(value: unknown): CalendarIssue[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const reason = text(record(item)?.reason)
      return reason === undefined
        ? undefined
        : { code: 'provider_error', message: `calendar reliability is degraded by group error: ${reason}` }
    })
    .filter((item): item is CalendarIssue => item !== undefined)
}

/**
 * 把 group 层面的问题摊到它展开出来的每个日历上(见文件头第 3 条)。
 *
 * 调用方**直接点名**的日历不受影响:它的忙闲是直接查来的,group 展开截断与它无关。
 */
function collectDerivedGroupIssues(
  groups: Json,
  groupExpansionMax: number,
  items: Array<{ id: string }>,
): Record<string, CalendarIssue[]> {
  const explicitInputIds = new Set(items.map(({ id }) => id))
  const issues: Record<string, CalendarIssue[]> = {}

  for (const value of Object.values(groups)) {
    const group = record(value)
    if (group === undefined) continue
    const groupCalendars = Array.isArray(group.calendars)
      ? group.calendars.filter((calendarId): calendarId is string => typeof calendarId === 'string')
      : []
    const groupErrors = normalizeGroupErrors(group.errors)
    // 数量顶格 = 很可能被截断了(Google 不会告诉你截没截)。
    const isExpansionLimited = groupCalendars.length >= groupExpansionMax
    if (groupErrors.length === 0 && !isExpansionLimited) continue

    for (const calendarId of groupCalendars) {
      if (explicitInputIds.has(calendarId)) continue
      const calendarIssues = issues[calendarId] ?? []
      calendarIssues.push(...groupErrors)
      if (isExpansionLimited) {
        calendarIssues.push({
          code: 'provider_error',
          message: 'calendar reliability is degraded by group expansion limits',
        })
      }
      issues[calendarId] = calendarIssues
    }
  }

  return issues
}

export async function freeBusyQuery(
  input: z.infer<typeof freeBusyQueryInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return queryFreeBusy(buildRequestBody(input), ctx)
}

export async function findFreeSlots(
  input: z.infer<typeof findFreeSlotsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const requestBody = buildRequestBody(input)
  const response = await queryFreeBusy(requestBody, ctx)
  const calendars = asRecord(response.calendars)
  const groups = asRecord(response.groups)
  const groupIssues = collectDerivedGroupIssues(groups, requestBody.groupExpansionMax, requestBody.items)
  // 入参里的 id 既可能是日历也可能是 group;凡是在响应的 groups 里出现过的就是 group。
  const explicitGroupIds = new Set(Object.keys(groups))
  const explicitCalendarIds = new Set(
    requestBody.items.map(({ id }) => id).filter(id => !explicitGroupIds.has(id)),
  )
  const calendarIds = new Set<string>([
    ...Object.keys(calendars),
    ...explicitCalendarIds,
    ...Object.keys(groupIssues),
  ])

  return {
    kind: text(response.kind) ?? 'calendar#freeBusy',
    timeMin: text(response.timeMin) ?? requestBody.timeMin,
    timeMax: text(response.timeMax) ?? requestBody.timeMax,
    calendars: Object.fromEntries([...calendarIds].map((calendarId) => {
      const calendarValue = calendars[calendarId]
      const calendar = asRecord(calendarValue)
      const busy = normalizeBusyWindows(calendar.busy, requestBody.timeMin, requestBody.timeMax)
      const errors = [
        ...normalizeCalendarErrors(calendar.errors),
        ...(calendarValue === undefined && explicitCalendarIds.has(calendarId)
          ? [{ code: 'provider_error', message: 'calendar missing from freeBusy response' }]
          : []),
        ...(explicitCalendarIds.has(calendarId) ? [] : (groupIssues[calendarId] ?? [])),
      ]
      const isReliable = errors.length === 0

      return [calendarId, compact({
        busy: busy.map(({ start, end }) => ({ start, end })),
        // 不可信时不给空档:一个漏了会议的"空档"比没有空档更危险。
        free: isReliable ? findFreeWindows(busy, requestBody.timeMin, requestBody.timeMax) : [],
        isReliable,
        errors: errors.length > 0 ? errors : undefined,
      })]
    })),
  }
}
