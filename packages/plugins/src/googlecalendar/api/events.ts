/**
 * 事件(events)的 13 个 action。`list_events_all_calendars` 单独放在 `aggregate.ts`。
 *
 * 迁移自 open-connector `src/providers/googlecalendar/runtime-events.ts`。
 *
 * ## 时间字段的两种形态(最容易迁丢的地方)
 *
 * 事件的 `start` / `end` 是 `{ date }`(全天事件,`YYYY-MM-DD`)**或** `{ dateTime, timeZone }`
 * (带时区的时刻)。两种形态都要原样透传给 Google:把全天事件的 `date` 塞进 `dateTime`
 * 会变成"当天 00:00 的一小时事件",反过来则丢掉时刻。故这里对 `start`/`end` 不做任何
 * 规范化,只按白名单整体传递。
 *
 * ## 三处上游细节
 *
 * 1. **写事件时的两个开关参数由 body 反推**:带 `conferenceData` 就必须发
 *    `conferenceDataVersion=1`、带 `attachments` 就必须发 `supportsAttachments=true`,
 *    否则 Google **静默丢掉**那两个字段(不报错)。
 * 2. **update_event 的读改写要二次收窄**:读回来的 `conferenceData` / `source` 带着只读
 *    子字段(`signature`、`conferenceSolution.iconUri` 之类),原样 PUT 回去会 400。
 *    故这两个字段在"沿用当前值"时再按自己的白名单挑一遍(用户显式给了就用用户的)。
 * 3. **delete_event 把 404 当成功**:删除是幂等的,"已经不在了"与"这次删掉了"对调用方
 *    是同一个结果。这是上游的语义,保留。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createEventInput,
  deleteEventInput,
  findEventInput,
  getEventInput,
  importEventInput,
  listEventInstancesInput,
  listEventsInput,
  moveEventInput,
  patchEventInput,
  quickAddEventInput,
  removeAttendeeInput,
  syncEventsInput,
  updateEventInput,
} from '../schema'
import {
  bool,
  compact,
  eventsUrl,
  eventUrl,
  int,
  type Json,
  pickKnownFields,
  type ProviderContext,
  type Query,
  repeated,
  requestNoContent,
  requestRecord,
  requireRecord,
  requireText,
  text,
} from './shared'

const EVENT_WRITABLE_KEYS = [
  'summary',
  'description',
  'location',
  'start',
  'end',
  'attendees',
  'recurrence',
  'conferenceData',
  'reminders',
  'colorId',
  'visibility',
  'transparency',
  'status',
  'extendedProperties',
  'attachments',
  'source',
  'iCalUID',
] as const
const CONFERENCE_DATA_KEYS = ['conferenceId', 'notes', 'entryPoints', 'conferenceSolution', 'createRequest'] as const
const SOURCE_KEYS = ['url', 'title'] as const
const ATTENDEE_KEYS = [
  'email',
  'displayName',
  'optional',
  'resource',
  'responseStatus',
  'comment',
  'additionalGuests',
] as const

/** `list_events` / `sync_events` / `find_event` 三者共用的查询参数集合。 */
interface ListEventsQuery {
  eventTypes?: string | string[]
  iCalUID?: string
  maxAttendees?: number
  maxResults?: number
  orderBy?: string
  pageToken?: string
  privateExtendedProperty?: string | string[]
  q?: string
  sharedExtendedProperty?: string | string[]
  showDeleted?: boolean
  showHiddenInvitations?: boolean
  singleEvents?: boolean
  syncToken?: string
  timeMax?: string
  timeMin?: string
  timeZone?: string
  updatedMin?: string
}

function buildListEventsQuery(input: ListEventsQuery, options?: { syncMode?: boolean }): Query {
  const syncToken = text(input.syncToken)

  if (options?.syncMode === true && syncToken !== undefined) {
    // 增量同步模式下 Google 不接受任何过滤参数(时间窗、q、orderBy 都会 400),
    // 且必须带 showDeleted=true —— 被删除的事件正是增量同步要告诉调用方的东西。
    return compact({
      timeZone: text(input.timeZone),
      pageToken: text(input.pageToken),
      syncToken,
      eventTypes: repeated(input.eventTypes),
      maxResults: int(input.maxResults),
      showDeleted: 'true',
      maxAttendees: int(input.maxAttendees),
      singleEvents: bool(input.singleEvents),
      showHiddenInvitations: bool(input.showHiddenInvitations),
    })
  }

  return compact({
    q: text(input.q),
    iCalUID: text(input.iCalUID),
    orderBy: text(input.orderBy),
    timeMin: text(input.timeMin),
    timeMax: text(input.timeMax),
    timeZone: text(input.timeZone),
    pageToken: text(input.pageToken),
    syncToken,
    eventTypes: repeated(input.eventTypes),
    maxResults: int(input.maxResults),
    updatedMin: text(input.updatedMin),
    showDeleted: bool(input.showDeleted),
    maxAttendees: int(input.maxAttendees),
    singleEvents: bool(input.singleEvents),
    showHiddenInvitations: bool(input.showHiddenInvitations),
    sharedExtendedProperty: repeated(input.sharedExtendedProperty),
    privateExtendedProperty: repeated(input.privateExtendedProperty),
  })
}

/** 见文件头第 1 条:两个开关参数由 body 里有没有对应字段反推,不来自入参。 */
function buildEventWriteQuery(event: Json): Query {
  return compact({
    conferenceDataVersion: event.conferenceData === undefined ? undefined : '1',
    supportsAttachments: event.attachments === undefined ? undefined : 'true',
  })
}

async function listEventsIn(
  calendarId: string,
  query: ListEventsQuery,
  ctx: ProviderContext,
  options?: { syncMode?: boolean },
): Promise<Json> {
  const built = buildListEventsQuery(query, options)
  return requestRecord(ctx, {
    url: eventsUrl(calendarId),
    query: built,
    syncTokenAware: built.syncToken !== undefined,
  })
}

export async function listEvents(input: z.infer<typeof listEventsInput>, ctx: ProviderContext): Promise<Json> {
  return listEventsIn(requireText(input.calendarId, 'calendarId'), input, ctx)
}

export async function syncEvents(input: z.infer<typeof syncEventsInput>, ctx: ProviderContext): Promise<Json> {
  return listEventsIn(requireText(input.calendarId, 'calendarId'), input, ctx, { syncMode: true })
}

/**
 * `find_event` 是 `list_events` 的窄化入口:`query` 映射到 `q`,calendarId 缺省 primary,
 * 且**只**透出上游选中的那几个过滤参数(没有 syncToken / timeZone / iCalUID)。
 */
export async function findEvent(input: z.infer<typeof findEventInput>, ctx: ProviderContext): Promise<Json> {
  return listEventsIn(text(input.calendarId) ?? 'primary', {
    q: input.query,
    timeMin: input.timeMin,
    timeMax: input.timeMax,
    updatedMin: input.updatedMin,
    eventTypes: input.eventTypes,
    orderBy: input.orderBy,
    singleEvents: input.singleEvents,
    showDeleted: input.showDeleted,
    maxResults: input.maxResults,
    pageToken: input.pageToken,
  }, ctx)
}

export async function getEvent(input: z.infer<typeof getEventInput>, ctx: ProviderContext): Promise<Json> {
  return requestRecord(ctx, {
    url: eventUrl(requireText(input.calendarId, 'calendarId'), requireText(input.eventId, 'eventId')),
  })
}

export async function createEvent(input: z.infer<typeof createEventInput>, ctx: ProviderContext): Promise<Json> {
  const event = pickKnownFields(input.event, EVENT_WRITABLE_KEYS)
  return requestRecord(ctx, {
    url: eventsUrl(requireText(input.calendarId, 'calendarId')),
    query: buildEventWriteQuery(event),
    body: event,
  })
}

export async function updateEvent(input: z.infer<typeof updateEventInput>, ctx: ProviderContext): Promise<Json> {
  const url = eventUrl(requireText(input.calendarId, 'calendarId'), requireText(input.eventId, 'eventId'))
  const current = pickKnownFields(await requestRecord(ctx, { url }), EVENT_WRITABLE_KEYS)
  const next = pickKnownFields(input.event, EVENT_WRITABLE_KEYS)

  // 见文件头第 2 条:沿用当前值时这两个字段要再收一遍,否则只读子字段会让 PUT 400。
  if (next.conferenceData === undefined && current.conferenceData !== undefined) {
    current.conferenceData = pickKnownFields(
      requireRecord(current.conferenceData, '事件的 conferenceData'),
      CONFERENCE_DATA_KEYS,
    )
  }
  if (next.source === undefined && current.source !== undefined) {
    current.source = pickKnownFields(requireRecord(current.source, '事件的 source'), SOURCE_KEYS)
  }

  const body = { ...current, ...next }
  return requestRecord(ctx, { url, method: 'PUT', query: buildEventWriteQuery(body), body })
}

export async function patchEvent(input: z.infer<typeof patchEventInput>, ctx: ProviderContext): Promise<Json> {
  const event = pickKnownFields(input.event, EVENT_WRITABLE_KEYS)
  return requestRecord(ctx, {
    url: eventUrl(requireText(input.calendarId, 'calendarId'), requireText(input.eventId, 'eventId')),
    method: 'PATCH',
    query: buildEventWriteQuery(event),
    body: event,
  })
}

export async function deleteEvent(input: z.infer<typeof deleteEventInput>, ctx: ProviderContext): Promise<Json> {
  try {
    await requestNoContent(ctx, {
      url: eventUrl(requireText(input.calendarId, 'calendarId'), requireText(input.eventId, 'eventId')),
      method: 'DELETE',
    })
  } catch (error) {
    // 见文件头第 3 条:删除幂等,"已经不在了"也算删成功。
    if (error instanceof TBError && error.code === 'not_found') return { success: true }
    throw error
  }
  return { success: true }
}

export async function importEvent(input: z.infer<typeof importEventInput>, ctx: ProviderContext): Promise<Json> {
  // import 端点要求 body 带 iCalUID(schema 已把它标成必填),白名单里也有它。
  return requestRecord(ctx, {
    url: `${eventsUrl(requireText(input.calendarId, 'calendarId'))}/import`,
    body: pickKnownFields(input.event, EVENT_WRITABLE_KEYS),
  })
}

export async function moveEvent(input: z.infer<typeof moveEventInput>, ctx: ProviderContext): Promise<Json> {
  return requestRecord(ctx, {
    url: `${eventUrl(requireText(input.calendarId, 'calendarId'), requireText(input.eventId, 'eventId'))}/move`,
    method: 'POST',
    query: { destination: requireText(input.destinationCalendarId, 'destinationCalendarId') },
  })
}

export async function listEventInstances(
  input: z.infer<typeof listEventInstancesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return requestRecord(ctx, {
    url: `${eventUrl(requireText(input.calendarId, 'calendarId'), requireText(input.eventId, 'eventId'))}/instances`,
    query: compact({
      timeMin: text(input.timeMin),
      timeMax: text(input.timeMax),
      timeZone: text(input.timeZone),
      pageToken: text(input.pageToken),
      maxResults: int(input.maxResults),
      showDeleted: bool(input.showDeleted),
      maxAttendees: int(input.maxAttendees),
    }),
  })
}

export async function quickAddEvent(
  input: z.infer<typeof quickAddEventInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // quickAdd 的自然语言文本走 query 参数,不是 body(Google 侧的设计)。
  return requestRecord(ctx, {
    url: `${eventsUrl(requireText(input.calendarId, 'calendarId'))}/quickAdd`,
    method: 'POST',
    query: { text: requireText(input.text, 'text') },
  })
}

/**
 * 移除一个参会人:Google 没有"删单个 attendee"的端点,只能读出整份 attendees、去掉一个、
 * 再整体 PATCH 回去。
 *
 * 两处要留神:①邮箱比对**不区分大小写**;②回写前要把每个 attendee 收窄到可写字段 ——
 * 读回来的 attendee 带着 `id` / `self` / `organizer` 这些只读字段,原样发回去会 400。
 */
export async function removeAttendee(
  input: z.infer<typeof removeAttendeeInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const calendarId = text(input.calendarId) ?? 'primary'
  const eventId = requireText(input.eventId, 'eventId')
  const attendeeEmail = requireText(input.attendeeEmail, 'attendeeEmail')
  const event = await requestRecord(ctx, { url: eventUrl(calendarId, eventId) })
  const attendees = (Array.isArray(event.attendees) ? event.attendees : [])
    .map(attendee => requireRecord(attendee, '事件的 attendees 项'))
    .map(attendee => pickKnownFields(attendee, ATTENDEE_KEYS))
  const target = attendeeEmail.toLowerCase()
  const remaining = attendees.filter(attendee => text(attendee.email)?.toLowerCase() !== target)

  if (remaining.length === attendees.length) {
    throw new TBError('invalid_argument', `参会人不在这个事件里:${attendeeEmail}`)
  }

  const body = { attendees: remaining }
  return requestRecord(ctx, {
    url: eventUrl(calendarId, eventId),
    method: 'PATCH',
    query: buildEventWriteQuery(body),
    body,
  })
}
