/**
 * FireHydrant —— 从 open-connector 迁移的 provider(api_key,7 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  createIncident,
  getEnvironment,
  getIncident,
  getService,
  listEnvironments,
  listIncidents,
  listServices,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { firehydrantActions } from './schema'

export type { ProviderEnv as Env }

export function createFirehydrantPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'FireHydrant',
    actions: firehydrantActions,
    // 上游 credentialValidators 打 /incidents?per_page=1 验凭证;这里对应 list_incidents。
    credentialProbe: 'list_incidents',
    handlers: {
      list_incidents: listIncidents,
      get_incident: getIncident,
      create_incident: createIncident,
      list_services: listServices,
      get_service: getService,
      list_environments: listEnvironments,
      get_environment: getEnvironment,
    },
  })
}

export default createFirehydrantPlugin()
