/**
 * Google Calendar —— 从 open-connector 迁移的 provider(37 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api/` 下是人工改写的业务逻辑
 * (按上游分组切成 calendars / events / aggregate / freebusy / misc 五个模块),
 * 本文件把规格表与 handler 表对起来(键集合不吻合会在装配期炸)。
 *
 * ## 凭证走平台托管的 OAuth2
 *
 * 端点、scope 与两个授权参数逐字对应上游 `definition.ts` 的 `auth[0]`。两个
 * `authorizationParams` **必须带**:
 * - `access_type=offline` —— Google **只在**它出现时下发 refresh_token,缺了它令牌一小时
 *   后过期就再也刷不回来,用户得重新走一遍授权。
 * - `prompt=consent` —— 用户第二次授权同一个应用时 Google 默认不再下发 refresh_token
 *   (它认为你已经存过了),显式要求同意页可以保证每次都重新下发。
 *
 * `clientAuth: 'client_secret_post'` 与上游 `tokenEndpointAuthMethod` 一致(也是缺省值,
 * 写出来是为了让这份声明自解释)。
 *
 * 声明了 `oauth` 就**不能**再声明 `credentialProbe` 或 `credentialFields`(SDK 当场拒):
 * oauth 模式下 authRef 指向的 secret 固定存 clientId/clientSecret,字段表由平台定。
 * 因此上游的 `credentialValidators`(打 `/oauth2/v3/userinfo`,失败退回打 calendarList)
 * 在这里没有落点 —— 令牌可用性由平台的授权流与刷新逻辑负责。
 */

import {
  addCalendarToList,
  clearCalendar,
  createCalendar,
  deleteCalendar,
  getCalendar,
  getCalendarListEntry,
  listCalendars,
  patchCalendar,
  patchCalendarListEntry,
  removeCalendarFromList,
  updateCalendar,
  updateCalendarListEntry,
} from './api/calendars'
import {
  createEvent,
  deleteEvent,
  findEvent,
  getEvent,
  importEvent,
  listEventInstances,
  listEvents,
  moveEvent,
  patchEvent,
  quickAddEvent,
  removeAttendee,
  syncEvents,
  updateEvent,
} from './api/events'
import {
  createAclRule,
  deleteAclRule,
  getAclRule,
  getColors,
  getSetting,
  listAcl,
  listSettings,
  patchAclRule,
  updateAclRule,
} from './api/misc'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { findFreeSlots, freeBusyQuery } from './api/freebusy'
import { listEventsAllCalendars } from './api/aggregate'
import { googlecalendarActions } from './schema'

export type { ProviderEnv as Env }

export function createGooglecalendarPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Google Calendar',
    oauth: {
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/calendar.calendars',
        'https://www.googleapis.com/auth/calendar.calendarlist',
        'https://www.googleapis.com/auth/calendar.settings.readonly',
        'https://www.googleapis.com/auth/calendar.acls',
        'https://www.googleapis.com/auth/calendar.acls.readonly',
      ],
      clientAuth: 'client_secret_post',
      authorizationParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
    actions: googlecalendarActions,
    handlers: {
      list_calendars: listCalendars,
      get_calendar_list_entry: getCalendarListEntry,
      add_calendar_to_list: addCalendarToList,
      update_calendar_list_entry: updateCalendarListEntry,
      patch_calendar_list_entry: patchCalendarListEntry,
      remove_calendar_from_list: removeCalendarFromList,
      get_calendar: getCalendar,
      create_calendar: createCalendar,
      update_calendar: updateCalendar,
      patch_calendar: patchCalendar,
      delete_calendar: deleteCalendar,
      clear_calendar: clearCalendar,
      list_events: listEvents,
      list_events_all_calendars: listEventsAllCalendars,
      get_event: getEvent,
      create_event: createEvent,
      update_event: updateEvent,
      patch_event: patchEvent,
      delete_event: deleteEvent,
      import_event: importEvent,
      move_event: moveEvent,
      list_event_instances: listEventInstances,
      quick_add_event: quickAddEvent,
      sync_events: syncEvents,
      free_busy_query: freeBusyQuery,
      find_free_slots: findFreeSlots,
      get_colors: getColors,
      list_settings: listSettings,
      get_setting: getSetting,
      list_acl: listAcl,
      get_acl_rule: getAclRule,
      create_acl_rule: createAclRule,
      update_acl_rule: updateAclRule,
      patch_acl_rule: patchAclRule,
      delete_acl_rule: deleteAclRule,
      find_event: findEvent,
      remove_attendee: removeAttendee,
    },
  })
}

export default createGooglecalendarPlugin()
