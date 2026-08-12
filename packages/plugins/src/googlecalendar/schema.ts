/**
 * Google Calendar 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listCalendarsInput = z.strictObject({
  maxResults: z.int().min(1).max(250).describe('Maximum calendar list entries to return.').optional(),
  pageToken: z.string().describe('Page token.').optional(),
  syncToken: z.string().describe('Incremental sync token.').optional(),
  showHidden: z.boolean().describe('Include hidden calendars.').optional(),
  showDeleted: z.boolean().describe('Include deleted calendars.').optional(),
  minAccessRole: z.string().describe('Minimum access role.').optional(),
}).describe('The input payload for this action.')

export const listCalendarsOutput = z.looseObject({
  items: z.array(z.looseObject({
    id: z.string().min(1).describe('Calendar ID.'),
    summary: z.string().min(1).describe('Calendar summary.'),
    accessRole: z.string().min(1).describe('Access role granted on the calendar.'),
    primary: z.boolean().describe('Whether this is the primary calendar.').optional(),
    hidden: z.boolean().describe('Whether the calendar is hidden.').optional(),
    selected: z.boolean().describe('Whether the calendar is selected.').optional(),
    timeZone: z.string().describe('Calendar time zone.').optional(),
    backgroundColor: z.string().describe('Calendar background color.').optional(),
    foregroundColor: z.string().describe('Calendar foreground color.').optional(),
    summaryOverride: z.string().describe('Calendar list display override.').optional(),
    defaultReminders: z.array(z.strictObject({
      method: z.string().min(1).describe('Reminder delivery method, such as email or popup.'),
      minutes: z.int().describe('Minutes before the event.'),
    }).describe('Reminder override.')).describe('Default reminders.').optional(),
  }).describe('Calendar list entry.')).describe('Items returned by Google Calendar.'),
  nextPageToken: z.string().describe('Next page token.').optional(),
  nextSyncToken: z.string().describe('Incremental sync token.').optional(),
}).describe('Google Calendar page.')

export const getCalendarListEntryInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
}).describe('The input payload for this action.')

export const getCalendarListEntryOutput = z.looseObject({
  id: z.string().min(1).describe('Calendar ID.'),
  summary: z.string().min(1).describe('Calendar summary.'),
  accessRole: z.string().min(1).describe('Access role granted on the calendar.'),
  primary: z.boolean().describe('Whether this is the primary calendar.').optional(),
  hidden: z.boolean().describe('Whether the calendar is hidden.').optional(),
  selected: z.boolean().describe('Whether the calendar is selected.').optional(),
  timeZone: z.string().describe('Calendar time zone.').optional(),
  backgroundColor: z.string().describe('Calendar background color.').optional(),
  foregroundColor: z.string().describe('Calendar foreground color.').optional(),
  summaryOverride: z.string().describe('Calendar list display override.').optional(),
  defaultReminders: z.array(z.strictObject({
    method: z.string().min(1).describe('Reminder delivery method, such as email or popup.'),
    minutes: z.int().describe('Minutes before the event.'),
  }).describe('Reminder override.')).describe('Default reminders.').optional(),
}).describe('Calendar list entry.')

export const addCalendarToListInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
}).describe('The input payload for this action.')

export const addCalendarToListOutput = z.looseObject({
  id: z.string().min(1).describe('Calendar ID.'),
  summary: z.string().min(1).describe('Calendar summary.'),
  accessRole: z.string().min(1).describe('Access role granted on the calendar.'),
  primary: z.boolean().describe('Whether this is the primary calendar.').optional(),
  hidden: z.boolean().describe('Whether the calendar is hidden.').optional(),
  selected: z.boolean().describe('Whether the calendar is selected.').optional(),
  timeZone: z.string().describe('Calendar time zone.').optional(),
  backgroundColor: z.string().describe('Calendar background color.').optional(),
  foregroundColor: z.string().describe('Calendar foreground color.').optional(),
  summaryOverride: z.string().describe('Calendar list display override.').optional(),
  defaultReminders: z.array(z.strictObject({
    method: z.string().min(1).describe('Reminder delivery method, such as email or popup.'),
    minutes: z.int().describe('Minutes before the event.'),
  }).describe('Reminder override.')).describe('Default reminders.').optional(),
}).describe('Calendar list entry.')

export const updateCalendarListEntryInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
  entry: z.strictObject({
    summaryOverride: z.string().describe('Calendar list display override.').optional(),
    backgroundColor: z.string().describe('Calendar background color.').optional(),
    foregroundColor: z.string().describe('Calendar foreground color.').optional(),
    selected: z.boolean().describe('Whether the calendar is selected.').optional(),
    hidden: z.boolean().describe('Whether the calendar is hidden.').optional(),
    defaultReminders: z.array(z.strictObject({
      method: z.string().min(1).describe('Reminder delivery method, such as email or popup.'),
      minutes: z.int().describe('Minutes before the event.'),
    }).describe('Reminder override.')).describe('Default reminders.').optional(),
    notificationSettings: z.looseObject({}).describe('Google Calendar API object.').optional(),
  }).describe('Writable calendar list entry fields.'),
}).describe('The input payload for this action.')

export const updateCalendarListEntryOutput = z.looseObject({
  id: z.string().min(1).describe('Calendar ID.'),
  summary: z.string().min(1).describe('Calendar summary.'),
  accessRole: z.string().min(1).describe('Access role granted on the calendar.'),
  primary: z.boolean().describe('Whether this is the primary calendar.').optional(),
  hidden: z.boolean().describe('Whether the calendar is hidden.').optional(),
  selected: z.boolean().describe('Whether the calendar is selected.').optional(),
  timeZone: z.string().describe('Calendar time zone.').optional(),
  backgroundColor: z.string().describe('Calendar background color.').optional(),
  foregroundColor: z.string().describe('Calendar foreground color.').optional(),
  summaryOverride: z.string().describe('Calendar list display override.').optional(),
  defaultReminders: z.array(z.strictObject({
    method: z.string().min(1).describe('Reminder delivery method, such as email or popup.'),
    minutes: z.int().describe('Minutes before the event.'),
  }).describe('Reminder override.')).describe('Default reminders.').optional(),
}).describe('Calendar list entry.')

export const patchCalendarListEntryInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
  entry: z.strictObject({
    summaryOverride: z.string().describe('Calendar list display override.').optional(),
    backgroundColor: z.string().describe('Calendar background color.').optional(),
    foregroundColor: z.string().describe('Calendar foreground color.').optional(),
    selected: z.boolean().describe('Whether the calendar is selected.').optional(),
    hidden: z.boolean().describe('Whether the calendar is hidden.').optional(),
    defaultReminders: z.array(z.strictObject({
      method: z.string().min(1).describe('Reminder delivery method, such as email or popup.'),
      minutes: z.int().describe('Minutes before the event.'),
    }).describe('Reminder override.')).describe('Default reminders.').optional(),
    notificationSettings: z.looseObject({}).describe('Google Calendar API object.').optional(),
  }).describe('Writable calendar list entry fields.'),
}).describe('The input payload for this action.')

export const patchCalendarListEntryOutput = z.looseObject({
  id: z.string().min(1).describe('Calendar ID.'),
  summary: z.string().min(1).describe('Calendar summary.'),
  accessRole: z.string().min(1).describe('Access role granted on the calendar.'),
  primary: z.boolean().describe('Whether this is the primary calendar.').optional(),
  hidden: z.boolean().describe('Whether the calendar is hidden.').optional(),
  selected: z.boolean().describe('Whether the calendar is selected.').optional(),
  timeZone: z.string().describe('Calendar time zone.').optional(),
  backgroundColor: z.string().describe('Calendar background color.').optional(),
  foregroundColor: z.string().describe('Calendar foreground color.').optional(),
  summaryOverride: z.string().describe('Calendar list display override.').optional(),
  defaultReminders: z.array(z.strictObject({
    method: z.string().min(1).describe('Reminder delivery method, such as email or popup.'),
    minutes: z.int().describe('Minutes before the event.'),
  }).describe('Reminder override.')).describe('Default reminders.').optional(),
}).describe('Calendar list entry.')

export const removeCalendarFromListInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
}).describe('The input payload for this action.')

export const removeCalendarFromListOutput = z.strictObject({
  success: z.literal(true).describe('Whether the operation completed successfully.'),
}).describe('Operation result.')

export const getCalendarInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
}).describe('The input payload for this action.')

export const getCalendarOutput = z.looseObject({
  id: z.string().min(1).describe('Calendar ID.'),
  summary: z.string().min(1).describe('Calendar summary.'),
  kind: z.string().describe('Google resource kind.').optional(),
  etag: z.string().describe('Entity tag.').optional(),
  description: z.string().describe('Calendar description.').optional(),
  location: z.string().describe('Calendar location.').optional(),
  timeZone: z.string().describe('Calendar time zone.').optional(),
  conferenceProperties: z.looseObject({}).describe('Google Calendar API object.').optional(),
}).describe('Google Calendar resource.')

export const createCalendarInput = z.strictObject({
  summary: z.string().min(1).describe('Calendar summary.'),
  description: z.string().describe('Calendar description.').optional(),
  location: z.string().describe('Calendar location.').optional(),
  timeZone: z.string().describe('Calendar time zone.').optional(),
}).describe('Writable calendar fields.')

export const createCalendarOutput = z.looseObject({
  id: z.string().min(1).describe('Calendar ID.'),
  summary: z.string().min(1).describe('Calendar summary.'),
  kind: z.string().describe('Google resource kind.').optional(),
  etag: z.string().describe('Entity tag.').optional(),
  description: z.string().describe('Calendar description.').optional(),
  location: z.string().describe('Calendar location.').optional(),
  timeZone: z.string().describe('Calendar time zone.').optional(),
  conferenceProperties: z.looseObject({}).describe('Google Calendar API object.').optional(),
}).describe('Google Calendar resource.')

export const updateCalendarInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
  calendar: z.strictObject({
    summary: z.string().min(1).describe('Calendar summary.'),
    description: z.string().describe('Calendar description.').optional(),
    location: z.string().describe('Calendar location.').optional(),
    timeZone: z.string().describe('Calendar time zone.').optional(),
  }).describe('Writable calendar fields.'),
}).describe('The input payload for this action.')

export const updateCalendarOutput = z.looseObject({
  id: z.string().min(1).describe('Calendar ID.'),
  summary: z.string().min(1).describe('Calendar summary.'),
  kind: z.string().describe('Google resource kind.').optional(),
  etag: z.string().describe('Entity tag.').optional(),
  description: z.string().describe('Calendar description.').optional(),
  location: z.string().describe('Calendar location.').optional(),
  timeZone: z.string().describe('Calendar time zone.').optional(),
  conferenceProperties: z.looseObject({}).describe('Google Calendar API object.').optional(),
}).describe('Google Calendar resource.')

export const patchCalendarInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
  calendar: z.strictObject({
    summary: z.string().min(1).describe('Calendar summary.'),
    description: z.string().describe('Calendar description.').optional(),
    location: z.string().describe('Calendar location.').optional(),
    timeZone: z.string().describe('Calendar time zone.').optional(),
  }).describe('Writable calendar fields.'),
}).describe('The input payload for this action.')

export const patchCalendarOutput = z.looseObject({
  id: z.string().min(1).describe('Calendar ID.'),
  summary: z.string().min(1).describe('Calendar summary.'),
  kind: z.string().describe('Google resource kind.').optional(),
  etag: z.string().describe('Entity tag.').optional(),
  description: z.string().describe('Calendar description.').optional(),
  location: z.string().describe('Calendar location.').optional(),
  timeZone: z.string().describe('Calendar time zone.').optional(),
  conferenceProperties: z.looseObject({}).describe('Google Calendar API object.').optional(),
}).describe('Google Calendar resource.')

export const deleteCalendarInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
}).describe('The input payload for this action.')

export const deleteCalendarOutput = z.strictObject({
  success: z.literal(true).describe('Whether the operation completed successfully.'),
}).describe('Operation result.')

export const clearCalendarInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
}).describe('The input payload for this action.')

export const clearCalendarOutput = z.strictObject({
  success: z.literal(true).describe('Whether the operation completed successfully.'),
}).describe('Operation result.')

export const listEventsInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
  q: z.string().describe('Full-text event search query.').optional(),
  iCalUID: z.string().describe('iCalendar UID filter.').optional(),
  orderBy: z.string().describe('Sort order.').optional(),
  timeMin: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
  timeMax: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
  timeZone: z.string().describe('Response time zone.').optional(),
  pageToken: z.string().describe('Page token.').optional(),
  syncToken: z.string().describe('Incremental sync token.').optional(),
  eventTypes: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).describe('One string or an array of strings.').optional(),
  maxResults: z.int().min(1).max(2500).describe('Maximum events to return.').optional(),
  updatedMin: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
  showDeleted: z.boolean().describe('Include deleted events.').optional(),
  maxAttendees: z.int().min(1).describe('Maximum attendees per event.').optional(),
  singleEvents: z.boolean().describe('Expand recurring events.').optional(),
  showHiddenInvitations: z.boolean().describe('Include hidden invitations.').optional(),
  sharedExtendedProperty: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).describe('One string or an array of strings.').optional(),
  privateExtendedProperty: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).describe('One string or an array of strings.').optional(),
}).describe('The input payload for this action.')

export const listEventsOutput = z.looseObject({
  items: z.array(z.looseObject({
    id: z.string().min(1).describe('Event ID.'),
    status: z.string().min(1).describe('Event status.'),
    summary: z.string().describe('Event title.').optional(),
    description: z.string().describe('Event description.').optional(),
    location: z.string().describe('Event location.').optional(),
    htmlLink: z.string().describe('Google Calendar web URL.').optional(),
    created: z.string().describe('Creation timestamp.').optional(),
    updated: z.string().describe('Update timestamp.').optional(),
    start: z.strictObject({
      date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
      dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
      timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
    }).describe('Event date or date-time.').optional(),
    end: z.strictObject({
      date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
      dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
      timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
    }).describe('Event date or date-time.').optional(),
    organizer: z.looseObject({}).describe('Google Calendar API object.').optional(),
    creator: z.looseObject({}).describe('Google Calendar API object.').optional(),
    attendees: z.array(z.strictObject({
      email: z.string().min(1).describe('Attendee email address.'),
      displayName: z.string().describe('Attendee display name.').optional(),
      optional: z.boolean().describe('Whether attendance is optional.').optional(),
      resource: z.boolean().describe('Whether the attendee represents a resource.').optional(),
      responseStatus: z.string().describe('Attendee response status.').optional(),
      comment: z.string().describe('Additional attendee comment.').optional(),
      additionalGuests: z.int().describe('Number of additional guests.').optional(),
    }).describe('Event attendee.')).describe('Event attendees.').optional(),
    recurrence: z.array(z.string().min(1)).describe('Recurrence rules.').optional(),
    recurringEventId: z.string().describe('Recurring master event ID.').optional(),
    originalStartTime: z.strictObject({
      date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
      dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
      timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
    }).describe('Event date or date-time.').optional(),
    eventType: z.string().describe('Event type.').optional(),
    conferenceData: z.looseObject({}).describe('Google Calendar API object.').optional(),
    extendedProperties: z.looseObject({}).describe('Google Calendar API object.').optional(),
    attachments: z.array(z.looseObject({}).describe('Google Calendar API object.')).describe('Google Calendar API objects.').optional(),
    reminders: z.strictObject({
      useDefault: z.boolean().describe('Whether to use default calendar reminders.').optional(),
      overrides: z.array(z.strictObject({
        method: z.string().min(1).describe('Reminder delivery method, such as email or popup.'),
        minutes: z.int().describe('Minutes before the event.'),
      }).describe('Reminder override.')).describe('Reminder overrides.').optional(),
    }).describe('Event reminders.').optional(),
    source: z.looseObject({}).describe('Google Calendar API object.').optional(),
  }).describe('Google Calendar event.')).describe('Events returned by Google Calendar.'),
  nextPageToken: z.string().describe('Next page token.').optional(),
  nextSyncToken: z.string().describe('Incremental sync token.').optional(),
  timeZone: z.string().describe('Response time zone.').optional(),
  updated: z.string().describe('Response update timestamp.').optional(),
}).describe('Events page.')

export const listEventsAllCalendarsInput = z.strictObject({
  calendarIds: z.array(z.string().min(1)).describe('Calendar IDs to query.').optional(),
  q: z.string().describe('Full-text event search query.').optional(),
  timeMin: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.'),
  timeMax: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.'),
  timeZone: z.string().describe('Response time zone.').optional(),
  eventTypes: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).describe('One string or an array of strings.').optional(),
  showDeleted: z.boolean().describe('Include deleted events.').optional(),
  singleEvents: z.boolean().describe('Expand recurring events.').optional(),
  maxResultsPerCalendar: z.int().min(1).max(2500).describe('Maximum events per calendar.').optional(),
}).describe('The input payload for this action.')

export const listEventsAllCalendarsOutput = z.strictObject({
  events: z.array(z.looseObject({
    id: z.string().min(1).describe('Event ID.').optional(),
    status: z.string().min(1).describe('Event status.').optional(),
    summary: z.string().describe('Event title.').optional(),
    description: z.string().describe('Event description.').optional(),
    location: z.string().describe('Event location.').optional(),
    htmlLink: z.string().describe('Google Calendar web URL.').optional(),
    created: z.string().describe('Creation timestamp.').optional(),
    updated: z.string().describe('Update timestamp.').optional(),
    start: z.strictObject({
      date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
      dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
      timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
    }).describe('Event date or date-time.').optional(),
    end: z.strictObject({
      date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
      dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
      timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
    }).describe('Event date or date-time.').optional(),
    organizer: z.looseObject({}).describe('Google Calendar API object.').optional(),
    creator: z.looseObject({}).describe('Google Calendar API object.').optional(),
    attendees: z.array(z.strictObject({
      email: z.string().min(1).describe('Attendee email address.'),
      displayName: z.string().describe('Attendee display name.').optional(),
      optional: z.boolean().describe('Whether attendance is optional.').optional(),
      resource: z.boolean().describe('Whether the attendee represents a resource.').optional(),
      responseStatus: z.string().describe('Attendee response status.').optional(),
      comment: z.string().describe('Additional attendee comment.').optional(),
      additionalGuests: z.int().describe('Number of additional guests.').optional(),
    }).describe('Event attendee.')).describe('Event attendees.').optional(),
    recurrence: z.array(z.string().min(1)).describe('Recurrence rules.').optional(),
    recurringEventId: z.string().describe('Recurring master event ID.').optional(),
    originalStartTime: z.strictObject({
      date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
      dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
      timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
    }).describe('Event date or date-time.').optional(),
    eventType: z.string().describe('Event type.').optional(),
    conferenceData: z.looseObject({}).describe('Google Calendar API object.').optional(),
    extendedProperties: z.looseObject({}).describe('Google Calendar API object.').optional(),
    attachments: z.array(z.looseObject({}).describe('Google Calendar API object.')).describe('Google Calendar API objects.').optional(),
    reminders: z.strictObject({
      useDefault: z.boolean().describe('Whether to use default calendar reminders.').optional(),
      overrides: z.array(z.strictObject({
        method: z.string().min(1).describe('Reminder delivery method, such as email or popup.'),
        minutes: z.int().describe('Minutes before the event.'),
      }).describe('Reminder override.')).describe('Reminder overrides.').optional(),
    }).describe('Event reminders.').optional(),
    source: z.looseObject({}).describe('Google Calendar API object.').optional(),
    sourceCalendar: z.looseObject({}).describe('Google Calendar API object.').optional(),
  })).describe('Aggregated events.'),
  summaryView: z.array(z.looseObject({}).describe('Google Calendar API object.')).describe('Google Calendar API objects.'),
  calendarsQueried: z.array(z.looseObject({}).describe('Google Calendar API object.')).describe('Google Calendar API objects.'),
  errorsByCalendar: z.record(z.string(), z.looseObject({}).describe('Google Calendar API object.')).describe('Errors keyed by calendar ID.'),
}).describe('Aggregated calendar events.')

export const getEventInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
  eventId: z.string().min(1).describe('Google Calendar event ID.'),
}).describe('The input payload for this action.')

export const getEventOutput = z.looseObject({
  id: z.string().min(1).describe('Event ID.'),
  status: z.string().min(1).describe('Event status.'),
  summary: z.string().describe('Event title.').optional(),
  description: z.string().describe('Event description.').optional(),
  location: z.string().describe('Event location.').optional(),
  htmlLink: z.string().describe('Google Calendar web URL.').optional(),
  created: z.string().describe('Creation timestamp.').optional(),
  updated: z.string().describe('Update timestamp.').optional(),
  start: z.strictObject({
    date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
    dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
    timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
  }).describe('Event date or date-time.').optional(),
  end: z.strictObject({
    date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
    dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
    timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
  }).describe('Event date or date-time.').optional(),
  organizer: z.looseObject({}).describe('Google Calendar API object.').optional(),
  creator: z.looseObject({}).describe('Google Calendar API object.').optional(),
  attendees: z.array(z.strictObject({
    email: z.string().min(1).describe('Attendee email address.'),
    displayName: z.string().describe('Attendee display name.').optional(),
    optional: z.boolean().describe('Whether attendance is optional.').optional(),
    resource: z.boolean().describe('Whether the attendee represents a resource.').optional(),
    responseStatus: z.string().describe('Attendee response status.').optional(),
    comment: z.string().describe('Additional attendee comment.').optional(),
    additionalGuests: z.int().describe('Number of additional guests.').optional(),
  }).describe('Event attendee.')).describe('Event attendees.').optional(),
  recurrence: z.array(z.string().min(1)).describe('Recurrence rules.').optional(),
  recurringEventId: z.string().describe('Recurring master event ID.').optional(),
  originalStartTime: z.strictObject({
    date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
    dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
    timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
  }).describe('Event date or date-time.').optional(),
  eventType: z.string().describe('Event type.').optional(),
  conferenceData: z.looseObject({}).describe('Google Calendar API object.').optional(),
  extendedProperties: z.looseObject({}).describe('Google Calendar API object.').optional(),
  attachments: z.array(z.looseObject({}).describe('Google Calendar API object.')).describe('Google Calendar API objects.').optional(),
  reminders: z.strictObject({
    useDefault: z.boolean().describe('Whether to use default calendar reminders.').optional(),
    overrides: z.array(z.strictObject({
      method: z.string().min(1).describe('Reminder delivery method, such as email or popup.'),
      minutes: z.int().describe('Minutes before the event.'),
    }).describe('Reminder override.')).describe('Reminder overrides.').optional(),
  }).describe('Event reminders.').optional(),
  source: z.looseObject({}).describe('Google Calendar API object.').optional(),
}).describe('Google Calendar event.')

export const createEventInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
  event: z.strictObject({
    summary: z.string().describe('Event title.').optional(),
    description: z.string().describe('Event description.').optional(),
    location: z.string().describe('Event location.').optional(),
    start: z.strictObject({
      date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
      dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
      timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
    }).describe('Event date or date-time.'),
    end: z.strictObject({
      date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
      dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
      timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
    }).describe('Event date or date-time.'),
    attendees: z.array(z.strictObject({
      email: z.string().min(1).describe('Attendee email address.'),
      displayName: z.string().describe('Attendee display name.').optional(),
      optional: z.boolean().describe('Whether attendance is optional.').optional(),
      resource: z.boolean().describe('Whether the attendee represents a resource.').optional(),
      responseStatus: z.string().describe('Attendee response status.').optional(),
      comment: z.string().describe('Additional attendee comment.').optional(),
      additionalGuests: z.int().describe('Number of additional guests.').optional(),
    }).describe('Event attendee.')).describe('Event attendees.').optional(),
    recurrence: z.array(z.string().min(1)).describe('Recurrence rules.').optional(),
    conferenceData: z.looseObject({}).describe('Google Calendar API object.').optional(),
    reminders: z.strictObject({
      useDefault: z.boolean().describe('Whether to use default calendar reminders.').optional(),
      overrides: z.array(z.strictObject({
        method: z.string().min(1).describe('Reminder delivery method, such as email or popup.'),
        minutes: z.int().describe('Minutes before the event.'),
      }).describe('Reminder override.')).describe('Reminder overrides.').optional(),
    }).describe('Event reminders.').optional(),
    colorId: z.string().describe('Google Calendar color ID.').optional(),
    visibility: z.string().describe('Event visibility.').optional(),
    transparency: z.string().describe('Whether the event blocks time.').optional(),
    status: z.string().describe('Event status.').optional(),
    extendedProperties: z.looseObject({}).describe('Google Calendar API object.').optional(),
    attachments: z.array(z.looseObject({}).describe('Google Calendar API object.')).describe('Google Calendar API objects.').optional(),
    source: z.looseObject({}).describe('Google Calendar API object.').optional(),
  }).describe('Event creation payload.'),
}).describe('The input payload for this action.')

export const createEventOutput = z.looseObject({
  id: z.string().min(1).describe('Event ID.'),
  status: z.string().min(1).describe('Event status.'),
  summary: z.string().describe('Event title.').optional(),
  description: z.string().describe('Event description.').optional(),
  location: z.string().describe('Event location.').optional(),
  htmlLink: z.string().describe('Google Calendar web URL.').optional(),
  created: z.string().describe('Creation timestamp.').optional(),
  updated: z.string().describe('Update timestamp.').optional(),
  start: z.strictObject({
    date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
    dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
    timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
  }).describe('Event date or date-time.').optional(),
  end: z.strictObject({
    date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
    dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
    timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
  }).describe('Event date or date-time.').optional(),
  organizer: z.looseObject({}).describe('Google Calendar API object.').optional(),
  creator: z.looseObject({}).describe('Google Calendar API object.').optional(),
  attendees: z.array(z.strictObject({
    email: z.string().min(1).describe('Attendee email address.'),
    displayName: z.string().describe('Attendee display name.').optional(),
    optional: z.boolean().describe('Whether attendance is optional.').optional(),
    resource: z.boolean().describe('Whether the attendee represents a resource.').optional(),
    responseStatus: z.string().describe('Attendee response status.').optional(),
    comment: z.string().describe('Additional attendee comment.').optional(),
    additionalGuests: z.int().describe('Number of additional guests.').optional(),
  }).describe('Event attendee.')).describe('Event attendees.').optional(),
  recurrence: z.array(z.string().min(1)).describe('Recurrence rules.').optional(),
  recurringEventId: z.string().describe('Recurring master event ID.').optional(),
  originalStartTime: z.strictObject({
    date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
    dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
    timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
  }).describe('Event date or date-time.').optional(),
  eventType: z.string().describe('Event type.').optional(),
  conferenceData: z.looseObject({}).describe('Google Calendar API object.').optional(),
  extendedProperties: z.looseObject({}).describe('Google Calendar API object.').optional(),
  attachments: z.array(z.looseObject({}).describe('Google Calendar API object.')).describe('Google Calendar API objects.').optional(),
  reminders: z.strictObject({
    useDefault: z.boolean().describe('Whether to use default calendar reminders.').optional(),
    overrides: z.array(z.strictObject({
      method: z.string().min(1).describe('Reminder delivery method, such as email or popup.'),
      minutes: z.int().describe('Minutes before the event.'),
    }).describe('Reminder override.')).describe('Reminder overrides.').optional(),
  }).describe('Event reminders.').optional(),
  source: z.looseObject({}).describe('Google Calendar API object.').optional(),
}).describe('Google Calendar event.')

export const updateEventInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
  eventId: z.string().min(1).describe('Google Calendar event ID.'),
  event: z.strictObject({
    summary: z.string().describe('Event title.').optional(),
    description: z.string().describe('Event description.').optional(),
    location: z.string().describe('Event location.').optional(),
    start: z.strictObject({
      date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
      dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
      timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
    }).describe('Event date or date-time.').optional(),
    end: z.strictObject({
      date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
      dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
      timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
    }).describe('Event date or date-time.').optional(),
    attendees: z.array(z.strictObject({
      email: z.string().min(1).describe('Attendee email address.'),
      displayName: z.string().describe('Attendee display name.').optional(),
      optional: z.boolean().describe('Whether attendance is optional.').optional(),
      resource: z.boolean().describe('Whether the attendee represents a resource.').optional(),
      responseStatus: z.string().describe('Attendee response status.').optional(),
      comment: z.string().describe('Additional attendee comment.').optional(),
      additionalGuests: z.int().describe('Number of additional guests.').optional(),
    }).describe('Event attendee.')).describe('Event attendees.').optional(),
    recurrence: z.array(z.string().min(1)).describe('Recurrence rules.').optional(),
    conferenceData: z.looseObject({}).describe('Google Calendar API object.').optional(),
    reminders: z.strictObject({
      useDefault: z.boolean().describe('Whether to use default calendar reminders.').optional(),
      overrides: z.array(z.strictObject({
        method: z.string().min(1).describe('Reminder delivery method, such as email or popup.'),
        minutes: z.int().describe('Minutes before the event.'),
      }).describe('Reminder override.')).describe('Reminder overrides.').optional(),
    }).describe('Event reminders.').optional(),
    colorId: z.string().describe('Google Calendar color ID.').optional(),
    visibility: z.string().describe('Event visibility.').optional(),
    transparency: z.string().describe('Whether the event blocks time.').optional(),
    status: z.string().describe('Event status.').optional(),
    extendedProperties: z.looseObject({}).describe('Google Calendar API object.').optional(),
    attachments: z.array(z.looseObject({}).describe('Google Calendar API object.')).describe('Google Calendar API objects.').optional(),
    source: z.looseObject({}).describe('Google Calendar API object.').optional(),
  }).describe('Writable Google Calendar event fields.'),
}).describe('The input payload for this action.')

export const updateEventOutput = z.looseObject({
  id: z.string().min(1).describe('Event ID.'),
  status: z.string().min(1).describe('Event status.'),
  summary: z.string().describe('Event title.').optional(),
  description: z.string().describe('Event description.').optional(),
  location: z.string().describe('Event location.').optional(),
  htmlLink: z.string().describe('Google Calendar web URL.').optional(),
  created: z.string().describe('Creation timestamp.').optional(),
  updated: z.string().describe('Update timestamp.').optional(),
  start: z.strictObject({
    date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
    dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
    timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
  }).describe('Event date or date-time.').optional(),
  end: z.strictObject({
    date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
    dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
    timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
  }).describe('Event date or date-time.').optional(),
  organizer: z.looseObject({}).describe('Google Calendar API object.').optional(),
  creator: z.looseObject({}).describe('Google Calendar API object.').optional(),
  attendees: z.array(z.strictObject({
    email: z.string().min(1).describe('Attendee email address.'),
    displayName: z.string().describe('Attendee display name.').optional(),
    optional: z.boolean().describe('Whether attendance is optional.').optional(),
    resource: z.boolean().describe('Whether the attendee represents a resource.').optional(),
    responseStatus: z.string().describe('Attendee response status.').optional(),
    comment: z.string().describe('Additional attendee comment.').optional(),
    additionalGuests: z.int().describe('Number of additional guests.').optional(),
  }).describe('Event attendee.')).describe('Event attendees.').optional(),
  recurrence: z.array(z.string().min(1)).describe('Recurrence rules.').optional(),
  recurringEventId: z.string().describe('Recurring master event ID.').optional(),
  originalStartTime: z.strictObject({
    date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
    dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
    timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
  }).describe('Event date or date-time.').optional(),
  eventType: z.string().describe('Event type.').optional(),
  conferenceData: z.looseObject({}).describe('Google Calendar API object.').optional(),
  extendedProperties: z.looseObject({}).describe('Google Calendar API object.').optional(),
  attachments: z.array(z.looseObject({}).describe('Google Calendar API object.')).describe('Google Calendar API objects.').optional(),
  reminders: z.strictObject({
    useDefault: z.boolean().describe('Whether to use default calendar reminders.').optional(),
    overrides: z.array(z.strictObject({
      method: z.string().min(1).describe('Reminder delivery method, such as email or popup.'),
      minutes: z.int().describe('Minutes before the event.'),
    }).describe('Reminder override.')).describe('Reminder overrides.').optional(),
  }).describe('Event reminders.').optional(),
  source: z.looseObject({}).describe('Google Calendar API object.').optional(),
}).describe('Google Calendar event.')

export const patchEventInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
  eventId: z.string().min(1).describe('Google Calendar event ID.'),
  event: z.strictObject({
    summary: z.string().describe('Event title.').optional(),
    description: z.string().describe('Event description.').optional(),
    location: z.string().describe('Event location.').optional(),
    start: z.strictObject({
      date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
      dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
      timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
    }).describe('Event date or date-time.').optional(),
    end: z.strictObject({
      date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
      dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
      timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
    }).describe('Event date or date-time.').optional(),
    attendees: z.array(z.strictObject({
      email: z.string().min(1).describe('Attendee email address.'),
      displayName: z.string().describe('Attendee display name.').optional(),
      optional: z.boolean().describe('Whether attendance is optional.').optional(),
      resource: z.boolean().describe('Whether the attendee represents a resource.').optional(),
      responseStatus: z.string().describe('Attendee response status.').optional(),
      comment: z.string().describe('Additional attendee comment.').optional(),
      additionalGuests: z.int().describe('Number of additional guests.').optional(),
    }).describe('Event attendee.')).describe('Event attendees.').optional(),
    recurrence: z.array(z.string().min(1)).describe('Recurrence rules.').optional(),
    conferenceData: z.looseObject({}).describe('Google Calendar API object.').optional(),
    reminders: z.strictObject({
      useDefault: z.boolean().describe('Whether to use default calendar reminders.').optional(),
      overrides: z.array(z.strictObject({
        method: z.string().min(1).describe('Reminder delivery method, such as email or popup.'),
        minutes: z.int().describe('Minutes before the event.'),
      }).describe('Reminder override.')).describe('Reminder overrides.').optional(),
    }).describe('Event reminders.').optional(),
    colorId: z.string().describe('Google Calendar color ID.').optional(),
    visibility: z.string().describe('Event visibility.').optional(),
    transparency: z.string().describe('Whether the event blocks time.').optional(),
    status: z.string().describe('Event status.').optional(),
    extendedProperties: z.looseObject({}).describe('Google Calendar API object.').optional(),
    attachments: z.array(z.looseObject({}).describe('Google Calendar API object.')).describe('Google Calendar API objects.').optional(),
    source: z.looseObject({}).describe('Google Calendar API object.').optional(),
  }).describe('Writable Google Calendar event fields.'),
}).describe('The input payload for this action.')

export const patchEventOutput = z.looseObject({
  id: z.string().min(1).describe('Event ID.'),
  status: z.string().min(1).describe('Event status.'),
  summary: z.string().describe('Event title.').optional(),
  description: z.string().describe('Event description.').optional(),
  location: z.string().describe('Event location.').optional(),
  htmlLink: z.string().describe('Google Calendar web URL.').optional(),
  created: z.string().describe('Creation timestamp.').optional(),
  updated: z.string().describe('Update timestamp.').optional(),
  start: z.strictObject({
    date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
    dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
    timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
  }).describe('Event date or date-time.').optional(),
  end: z.strictObject({
    date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
    dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
    timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
  }).describe('Event date or date-time.').optional(),
  organizer: z.looseObject({}).describe('Google Calendar API object.').optional(),
  creator: z.looseObject({}).describe('Google Calendar API object.').optional(),
  attendees: z.array(z.strictObject({
    email: z.string().min(1).describe('Attendee email address.'),
    displayName: z.string().describe('Attendee display name.').optional(),
    optional: z.boolean().describe('Whether attendance is optional.').optional(),
    resource: z.boolean().describe('Whether the attendee represents a resource.').optional(),
    responseStatus: z.string().describe('Attendee response status.').optional(),
    comment: z.string().describe('Additional attendee comment.').optional(),
    additionalGuests: z.int().describe('Number of additional guests.').optional(),
  }).describe('Event attendee.')).describe('Event attendees.').optional(),
  recurrence: z.array(z.string().min(1)).describe('Recurrence rules.').optional(),
  recurringEventId: z.string().describe('Recurring master event ID.').optional(),
  originalStartTime: z.strictObject({
    date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
    dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
    timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
  }).describe('Event date or date-time.').optional(),
  eventType: z.string().describe('Event type.').optional(),
  conferenceData: z.looseObject({}).describe('Google Calendar API object.').optional(),
  extendedProperties: z.looseObject({}).describe('Google Calendar API object.').optional(),
  attachments: z.array(z.looseObject({}).describe('Google Calendar API object.')).describe('Google Calendar API objects.').optional(),
  reminders: z.strictObject({
    useDefault: z.boolean().describe('Whether to use default calendar reminders.').optional(),
    overrides: z.array(z.strictObject({
      method: z.string().min(1).describe('Reminder delivery method, such as email or popup.'),
      minutes: z.int().describe('Minutes before the event.'),
    }).describe('Reminder override.')).describe('Reminder overrides.').optional(),
  }).describe('Event reminders.').optional(),
  source: z.looseObject({}).describe('Google Calendar API object.').optional(),
}).describe('Google Calendar event.')

export const deleteEventInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
  eventId: z.string().min(1).describe('Google Calendar event ID.'),
}).describe('The input payload for this action.')

export const deleteEventOutput = z.strictObject({
  success: z.literal(true).describe('Whether the operation completed successfully.'),
}).describe('Operation result.')

export const importEventInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
  event: z.strictObject({
    summary: z.string().describe('Event title.').optional(),
    description: z.string().describe('Event description.').optional(),
    location: z.string().describe('Event location.').optional(),
    start: z.strictObject({
      date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
      dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
      timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
    }).describe('Event date or date-time.'),
    end: z.strictObject({
      date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
      dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
      timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
    }).describe('Event date or date-time.'),
    attendees: z.array(z.strictObject({
      email: z.string().min(1).describe('Attendee email address.'),
      displayName: z.string().describe('Attendee display name.').optional(),
      optional: z.boolean().describe('Whether attendance is optional.').optional(),
      resource: z.boolean().describe('Whether the attendee represents a resource.').optional(),
      responseStatus: z.string().describe('Attendee response status.').optional(),
      comment: z.string().describe('Additional attendee comment.').optional(),
      additionalGuests: z.int().describe('Number of additional guests.').optional(),
    }).describe('Event attendee.')).describe('Event attendees.').optional(),
    recurrence: z.array(z.string().min(1)).describe('Recurrence rules.').optional(),
    conferenceData: z.looseObject({}).describe('Google Calendar API object.').optional(),
    reminders: z.strictObject({
      useDefault: z.boolean().describe('Whether to use default calendar reminders.').optional(),
      overrides: z.array(z.strictObject({
        method: z.string().min(1).describe('Reminder delivery method, such as email or popup.'),
        minutes: z.int().describe('Minutes before the event.'),
      }).describe('Reminder override.')).describe('Reminder overrides.').optional(),
    }).describe('Event reminders.').optional(),
    colorId: z.string().describe('Google Calendar color ID.').optional(),
    visibility: z.string().describe('Event visibility.').optional(),
    transparency: z.string().describe('Whether the event blocks time.').optional(),
    status: z.string().describe('Event status.').optional(),
    extendedProperties: z.looseObject({}).describe('Google Calendar API object.').optional(),
    attachments: z.array(z.looseObject({}).describe('Google Calendar API object.')).describe('Google Calendar API objects.').optional(),
    source: z.looseObject({}).describe('Google Calendar API object.').optional(),
    iCalUID: z.string().min(1).describe('iCalendar UID required when importing an event.'),
  }).describe('Imported event payload.'),
}).describe('The input payload for this action.')

export const importEventOutput = z.looseObject({
  id: z.string().min(1).describe('Event ID.'),
  status: z.string().min(1).describe('Event status.'),
  summary: z.string().describe('Event title.').optional(),
  description: z.string().describe('Event description.').optional(),
  location: z.string().describe('Event location.').optional(),
  htmlLink: z.string().describe('Google Calendar web URL.').optional(),
  created: z.string().describe('Creation timestamp.').optional(),
  updated: z.string().describe('Update timestamp.').optional(),
  start: z.strictObject({
    date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
    dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
    timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
  }).describe('Event date or date-time.').optional(),
  end: z.strictObject({
    date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
    dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
    timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
  }).describe('Event date or date-time.').optional(),
  organizer: z.looseObject({}).describe('Google Calendar API object.').optional(),
  creator: z.looseObject({}).describe('Google Calendar API object.').optional(),
  attendees: z.array(z.strictObject({
    email: z.string().min(1).describe('Attendee email address.'),
    displayName: z.string().describe('Attendee display name.').optional(),
    optional: z.boolean().describe('Whether attendance is optional.').optional(),
    resource: z.boolean().describe('Whether the attendee represents a resource.').optional(),
    responseStatus: z.string().describe('Attendee response status.').optional(),
    comment: z.string().describe('Additional attendee comment.').optional(),
    additionalGuests: z.int().describe('Number of additional guests.').optional(),
  }).describe('Event attendee.')).describe('Event attendees.').optional(),
  recurrence: z.array(z.string().min(1)).describe('Recurrence rules.').optional(),
  recurringEventId: z.string().describe('Recurring master event ID.').optional(),
  originalStartTime: z.strictObject({
    date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
    dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
    timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
  }).describe('Event date or date-time.').optional(),
  eventType: z.string().describe('Event type.').optional(),
  conferenceData: z.looseObject({}).describe('Google Calendar API object.').optional(),
  extendedProperties: z.looseObject({}).describe('Google Calendar API object.').optional(),
  attachments: z.array(z.looseObject({}).describe('Google Calendar API object.')).describe('Google Calendar API objects.').optional(),
  reminders: z.strictObject({
    useDefault: z.boolean().describe('Whether to use default calendar reminders.').optional(),
    overrides: z.array(z.strictObject({
      method: z.string().min(1).describe('Reminder delivery method, such as email or popup.'),
      minutes: z.int().describe('Minutes before the event.'),
    }).describe('Reminder override.')).describe('Reminder overrides.').optional(),
  }).describe('Event reminders.').optional(),
  source: z.looseObject({}).describe('Google Calendar API object.').optional(),
}).describe('Google Calendar event.')

export const moveEventInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
  eventId: z.string().min(1).describe('Google Calendar event ID.'),
  destinationCalendarId: z.string().min(1).describe('Destination calendar ID.'),
}).describe('The input payload for this action.')

export const moveEventOutput = z.looseObject({
  id: z.string().min(1).describe('Event ID.'),
  status: z.string().min(1).describe('Event status.'),
  summary: z.string().describe('Event title.').optional(),
  description: z.string().describe('Event description.').optional(),
  location: z.string().describe('Event location.').optional(),
  htmlLink: z.string().describe('Google Calendar web URL.').optional(),
  created: z.string().describe('Creation timestamp.').optional(),
  updated: z.string().describe('Update timestamp.').optional(),
  start: z.strictObject({
    date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
    dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
    timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
  }).describe('Event date or date-time.').optional(),
  end: z.strictObject({
    date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
    dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
    timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
  }).describe('Event date or date-time.').optional(),
  organizer: z.looseObject({}).describe('Google Calendar API object.').optional(),
  creator: z.looseObject({}).describe('Google Calendar API object.').optional(),
  attendees: z.array(z.strictObject({
    email: z.string().min(1).describe('Attendee email address.'),
    displayName: z.string().describe('Attendee display name.').optional(),
    optional: z.boolean().describe('Whether attendance is optional.').optional(),
    resource: z.boolean().describe('Whether the attendee represents a resource.').optional(),
    responseStatus: z.string().describe('Attendee response status.').optional(),
    comment: z.string().describe('Additional attendee comment.').optional(),
    additionalGuests: z.int().describe('Number of additional guests.').optional(),
  }).describe('Event attendee.')).describe('Event attendees.').optional(),
  recurrence: z.array(z.string().min(1)).describe('Recurrence rules.').optional(),
  recurringEventId: z.string().describe('Recurring master event ID.').optional(),
  originalStartTime: z.strictObject({
    date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
    dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
    timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
  }).describe('Event date or date-time.').optional(),
  eventType: z.string().describe('Event type.').optional(),
  conferenceData: z.looseObject({}).describe('Google Calendar API object.').optional(),
  extendedProperties: z.looseObject({}).describe('Google Calendar API object.').optional(),
  attachments: z.array(z.looseObject({}).describe('Google Calendar API object.')).describe('Google Calendar API objects.').optional(),
  reminders: z.strictObject({
    useDefault: z.boolean().describe('Whether to use default calendar reminders.').optional(),
    overrides: z.array(z.strictObject({
      method: z.string().min(1).describe('Reminder delivery method, such as email or popup.'),
      minutes: z.int().describe('Minutes before the event.'),
    }).describe('Reminder override.')).describe('Reminder overrides.').optional(),
  }).describe('Event reminders.').optional(),
  source: z.looseObject({}).describe('Google Calendar API object.').optional(),
}).describe('Google Calendar event.')

export const listEventInstancesInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
  eventId: z.string().min(1).describe('Google Calendar event ID.'),
  timeMin: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
  timeMax: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
  timeZone: z.string().describe('Response time zone.').optional(),
  pageToken: z.string().describe('Page token.').optional(),
  maxResults: z.int().min(1).max(2500).describe('Maximum instances to return.').optional(),
  showDeleted: z.boolean().describe('Include deleted instances.').optional(),
  maxAttendees: z.int().min(1).describe('Maximum attendees per instance.').optional(),
}).describe('The input payload for this action.')

export const listEventInstancesOutput = z.looseObject({
  items: z.array(z.looseObject({
    id: z.string().min(1).describe('Event ID.'),
    status: z.string().min(1).describe('Event status.'),
    summary: z.string().describe('Event title.').optional(),
    description: z.string().describe('Event description.').optional(),
    location: z.string().describe('Event location.').optional(),
    htmlLink: z.string().describe('Google Calendar web URL.').optional(),
    created: z.string().describe('Creation timestamp.').optional(),
    updated: z.string().describe('Update timestamp.').optional(),
    start: z.strictObject({
      date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
      dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
      timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
    }).describe('Event date or date-time.').optional(),
    end: z.strictObject({
      date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
      dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
      timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
    }).describe('Event date or date-time.').optional(),
    organizer: z.looseObject({}).describe('Google Calendar API object.').optional(),
    creator: z.looseObject({}).describe('Google Calendar API object.').optional(),
    attendees: z.array(z.strictObject({
      email: z.string().min(1).describe('Attendee email address.'),
      displayName: z.string().describe('Attendee display name.').optional(),
      optional: z.boolean().describe('Whether attendance is optional.').optional(),
      resource: z.boolean().describe('Whether the attendee represents a resource.').optional(),
      responseStatus: z.string().describe('Attendee response status.').optional(),
      comment: z.string().describe('Additional attendee comment.').optional(),
      additionalGuests: z.int().describe('Number of additional guests.').optional(),
    }).describe('Event attendee.')).describe('Event attendees.').optional(),
    recurrence: z.array(z.string().min(1)).describe('Recurrence rules.').optional(),
    recurringEventId: z.string().describe('Recurring master event ID.').optional(),
    originalStartTime: z.strictObject({
      date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
      dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
      timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
    }).describe('Event date or date-time.').optional(),
    eventType: z.string().describe('Event type.').optional(),
    conferenceData: z.looseObject({}).describe('Google Calendar API object.').optional(),
    extendedProperties: z.looseObject({}).describe('Google Calendar API object.').optional(),
    attachments: z.array(z.looseObject({}).describe('Google Calendar API object.')).describe('Google Calendar API objects.').optional(),
    reminders: z.strictObject({
      useDefault: z.boolean().describe('Whether to use default calendar reminders.').optional(),
      overrides: z.array(z.strictObject({
        method: z.string().min(1).describe('Reminder delivery method, such as email or popup.'),
        minutes: z.int().describe('Minutes before the event.'),
      }).describe('Reminder override.')).describe('Reminder overrides.').optional(),
    }).describe('Event reminders.').optional(),
    source: z.looseObject({}).describe('Google Calendar API object.').optional(),
  }).describe('Google Calendar event.')).describe('Events returned by Google Calendar.'),
  nextPageToken: z.string().describe('Next page token.').optional(),
  nextSyncToken: z.string().describe('Incremental sync token.').optional(),
  timeZone: z.string().describe('Response time zone.').optional(),
  updated: z.string().describe('Response update timestamp.').optional(),
}).describe('Events page.')

export const quickAddEventInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
  text: z.string().min(1).describe('Natural-language event text.'),
}).describe('The input payload for this action.')

export const quickAddEventOutput = z.looseObject({
  id: z.string().min(1).describe('Event ID.'),
  status: z.string().min(1).describe('Event status.'),
  summary: z.string().describe('Event title.').optional(),
  description: z.string().describe('Event description.').optional(),
  location: z.string().describe('Event location.').optional(),
  htmlLink: z.string().describe('Google Calendar web URL.').optional(),
  created: z.string().describe('Creation timestamp.').optional(),
  updated: z.string().describe('Update timestamp.').optional(),
  start: z.strictObject({
    date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
    dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
    timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
  }).describe('Event date or date-time.').optional(),
  end: z.strictObject({
    date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
    dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
    timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
  }).describe('Event date or date-time.').optional(),
  organizer: z.looseObject({}).describe('Google Calendar API object.').optional(),
  creator: z.looseObject({}).describe('Google Calendar API object.').optional(),
  attendees: z.array(z.strictObject({
    email: z.string().min(1).describe('Attendee email address.'),
    displayName: z.string().describe('Attendee display name.').optional(),
    optional: z.boolean().describe('Whether attendance is optional.').optional(),
    resource: z.boolean().describe('Whether the attendee represents a resource.').optional(),
    responseStatus: z.string().describe('Attendee response status.').optional(),
    comment: z.string().describe('Additional attendee comment.').optional(),
    additionalGuests: z.int().describe('Number of additional guests.').optional(),
  }).describe('Event attendee.')).describe('Event attendees.').optional(),
  recurrence: z.array(z.string().min(1)).describe('Recurrence rules.').optional(),
  recurringEventId: z.string().describe('Recurring master event ID.').optional(),
  originalStartTime: z.strictObject({
    date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
    dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
    timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
  }).describe('Event date or date-time.').optional(),
  eventType: z.string().describe('Event type.').optional(),
  conferenceData: z.looseObject({}).describe('Google Calendar API object.').optional(),
  extendedProperties: z.looseObject({}).describe('Google Calendar API object.').optional(),
  attachments: z.array(z.looseObject({}).describe('Google Calendar API object.')).describe('Google Calendar API objects.').optional(),
  reminders: z.strictObject({
    useDefault: z.boolean().describe('Whether to use default calendar reminders.').optional(),
    overrides: z.array(z.strictObject({
      method: z.string().min(1).describe('Reminder delivery method, such as email or popup.'),
      minutes: z.int().describe('Minutes before the event.'),
    }).describe('Reminder override.')).describe('Reminder overrides.').optional(),
  }).describe('Event reminders.').optional(),
  source: z.looseObject({}).describe('Google Calendar API object.').optional(),
}).describe('Google Calendar event.')

export const syncEventsInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
  q: z.string().describe('Full-text event search query.').optional(),
  iCalUID: z.string().describe('iCalendar UID filter.').optional(),
  orderBy: z.string().describe('Sort order.').optional(),
  timeMin: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
  timeMax: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
  timeZone: z.string().describe('Response time zone.').optional(),
  pageToken: z.string().describe('Page token.').optional(),
  syncToken: z.string().describe('Incremental sync token.').optional(),
  eventTypes: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).describe('One string or an array of strings.').optional(),
  maxResults: z.int().min(1).max(2500).describe('Maximum events to return.').optional(),
  updatedMin: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
  showDeleted: z.boolean().describe('Include deleted events.').optional(),
  maxAttendees: z.int().min(1).describe('Maximum attendees per event.').optional(),
  singleEvents: z.boolean().describe('Expand recurring events.').optional(),
  showHiddenInvitations: z.boolean().describe('Include hidden invitations.').optional(),
  sharedExtendedProperty: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).describe('One string or an array of strings.').optional(),
  privateExtendedProperty: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).describe('One string or an array of strings.').optional(),
}).describe('The input payload for this action.')

export const syncEventsOutput = z.looseObject({
  items: z.array(z.looseObject({
    id: z.string().min(1).describe('Event ID.'),
    status: z.string().min(1).describe('Event status.'),
    summary: z.string().describe('Event title.').optional(),
    description: z.string().describe('Event description.').optional(),
    location: z.string().describe('Event location.').optional(),
    htmlLink: z.string().describe('Google Calendar web URL.').optional(),
    created: z.string().describe('Creation timestamp.').optional(),
    updated: z.string().describe('Update timestamp.').optional(),
    start: z.strictObject({
      date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
      dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
      timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
    }).describe('Event date or date-time.').optional(),
    end: z.strictObject({
      date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
      dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
      timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
    }).describe('Event date or date-time.').optional(),
    organizer: z.looseObject({}).describe('Google Calendar API object.').optional(),
    creator: z.looseObject({}).describe('Google Calendar API object.').optional(),
    attendees: z.array(z.strictObject({
      email: z.string().min(1).describe('Attendee email address.'),
      displayName: z.string().describe('Attendee display name.').optional(),
      optional: z.boolean().describe('Whether attendance is optional.').optional(),
      resource: z.boolean().describe('Whether the attendee represents a resource.').optional(),
      responseStatus: z.string().describe('Attendee response status.').optional(),
      comment: z.string().describe('Additional attendee comment.').optional(),
      additionalGuests: z.int().describe('Number of additional guests.').optional(),
    }).describe('Event attendee.')).describe('Event attendees.').optional(),
    recurrence: z.array(z.string().min(1)).describe('Recurrence rules.').optional(),
    recurringEventId: z.string().describe('Recurring master event ID.').optional(),
    originalStartTime: z.strictObject({
      date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
      dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
      timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
    }).describe('Event date or date-time.').optional(),
    eventType: z.string().describe('Event type.').optional(),
    conferenceData: z.looseObject({}).describe('Google Calendar API object.').optional(),
    extendedProperties: z.looseObject({}).describe('Google Calendar API object.').optional(),
    attachments: z.array(z.looseObject({}).describe('Google Calendar API object.')).describe('Google Calendar API objects.').optional(),
    reminders: z.strictObject({
      useDefault: z.boolean().describe('Whether to use default calendar reminders.').optional(),
      overrides: z.array(z.strictObject({
        method: z.string().min(1).describe('Reminder delivery method, such as email or popup.'),
        minutes: z.int().describe('Minutes before the event.'),
      }).describe('Reminder override.')).describe('Reminder overrides.').optional(),
    }).describe('Event reminders.').optional(),
    source: z.looseObject({}).describe('Google Calendar API object.').optional(),
  }).describe('Google Calendar event.')).describe('Events returned by Google Calendar.'),
  nextPageToken: z.string().describe('Next page token.').optional(),
  nextSyncToken: z.string().describe('Incremental sync token.').optional(),
  timeZone: z.string().describe('Response time zone.').optional(),
  updated: z.string().describe('Response update timestamp.').optional(),
}).describe('Events page.')

export const freeBusyQueryInput = z.strictObject({
  items: z.union([z.array(z.string().min(1)).min(1), z.array(z.strictObject({
    id: z.string().min(1),
  })).min(1)]).describe('Calendar or group IDs to include in the freeBusy query.'),
  timeMin: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.'),
  timeMax: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.'),
  timeZone: z.string().describe('Response time zone.').optional(),
  groupExpansionMax: z.int().min(1).max(100).describe('Maximum calendars to expand per group.').optional(),
  calendarExpansionMax: z.int().min(1).max(50).describe('Maximum calendars to return after expansion.').optional(),
}).describe('The input payload for this action.')

export const freeBusyQueryOutput = z.strictObject({
  kind: z.string().min(1).describe('Google Calendar freeBusy resource kind.'),
  timeMin: z.string().min(1).describe('Lower bound of the queried time range.'),
  timeMax: z.string().min(1).describe('Upper bound of the queried time range.'),
  calendars: z.record(z.string(), z.looseObject({}).describe('Google Calendar API object.')).describe('Busy results keyed by calendar or group ID.'),
  groups: z.record(z.string(), z.looseObject({}).describe('Google Calendar API object.')).describe('Expanded group results keyed by group ID.').optional(),
}).describe('freeBusy response.')

export const findFreeSlotsInput = z.strictObject({
  items: z.union([z.array(z.string().min(1)).min(1), z.array(z.strictObject({
    id: z.string().min(1),
  })).min(1)]).describe('Calendar or group IDs to include in the freeBusy query.'),
  timeMin: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.'),
  timeMax: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.'),
  timeZone: z.string().describe('Response time zone.').optional(),
  groupExpansionMax: z.int().min(1).max(100).describe('Maximum calendars to expand per group.').optional(),
  calendarExpansionMax: z.int().min(1).max(50).describe('Maximum calendars to return after expansion.').optional(),
}).describe('The input payload for this action.')

export const findFreeSlotsOutput = z.strictObject({
  kind: z.string().min(1).describe('Derived free-slots resource kind.'),
  timeMin: z.string().min(1).describe('Lower bound of the analyzed time range.'),
  timeMax: z.string().min(1).describe('Upper bound of the analyzed time range.'),
  calendars: z.record(z.string(), z.looseObject({}).describe('Google Calendar API object.')).describe('Free-slot results keyed by calendar ID.'),
}).describe('Derived free slots.')

export const getColorsInput = z.strictObject({}).describe('The input payload for this action.')

export const getColorsOutput = z.looseObject({}).describe('Google Calendar API object.')

export const listSettingsInput = z.strictObject({
  maxResults: z.int().min(1).max(250).describe('Maximum settings to return.').optional(),
  pageToken: z.string().describe('Page token.').optional(),
  syncToken: z.string().describe('Incremental sync token.').optional(),
}).describe('The input payload for this action.')

export const listSettingsOutput = z.looseObject({
  items: z.array(z.looseObject({}).describe('Google Calendar API object.')).describe('Items returned by Google Calendar.'),
  nextPageToken: z.string().describe('Next page token.').optional(),
  nextSyncToken: z.string().describe('Incremental sync token.').optional(),
}).describe('Google Calendar page.')

export const getSettingInput = z.strictObject({
  settingId: z.string().min(1).describe('Google Calendar setting ID.'),
}).describe('The input payload for this action.')

export const getSettingOutput = z.looseObject({}).describe('Google Calendar API object.')

export const listAclInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
  maxResults: z.int().min(1).max(100).describe('Maximum ACL rules to return.').optional(),
  pageToken: z.string().describe('Page token.').optional(),
  syncToken: z.string().describe('Incremental sync token.').optional(),
  showDeleted: z.boolean().describe('Include deleted ACL rules.').optional(),
}).describe('The input payload for this action.')

export const listAclOutput = z.looseObject({
  items: z.array(z.looseObject({
    id: z.string().describe('ACL rule ID.').optional(),
    kind: z.string().describe('Google resource kind.').optional(),
    etag: z.string().describe('Entity tag.').optional(),
    role: z.string().min(1).describe('ACL role granted to the scope.'),
    scope: z.strictObject({
      type: z.string().min(1).describe('ACL scope type, such as user or default.'),
      value: z.string().describe('ACL scope value.').optional(),
    }).describe('ACL scope.'),
  }).describe('Calendar ACL rule.')).describe('Items returned by Google Calendar.'),
  nextPageToken: z.string().describe('Next page token.').optional(),
  nextSyncToken: z.string().describe('Incremental sync token.').optional(),
}).describe('Google Calendar page.')

export const getAclRuleInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
  ruleId: z.string().min(1).describe('Google Calendar ACL rule ID.'),
}).describe('The input payload for this action.')

export const getAclRuleOutput = z.looseObject({
  id: z.string().describe('ACL rule ID.').optional(),
  kind: z.string().describe('Google resource kind.').optional(),
  etag: z.string().describe('Entity tag.').optional(),
  role: z.string().min(1).describe('ACL role granted to the scope.'),
  scope: z.strictObject({
    type: z.string().min(1).describe('ACL scope type, such as user or default.'),
    value: z.string().describe('ACL scope value.').optional(),
  }).describe('ACL scope.'),
}).describe('Calendar ACL rule.')

export const createAclRuleInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
  rule: z.strictObject({
    scope: z.strictObject({
      type: z.string().min(1).describe('ACL scope type, such as user or default.'),
      value: z.string().describe('ACL scope value.').optional(),
    }).describe('ACL scope.'),
    role: z.string().min(1).describe('ACL role granted to the scope.'),
  }).describe('Writable ACL rule.'),
}).describe('The input payload for this action.')

export const createAclRuleOutput = z.looseObject({
  id: z.string().describe('ACL rule ID.').optional(),
  kind: z.string().describe('Google resource kind.').optional(),
  etag: z.string().describe('Entity tag.').optional(),
  role: z.string().min(1).describe('ACL role granted to the scope.'),
  scope: z.strictObject({
    type: z.string().min(1).describe('ACL scope type, such as user or default.'),
    value: z.string().describe('ACL scope value.').optional(),
  }).describe('ACL scope.'),
}).describe('Calendar ACL rule.')

export const updateAclRuleInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
  ruleId: z.string().min(1).describe('Google Calendar ACL rule ID.'),
  rule: z.strictObject({
    scope: z.strictObject({
      type: z.string().min(1).describe('ACL scope type, such as user or default.'),
      value: z.string().describe('ACL scope value.').optional(),
    }).describe('ACL scope.'),
    role: z.string().min(1).describe('ACL role granted to the scope.'),
  }).describe('Writable ACL rule.'),
}).describe('The input payload for this action.')

export const updateAclRuleOutput = z.looseObject({
  id: z.string().describe('ACL rule ID.').optional(),
  kind: z.string().describe('Google resource kind.').optional(),
  etag: z.string().describe('Entity tag.').optional(),
  role: z.string().min(1).describe('ACL role granted to the scope.'),
  scope: z.strictObject({
    type: z.string().min(1).describe('ACL scope type, such as user or default.'),
    value: z.string().describe('ACL scope value.').optional(),
  }).describe('ACL scope.'),
}).describe('Calendar ACL rule.')

export const patchAclRuleInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
  ruleId: z.string().min(1).describe('Google Calendar ACL rule ID.'),
  rule: z.strictObject({
    scope: z.strictObject({
      type: z.string().min(1).describe('ACL scope type, such as user or default.'),
      value: z.string().describe('ACL scope value.').optional(),
    }).describe('ACL scope.'),
    role: z.string().min(1).describe('ACL role granted to the scope.'),
  }).describe('Writable ACL rule.'),
}).describe('The input payload for this action.')

export const patchAclRuleOutput = z.looseObject({
  id: z.string().describe('ACL rule ID.').optional(),
  kind: z.string().describe('Google resource kind.').optional(),
  etag: z.string().describe('Entity tag.').optional(),
  role: z.string().min(1).describe('ACL role granted to the scope.'),
  scope: z.strictObject({
    type: z.string().min(1).describe('ACL scope type, such as user or default.'),
    value: z.string().describe('ACL scope value.').optional(),
  }).describe('ACL scope.'),
}).describe('Calendar ACL rule.')

export const deleteAclRuleInput = z.strictObject({
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.'),
  ruleId: z.string().min(1).describe('Google Calendar ACL rule ID.'),
}).describe('The input payload for this action.')

export const deleteAclRuleOutput = z.strictObject({
  success: z.literal(true).describe('Whether the operation completed successfully.'),
}).describe('Operation result.')

export const findEventInput = z.strictObject({
  query: z.string().min(1).describe('Full-text search query for events.'),
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.').optional(),
  timeMin: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
  timeMax: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
  updatedMin: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
  eventTypes: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).describe('One string or an array of strings.').optional(),
  orderBy: z.string().describe('Sort order.').optional(),
  singleEvents: z.boolean().describe('Expand recurring events.').optional(),
  showDeleted: z.boolean().describe('Include deleted events.').optional(),
  maxResults: z.int().min(1).max(2500).describe('Maximum events to return.').optional(),
  pageToken: z.string().describe('Page token.').optional(),
}).describe('The input payload for this action.')

export const findEventOutput = z.looseObject({
  items: z.array(z.looseObject({
    id: z.string().min(1).describe('Event ID.'),
    status: z.string().min(1).describe('Event status.'),
    summary: z.string().describe('Event title.').optional(),
    description: z.string().describe('Event description.').optional(),
    location: z.string().describe('Event location.').optional(),
    htmlLink: z.string().describe('Google Calendar web URL.').optional(),
    created: z.string().describe('Creation timestamp.').optional(),
    updated: z.string().describe('Update timestamp.').optional(),
    start: z.strictObject({
      date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
      dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
      timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
    }).describe('Event date or date-time.').optional(),
    end: z.strictObject({
      date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
      dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
      timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
    }).describe('Event date or date-time.').optional(),
    organizer: z.looseObject({}).describe('Google Calendar API object.').optional(),
    creator: z.looseObject({}).describe('Google Calendar API object.').optional(),
    attendees: z.array(z.strictObject({
      email: z.string().min(1).describe('Attendee email address.'),
      displayName: z.string().describe('Attendee display name.').optional(),
      optional: z.boolean().describe('Whether attendance is optional.').optional(),
      resource: z.boolean().describe('Whether the attendee represents a resource.').optional(),
      responseStatus: z.string().describe('Attendee response status.').optional(),
      comment: z.string().describe('Additional attendee comment.').optional(),
      additionalGuests: z.int().describe('Number of additional guests.').optional(),
    }).describe('Event attendee.')).describe('Event attendees.').optional(),
    recurrence: z.array(z.string().min(1)).describe('Recurrence rules.').optional(),
    recurringEventId: z.string().describe('Recurring master event ID.').optional(),
    originalStartTime: z.strictObject({
      date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
      dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
      timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
    }).describe('Event date or date-time.').optional(),
    eventType: z.string().describe('Event type.').optional(),
    conferenceData: z.looseObject({}).describe('Google Calendar API object.').optional(),
    extendedProperties: z.looseObject({}).describe('Google Calendar API object.').optional(),
    attachments: z.array(z.looseObject({}).describe('Google Calendar API object.')).describe('Google Calendar API objects.').optional(),
    reminders: z.strictObject({
      useDefault: z.boolean().describe('Whether to use default calendar reminders.').optional(),
      overrides: z.array(z.strictObject({
        method: z.string().min(1).describe('Reminder delivery method, such as email or popup.'),
        minutes: z.int().describe('Minutes before the event.'),
      }).describe('Reminder override.')).describe('Reminder overrides.').optional(),
    }).describe('Event reminders.').optional(),
    source: z.looseObject({}).describe('Google Calendar API object.').optional(),
  }).describe('Google Calendar event.')).describe('Events returned by Google Calendar.'),
  nextPageToken: z.string().describe('Next page token.').optional(),
  nextSyncToken: z.string().describe('Incremental sync token.').optional(),
  timeZone: z.string().describe('Response time zone.').optional(),
  updated: z.string().describe('Response update timestamp.').optional(),
}).describe('Events page.')

export const removeAttendeeInput = z.strictObject({
  eventId: z.string().min(1).describe('Google Calendar event ID.'),
  attendeeEmail: z.string().min(1).describe('Attendee email address to remove.'),
  calendarId: z.string().min(1).describe('Google Calendar ID. Omit to use the primary calendar when supported.').optional(),
}).describe('The input payload for this action.')

export const removeAttendeeOutput = z.looseObject({
  id: z.string().min(1).describe('Event ID.'),
  status: z.string().min(1).describe('Event status.'),
  summary: z.string().describe('Event title.').optional(),
  description: z.string().describe('Event description.').optional(),
  location: z.string().describe('Event location.').optional(),
  htmlLink: z.string().describe('Google Calendar web URL.').optional(),
  created: z.string().describe('Creation timestamp.').optional(),
  updated: z.string().describe('Update timestamp.').optional(),
  start: z.strictObject({
    date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
    dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
    timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
  }).describe('Event date or date-time.').optional(),
  end: z.strictObject({
    date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
    dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
    timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
  }).describe('Event date or date-time.').optional(),
  organizer: z.looseObject({}).describe('Google Calendar API object.').optional(),
  creator: z.looseObject({}).describe('Google Calendar API object.').optional(),
  attendees: z.array(z.strictObject({
    email: z.string().min(1).describe('Attendee email address.'),
    displayName: z.string().describe('Attendee display name.').optional(),
    optional: z.boolean().describe('Whether attendance is optional.').optional(),
    resource: z.boolean().describe('Whether the attendee represents a resource.').optional(),
    responseStatus: z.string().describe('Attendee response status.').optional(),
    comment: z.string().describe('Additional attendee comment.').optional(),
    additionalGuests: z.int().describe('Number of additional guests.').optional(),
  }).describe('Event attendee.')).describe('Event attendees.').optional(),
  recurrence: z.array(z.string().min(1)).describe('Recurrence rules.').optional(),
  recurringEventId: z.string().describe('Recurring master event ID.').optional(),
  originalStartTime: z.strictObject({
    date: z.string().min(1).describe('All-day event date in YYYY-MM-DD format.').optional(),
    dateTime: z.iso.datetime({ offset: true }).describe('RFC 3339 timestamp.').optional(),
    timeZone: z.string().min(1).describe('IANA time zone used to interpret the event time.').optional(),
  }).describe('Event date or date-time.').optional(),
  eventType: z.string().describe('Event type.').optional(),
  conferenceData: z.looseObject({}).describe('Google Calendar API object.').optional(),
  extendedProperties: z.looseObject({}).describe('Google Calendar API object.').optional(),
  attachments: z.array(z.looseObject({}).describe('Google Calendar API object.')).describe('Google Calendar API objects.').optional(),
  reminders: z.strictObject({
    useDefault: z.boolean().describe('Whether to use default calendar reminders.').optional(),
    overrides: z.array(z.strictObject({
      method: z.string().min(1).describe('Reminder delivery method, such as email or popup.'),
      minutes: z.int().describe('Minutes before the event.'),
    }).describe('Reminder override.')).describe('Reminder overrides.').optional(),
  }).describe('Event reminders.').optional(),
  source: z.looseObject({}).describe('Google Calendar API object.').optional(),
}).describe('Google Calendar event.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const googlecalendarActions = {
  list_calendars: {
    description: 'List the current user\'s Google Calendar list entries.',
    effect: 'read',
    inputSchema: listCalendarsInput,
    outputSchema: z.toJSONSchema(listCalendarsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_calendar_list_entry: {
    description: 'Fetch one Google Calendar list entry by calendar ID.',
    effect: 'read',
    inputSchema: getCalendarListEntryInput,
    outputSchema: z.toJSONSchema(getCalendarListEntryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  add_calendar_to_list: {
    description: 'Add a calendar to the current user\'s Google Calendar list.',
    effect: 'write',
    inputSchema: addCalendarToListInput,
    outputSchema: z.toJSONSchema(addCalendarToListOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_calendar_list_entry: {
    description: 'Replace writable fields on a Google Calendar list entry.',
    effect: 'write',
    inputSchema: updateCalendarListEntryInput,
    outputSchema: z.toJSONSchema(updateCalendarListEntryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  patch_calendar_list_entry: {
    description: 'Patch writable fields on a Google Calendar list entry.',
    effect: 'write',
    inputSchema: patchCalendarListEntryInput,
    outputSchema: z.toJSONSchema(patchCalendarListEntryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  remove_calendar_from_list: {
    description: 'Remove a calendar from the current user\'s Calendar list.',
    effect: 'destructive',
    inputSchema: removeCalendarFromListInput,
    outputSchema: z.toJSONSchema(removeCalendarFromListOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_calendar: {
    description: 'Fetch one Google Calendar resource by ID.',
    effect: 'read',
    inputSchema: getCalendarInput,
    outputSchema: z.toJSONSchema(getCalendarOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_calendar: {
    description: 'Create a Google Calendar.',
    effect: 'write',
    inputSchema: createCalendarInput,
    outputSchema: z.toJSONSchema(createCalendarOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_calendar: {
    description: 'Replace writable fields on a Google Calendar resource.',
    effect: 'write',
    inputSchema: updateCalendarInput,
    outputSchema: z.toJSONSchema(updateCalendarOutput, { io: 'output', unrepresentable: 'any' }),
  },
  patch_calendar: {
    description: 'Patch writable fields on a Google Calendar resource.',
    effect: 'write',
    inputSchema: patchCalendarInput,
    outputSchema: z.toJSONSchema(patchCalendarOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_calendar: {
    description: 'Delete a Google Calendar.',
    effect: 'destructive',
    inputSchema: deleteCalendarInput,
    outputSchema: z.toJSONSchema(deleteCalendarOutput, { io: 'output', unrepresentable: 'any' }),
  },
  clear_calendar: {
    description: 'Clear all events from a Google Calendar.',
    effect: 'write',
    inputSchema: clearCalendarInput,
    outputSchema: z.toJSONSchema(clearCalendarOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_events: {
    description: 'List events from a Google Calendar.',
    effect: 'read',
    inputSchema: listEventsInput,
    outputSchema: z.toJSONSchema(listEventsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_events_all_calendars: {
    description: 'List events across multiple Google Calendars and aggregate the result.',
    effect: 'read',
    inputSchema: listEventsAllCalendarsInput,
    outputSchema: z.toJSONSchema(listEventsAllCalendarsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_event: {
    description: 'Fetch one Google Calendar event.',
    effect: 'read',
    inputSchema: getEventInput,
    outputSchema: z.toJSONSchema(getEventOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_event: {
    description: 'Create a Google Calendar event.',
    effect: 'write',
    inputSchema: createEventInput,
    outputSchema: z.toJSONSchema(createEventOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_event: {
    description: 'Replace writable fields on a Google Calendar event.',
    effect: 'write',
    inputSchema: updateEventInput,
    outputSchema: z.toJSONSchema(updateEventOutput, { io: 'output', unrepresentable: 'any' }),
  },
  patch_event: {
    description: 'Patch writable fields on a Google Calendar event.',
    effect: 'write',
    inputSchema: patchEventInput,
    outputSchema: z.toJSONSchema(patchEventOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_event: {
    description: 'Delete a Google Calendar event.',
    effect: 'destructive',
    inputSchema: deleteEventInput,
    outputSchema: z.toJSONSchema(deleteEventOutput, { io: 'output', unrepresentable: 'any' }),
  },
  import_event: {
    description: 'Import an event into Google Calendar without conferenceData or attachments.',
    effect: 'write',
    inputSchema: importEventInput,
    outputSchema: z.toJSONSchema(importEventOutput, { io: 'output', unrepresentable: 'any' }),
  },
  move_event: {
    description: 'Move a Google Calendar event to another calendar.',
    effect: 'write',
    inputSchema: moveEventInput,
    outputSchema: z.toJSONSchema(moveEventOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_event_instances: {
    description: 'List instances of a recurring Google Calendar event.',
    effect: 'read',
    inputSchema: listEventInstancesInput,
    outputSchema: z.toJSONSchema(listEventInstancesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  quick_add_event: {
    description: 'Create a Google Calendar event with natural language text.',
    effect: 'write',
    inputSchema: quickAddEventInput,
    outputSchema: z.toJSONSchema(quickAddEventOutput, { io: 'output', unrepresentable: 'any' }),
  },
  sync_events: {
    description: 'Incrementally sync events from a Google Calendar.',
    effect: 'write',
    inputSchema: syncEventsInput,
    outputSchema: z.toJSONSchema(syncEventsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  free_busy_query: {
    description: 'Query busy intervals for calendars and groups.',
    effect: 'write',
    inputSchema: freeBusyQueryInput,
    outputSchema: z.toJSONSchema(freeBusyQueryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  find_free_slots: {
    description: 'Derive free slots from Google Calendar freeBusy data.',
    effect: 'read',
    inputSchema: findFreeSlotsInput,
    outputSchema: z.toJSONSchema(findFreeSlotsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_colors: {
    description: 'Fetch the Google Calendar colors resource.',
    effect: 'read',
    inputSchema: getColorsInput,
    outputSchema: z.toJSONSchema(getColorsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_settings: {
    description: 'List Google Calendar settings.',
    effect: 'read',
    inputSchema: listSettingsInput,
    outputSchema: z.toJSONSchema(listSettingsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_setting: {
    description: 'Fetch one Google Calendar setting.',
    effect: 'read',
    inputSchema: getSettingInput,
    outputSchema: z.toJSONSchema(getSettingOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_acl: {
    description: 'List ACL rules for a Google Calendar.',
    effect: 'read',
    inputSchema: listAclInput,
    outputSchema: z.toJSONSchema(listAclOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_acl_rule: {
    description: 'Fetch one ACL rule from a Google Calendar.',
    effect: 'read',
    inputSchema: getAclRuleInput,
    outputSchema: z.toJSONSchema(getAclRuleOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_acl_rule: {
    description: 'Create an ACL rule on a Google Calendar.',
    effect: 'write',
    inputSchema: createAclRuleInput,
    outputSchema: z.toJSONSchema(createAclRuleOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_acl_rule: {
    description: 'Replace writable fields on a Google Calendar ACL rule.',
    effect: 'write',
    inputSchema: updateAclRuleInput,
    outputSchema: z.toJSONSchema(updateAclRuleOutput, { io: 'output', unrepresentable: 'any' }),
  },
  patch_acl_rule: {
    description: 'Patch writable fields on a Google Calendar ACL rule.',
    effect: 'write',
    inputSchema: patchAclRuleInput,
    outputSchema: z.toJSONSchema(patchAclRuleOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_acl_rule: {
    description: 'Delete an ACL rule from a Google Calendar.',
    effect: 'destructive',
    inputSchema: deleteAclRuleInput,
    outputSchema: z.toJSONSchema(deleteAclRuleOutput, { io: 'output', unrepresentable: 'any' }),
  },
  find_event: {
    description: 'Search events in a Google Calendar using a query string.',
    effect: 'read',
    inputSchema: findEventInput,
    outputSchema: z.toJSONSchema(findEventOutput, { io: 'output', unrepresentable: 'any' }),
  },
  remove_attendee: {
    description: 'Remove one attendee email from a Google Calendar event.',
    effect: 'destructive',
    inputSchema: removeAttendeeInput,
    outputSchema: z.toJSONSchema(removeAttendeeOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
