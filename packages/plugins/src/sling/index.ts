/**
 * Sling —— 从 open-connector 迁移的 provider(api_key,14 个只读 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  getCurrentSession,
  getCurrentShift,
  getDetailedShift,
  getGroup,
  getNextShift,
  getShift,
  getTask,
  getUser,
  listCalendarEvents,
  listGroups,
  listShiftCoworkers,
  listTasks,
  listUsers,
  listWorkingUsers,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { slingActions } from './schema'

export type { ProviderEnv as Env }

export function createSlingPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Sling',
    actions: slingActions,
    // 上游的 credentialValidators 打的就是 /account/session;它只读、无入参,原样当探针。
    credentialProbe: 'get_current_session',
    handlers: {
      get_current_session: getCurrentSession,
      list_users: listUsers,
      get_user: getUser,
      list_groups: listGroups,
      get_group: getGroup,
      list_calendar_events: listCalendarEvents,
      get_shift: getShift,
      get_detailed_shift: getDetailedShift,
      list_shift_coworkers: listShiftCoworkers,
      get_current_shift: getCurrentShift,
      get_next_shift: getNextShift,
      list_working_users: listWorkingUsers,
      list_tasks: listTasks,
      get_task: getTask,
    },
  })
}

export default createSlingPlugin()
