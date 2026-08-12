/**
 * 日历本体与"我的日历列表"(calendarList)的 12 个 action。
 *
 * 迁移自 open-connector `src/providers/googlecalendar/executors.ts` 的对应段落。
 *
 * 两族资源容易混:`calendarList` 是**当前用户订阅了哪些日历**以及个人化设置(颜色、
 * 是否隐藏、覆盖显示名),`calendars` 是日历本体(标题、时区、描述)。同一个 calendarId
 * 在两族下的可写字段完全不同,故有两张白名单。
 *
 * `update_*` 是**读改写**:Google 的 PUT 整体替换资源,只发用户给的那几个字段会把没提到
 * 的字段清空。故先 GET 当前值、按白名单取出可写部分、再用入参覆盖 —— 这是上游的语义,
 * 代价是每次 update 多一次 GET(patch_* 没有这一跳)。
 */

import type { z } from 'zod/v4'
import type {
  addCalendarToListInput,
  clearCalendarInput,
  createCalendarInput,
  deleteCalendarInput,
  getCalendarInput,
  getCalendarListEntryInput,
  listCalendarsInput,
  patchCalendarInput,
  patchCalendarListEntryInput,
  removeCalendarFromListInput,
  updateCalendarInput,
  updateCalendarListEntryInput,
} from '../schema'
import {
  API_BASE,
  bool,
  calendarListEntryUrl,
  calendarUrl,
  compact,
  deleteWithSuccess,
  int,
  type Json,
  pickKnownFields,
  type ProviderContext,
  requestNoContent,
  requestRecord,
  requireText,
  text,
} from './shared'

const CALENDAR_WRITABLE_KEYS = ['summary', 'description', 'location', 'timeZone'] as const
const CALENDAR_LIST_ENTRY_WRITABLE_KEYS = [
  'summaryOverride',
  'backgroundColor',
  'foregroundColor',
  'selected',
  'hidden',
  'defaultReminders',
  'notificationSettings',
] as const

const CALENDAR_LIST_URL = `${API_BASE}/users/me/calendarList`

export async function listCalendars(
  input: z.infer<typeof listCalendarsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const query = compact({
    maxResults: int(input.maxResults),
    pageToken: text(input.pageToken),
    syncToken: text(input.syncToken),
    showHidden: bool(input.showHidden),
    showDeleted: bool(input.showDeleted),
    minAccessRole: text(input.minAccessRole),
  })
  return requestRecord(ctx, {
    url: CALENDAR_LIST_URL,
    query,
    syncTokenAware: query.syncToken !== undefined,
  })
}

export async function getCalendarListEntry(
  input: z.infer<typeof getCalendarListEntryInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, { url: calendarListEntryUrl(requireText(input.calendarId, 'calendarId')) })
}

export async function addCalendarToList(
  input: z.infer<typeof addCalendarToListInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    url: CALENDAR_LIST_URL,
    body: { id: requireText(input.calendarId, 'calendarId') },
  })
}

export async function updateCalendarListEntry(
  input: z.infer<typeof updateCalendarListEntryInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const url = calendarListEntryUrl(requireText(input.calendarId, 'calendarId'))
  const current = await requestRecord(ctx, { url })
  return requestRecord(ctx, {
    url,
    method: 'PUT',
    body: {
      ...pickKnownFields(current, CALENDAR_LIST_ENTRY_WRITABLE_KEYS),
      ...pickKnownFields(input.entry, CALENDAR_LIST_ENTRY_WRITABLE_KEYS),
    },
  })
}

export async function patchCalendarListEntry(
  input: z.infer<typeof patchCalendarListEntryInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    url: calendarListEntryUrl(requireText(input.calendarId, 'calendarId')),
    method: 'PATCH',
    body: pickKnownFields(input.entry, CALENDAR_LIST_ENTRY_WRITABLE_KEYS),
  })
}

export async function removeCalendarFromList(
  input: z.infer<typeof removeCalendarFromListInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return deleteWithSuccess(ctx, calendarListEntryUrl(requireText(input.calendarId, 'calendarId')))
}

export async function getCalendar(
  input: z.infer<typeof getCalendarInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, { url: calendarUrl(requireText(input.calendarId, 'calendarId')) })
}

export async function createCalendar(
  input: z.infer<typeof createCalendarInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 这一个 action 的可写字段直接铺在入参顶层(其余 calendar 写操作包在 `calendar` 里)。
  return requestRecord(ctx, {
    url: `${API_BASE}/calendars`,
    body: pickKnownFields(input, CALENDAR_WRITABLE_KEYS),
  })
}

export async function updateCalendar(
  input: z.infer<typeof updateCalendarInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const url = calendarUrl(requireText(input.calendarId, 'calendarId'))
  const current = await requestRecord(ctx, { url })
  return requestRecord(ctx, {
    url,
    method: 'PUT',
    body: {
      ...pickKnownFields(current, CALENDAR_WRITABLE_KEYS),
      ...pickKnownFields(input.calendar, CALENDAR_WRITABLE_KEYS),
    },
  })
}

export async function patchCalendar(
  input: z.infer<typeof patchCalendarInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    url: calendarUrl(requireText(input.calendarId, 'calendarId')),
    method: 'PATCH',
    body: pickKnownFields(input.calendar, CALENDAR_WRITABLE_KEYS),
  })
}

export async function deleteCalendar(
  input: z.infer<typeof deleteCalendarInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return deleteWithSuccess(ctx, calendarUrl(requireText(input.calendarId, 'calendarId')))
}

export async function clearCalendar(
  input: z.infer<typeof clearCalendarInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // clear 只对 primary 日历有效(Google 侧的限制),响应是 204 空体。
  await requestNoContent(ctx, {
    url: `${calendarUrl(requireText(input.calendarId, 'calendarId'))}/clear`,
    method: 'POST',
  })
  return { success: true }
}
