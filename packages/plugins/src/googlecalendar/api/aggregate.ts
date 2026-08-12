/**
 * `list_events_all_calendars` —— 跨多个日历聚合事件。一个 action 单独一个文件,因为它是
 * 全 provider 里唯一一个"扇出多次请求 + 部分失败要如实上报 + 自己排序"的复合操作。
 *
 * 迁移自 open-connector `src/providers/googlecalendar/runtime-events.ts` 的
 * `listEventsAllCalendars` 一段。
 *
 * ## 三条不能改的语义
 *
 * 1. **部分失败不等于整体失败**:某个日历读不到(403 / 404 / 限流)时,它进
 *    `errorsByCalendar`,其余日历的事件照常返回。只有**全都失败**才抛错。
 *    唯一的例外是 401 —— access token 无效不是"这个日历有问题",而是整次调用都白跑,
 *    继续扇出只会把同一个错误撞 N 次,故立刻上抛。
 * 2. **全天事件的排序要落到日历自己的时区**:`{ date: '2026-08-13' }` 没有时刻,拿它和
 *    带时区的 `dateTime` 混排必须先选一个时区把它变成时刻。上游选的是**该事件所属日历的
 *    时区**,取不到才退回本次调用的 `timeZone` —— 这样"东京日历的今天"不会被算到
 *    "洛杉矶日历的今天"前面去。
 * 3. **`calendarIds: []` 与不给 `calendarIds` 是两回事**:给了空数组是"一个日历都不查"
 *    (返回空结果),不给才是"查当前用户可见的全部日历"。上游用 `Object.hasOwn` 区分,
 *    这里用 `!== undefined`(Zod 不会凭空造出这个键)。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { listEventsAllCalendarsInput } from '../schema'
import {
  API_BASE,
  bool,
  compact,
  eventsUrl,
  type Json,
  type ProviderContext,
  record,
  repeated,
  requestRecord,
  requireText,
  text,
} from './shared'
import { upstreamError } from '../../_runtime/upstreamError'

/** 不给 `maxResultsPerCalendar` 时每个日历最多取多少条(上游默认值)。 */
const DEFAULT_MAX_RESULTS_PER_CALENDAR = 250

interface QueriedCalendar {
  accessRole?: string
  calendarId: string
  primary?: boolean
  summary: string
  timeZone?: string
}

interface CalendarIssue {
  code: string
  message: string
}

const timeZoneFormatters = new Map<string, Intl.DateTimeFormat>()

function timeZoneFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = timeZoneFormatters.get(timeZone)
  if (cached !== undefined) return cached
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  timeZoneFormatters.set(timeZone, formatter)
  return formatter
}

/** 时区名非法时 `Intl` 抛 RangeError;那是入参问题,要在扇出之前就拦下。 */
function assertValidTimeZone(timeZone: string): void {
  try {
    timeZoneFormatter(timeZone)
  } catch (error) {
    if (error instanceof RangeError) {
      throw new TBError('invalid_argument', 'timeZone 必须是合法的 IANA 时区名')
    }
    throw error
  }
}

function numberPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  return Number(parts.find(part => part.type === type)?.value ?? '0')
}

function timeZoneOffsetMs(timestampMs: number, timeZone: string): number {
  const parts = timeZoneFormatter(timeZone).formatToParts(new Date(timestampMs))
  return Date.UTC(
    numberPart(parts, 'year'),
    numberPart(parts, 'month') - 1,
    numberPart(parts, 'day'),
    numberPart(parts, 'hour'),
    numberPart(parts, 'minute'),
    numberPart(parts, 'second'),
  ) - timestampMs
}

/**
 * `YYYY-MM-DD` 在给定时区的当地零点对应的时间戳。
 *
 * 两遍是必要的:第一遍用"UTC 零点时的偏移"估一个时刻,但夏令时切换日的偏移在零点前后
 * 不同,故用估出来的时刻再取一次偏移。少这一遍,切换日的全天事件会排错一小时。
 */
function allDaySortTimestamp(date: string, timeZone: string): number {
  if (timeZone === 'UTC') return Date.parse(`${date}T00:00:00Z`)
  const [year, month, day] = date.split('-').map(part => Number(part))
  const utcMidnight = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, 0, 0, 0)
  const firstPass = utcMidnight - timeZoneOffsetMs(utcMidnight, timeZone)
  return utcMidnight - timeZoneOffsetMs(firstPass, timeZone)
}

/** 排序键:有 dateTime 用它;只有 date 走时区换算;两个都没有的事件排到最后。 */
function eventSortTimestamp(
  event: Json,
  actionTimeZone: string,
  calendarTimeZoneById: Record<string, string>,
): number {
  const start = record(event.start)
  if (start === undefined) return Number.POSITIVE_INFINITY
  const dateTime = text(start.dateTime)
  if (dateTime !== undefined) return Date.parse(dateTime)
  const date = text(start.date)
  if (date === undefined) return Number.POSITIVE_INFINITY
  const calendarId = text(record(event.sourceCalendar)?.calendarId)
  const timeZone = (calendarId === undefined ? undefined : calendarTimeZoneById[calendarId]) ?? actionTimeZone
  return allDaySortTimestamp(date, timeZone)
}

/** 同一时刻的事件按 calendarId、再按事件 id 排 —— 让同一组入参的输出可复现。 */
function compareEvents(
  left: Json,
  right: Json,
  actionTimeZone: string,
  calendarTimeZoneById: Record<string, string>,
): number {
  const leftSort = eventSortTimestamp(left, actionTimeZone, calendarTimeZoneById)
  const rightSort = eventSortTimestamp(right, actionTimeZone, calendarTimeZoneById)
  if (leftSort !== rightSort) return leftSort - rightSort
  const leftCalendarId = text(record(left.sourceCalendar)?.calendarId) ?? ''
  const rightCalendarId = text(record(right.sourceCalendar)?.calendarId) ?? ''
  if (leftCalendarId !== rightCalendarId) return leftCalendarId.localeCompare(rightCalendarId)
  return (text(left.id) ?? '').localeCompare(text(right.id) ?? '')
}

/** 摘要视图只收字段齐全的事件:缺 start/end/status 的条目摘要里说不清,索性不出现。 */
function buildSummaryItem(event: Json): Json | undefined {
  const start = record(event.start)
  const end = record(event.end)
  const sourceCalendar = record(event.sourceCalendar)
  const calendarId = text(sourceCalendar?.calendarId)
  const calendarSummary = text(sourceCalendar?.summary)
  const eventId = text(event.id)
  const status = text(event.status)
  if (
    start === undefined || end === undefined || calendarId === undefined
    || calendarSummary === undefined || eventId === undefined || status === undefined
  ) {
    return undefined
  }
  return compact({
    calendarId,
    calendarSummary,
    eventId,
    summary: text(event.summary) ?? '(untitled)',
    start,
    end,
    allDay: start.date !== undefined && start.dateTime === undefined,
    status,
    htmlLink: text(event.htmlLink),
  })
}

/** 单个日历读失败时写进 `errorsByCalendar` 的形状(上游 `mapCalendarError`)。 */
function mapCalendarError(error: unknown): CalendarIssue {
  if (!(error instanceof TBError)) {
    return { code: 'provider_error', message: error instanceof Error ? error.message : String(error) }
  }
  if (error.code === 'rate_limited') return { code: 'rate_limited', message: error.message }
  // 401 已在调用处上抛,走到这里的 permission_denied 只能是 403。
  if (error.code === 'permission_denied') return { code: 'forbidden', message: error.message }
  if (error.code === 'not_found') return { code: 'not_found', message: error.message }
  return { code: 'provider_error', message: error.message }
}

function isUnauthenticated(error: unknown): boolean {
  return error instanceof TBError && error.code === 'permission_denied' && error.httpStatus === 401
}

/** 翻完 calendarList 的所有页,拿到当前用户可见(未隐藏、未删除)的日历。 */
async function listVisibleCalendars(ctx: ProviderContext): Promise<QueriedCalendar[]> {
  const calendars: QueriedCalendar[] = []
  let pageToken: string | undefined

  for (;;) {
    const payload = await requestRecord(ctx, {
      url: `${API_BASE}/users/me/calendarList`,
      query: compact({ pageToken, showHidden: 'false', showDeleted: 'false' }),
    })
    for (const item of Array.isArray(payload.items) ? payload.items : []) {
      const entry = record(item)
      const calendarId = text(entry?.id)
      if (entry === undefined || calendarId === undefined) continue
      calendars.push({
        calendarId,
        summary: text(entry.summary) ?? calendarId,
        primary: typeof entry.primary === 'boolean' ? entry.primary : undefined,
        accessRole: text(entry.accessRole),
        timeZone: text(entry.timeZone),
      })
    }
    const nextPageToken = text(payload.nextPageToken)
    if (nextPageToken === undefined) return calendars
    pageToken = nextPageToken
  }
}

interface CollectInput {
  eventTypes?: string | string[]
  q?: string
  showDeleted?: boolean
  singleEvents?: boolean
  timeMax: string
  timeMin: string
  timeZone: string
}

/**
 * 取一个日历在时间窗内的事件,最多 `maxResultsPerCalendar` 条。
 *
 * 两个终止条件都要:没有 `nextPageToken`(翻完了),或某一页回了 0 条 —— 后者防的是
 * 上游一直给 token 却不给数据时的死循环。
 */
async function collectCalendarEvents(
  calendarId: string,
  input: CollectInput,
  maxResultsPerCalendar: number,
  ctx: ProviderContext,
): Promise<Json[]> {
  const events: Json[] = []
  let pageToken: string | undefined

  while (events.length < maxResultsPerCalendar) {
    const payload = await requestRecord(ctx, {
      url: eventsUrl(calendarId),
      query: compact({
        q: input.q,
        timeMin: input.timeMin,
        timeMax: input.timeMax,
        timeZone: input.timeZone,
        pageToken,
        eventTypes: input.eventTypes,
        maxResults: String(maxResultsPerCalendar),
        showDeleted: bool(input.showDeleted),
        singleEvents: bool(input.singleEvents),
      }),
    })
    const items = (Array.isArray(payload.items) ? payload.items : [])
      .map(item => record(item))
      .filter((item): item is Json => item !== undefined)
    events.push(...items.slice(0, maxResultsPerCalendar - events.length))

    const nextPageToken = text(payload.nextPageToken)
    if (nextPageToken === undefined || items.length === 0) return events
    pageToken = nextPageToken
  }

  return events
}

function describeCalendar(calendar: QueriedCalendar): Json {
  return compact({
    calendarId: calendar.calendarId,
    summary: calendar.summary,
    primary: calendar.primary,
    accessRole: calendar.accessRole,
  })
}

export async function listEventsAllCalendars(
  input: z.infer<typeof listEventsAllCalendarsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const timeMin = requireText(input.timeMin, 'timeMin')
  const timeMax = requireText(input.timeMax, 'timeMax')
  const timeZone = text(input.timeZone) ?? 'UTC'
  assertValidTimeZone(timeZone)
  const singleEvents = input.singleEvents ?? true
  const maxResultsPerCalendar = input.maxResultsPerCalendar ?? DEFAULT_MAX_RESULTS_PER_CALENDAR
  // 见文件头第 3 条:键在不在决定走哪条路,数组空不空只决定查几个。
  const calendarsQueried: QueriedCalendar[] = input.calendarIds !== undefined
    ? [...new Set(input.calendarIds)].map(calendarId => ({ calendarId, summary: calendarId }))
    : await listVisibleCalendars(ctx)

  if (calendarsQueried.length === 0) {
    return { events: [], summaryView: [], calendarsQueried: [], errorsByCalendar: {} }
  }

  const events: Json[] = []
  const errorsByCalendar: Record<string, CalendarIssue> = {}
  let succeeded = 0
  let firstRecoverableError: TBError | undefined

  for (const calendar of calendarsQueried) {
    try {
      const items = await collectCalendarEvents(calendar.calendarId, {
        q: text(input.q),
        timeMin,
        timeMax,
        timeZone,
        eventTypes: repeated(input.eventTypes),
        showDeleted: input.showDeleted,
        singleEvents,
      }, maxResultsPerCalendar, ctx)

      succeeded += 1
      // 聚合出来的事件必须自带来源,否则调用方拿到一堆事件却不知道各自属于哪个日历。
      events.push(...items.map(event => ({ ...event, sourceCalendar: describeCalendar(calendar) })))
    } catch (error) {
      if (isUnauthenticated(error)) throw error
      const mapped = mapCalendarError(error)
      errorsByCalendar[calendar.calendarId] = mapped
      firstRecoverableError ??= error instanceof TBError ? error : upstreamError(502, mapped.message)
    }
  }

  if (succeeded === 0) {
    throw firstRecoverableError ?? upstreamError(502, '所有日历的查询都失败了')
  }

  const calendarTimeZoneById = Object.fromEntries(
    calendarsQueried.flatMap(calendar => (
      calendar.timeZone === undefined ? [] : [[calendar.calendarId, calendar.timeZone]]
    )),
  )
  const sortedEvents = events.sort((left, right) => compareEvents(left, right, timeZone, calendarTimeZoneById))

  return {
    events: sortedEvents,
    summaryView: sortedEvents
      .map(event => buildSummaryItem(event))
      .filter((item): item is Json => item !== undefined),
    calendarsQueried: calendarsQueried.map(calendar => describeCalendar(calendar)),
    errorsByCalendar,
  }
}
