/**
 * UptimeRobot —— 从 open-connector 迁移的 provider(api_key,7 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  createMonitor,
  deleteMonitor,
  getAccountDetails,
  getMonitor,
  listAlertContacts,
  listMonitors,
  updateMonitor,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { uptimerobotActions } from './schema'

export type { ProviderEnv as Env }

export function createUptimerobotPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'UptimeRobot',
    actions: uptimerobotActions,
    // 上游的 credentialValidators 就是打 getAccountDetails;它只读、无入参,原样当探针。
    credentialProbe: 'get_account_details',
    handlers: {
      get_account_details: getAccountDetails,
      list_alert_contacts: listAlertContacts,
      list_monitors: listMonitors,
      get_monitor: getMonitor,
      create_monitor: createMonitor,
      update_monitor: updateMonitor,
      delete_monitor: deleteMonitor,
    },
  })
}

export default createUptimerobotPlugin()
