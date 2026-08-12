/**
 * Rootly —— 从 open-connector 迁移的 provider(api_key,5 个 action,全部只读)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { getCurrentUser, getIncident, listIncidents, listServices, listTeams } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { rootlyActions } from './schema'

export type { ProviderEnv as Env }

export function createRootlyPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Rootly',
    actions: rootlyActions,
    // 上游 credentialValidators 打的就是 /users/me,与 get_current_user 同一个接口。
    credentialProbe: 'get_current_user',
    handlers: {
      get_current_user: getCurrentUser,
      list_incidents: listIncidents,
      get_incident: getIncident,
      list_services: listServices,
      list_teams: listTeams,
    },
  })
}

export default createRootlyPlugin()
