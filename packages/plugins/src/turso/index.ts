/**
 * Turso —— 从 open-connector 迁移的 provider(api_key,10 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  createDatabase,
  createGroup,
  deleteDatabase,
  getDatabase,
  getGroup,
  getOrganization,
  listDatabases,
  listGroups,
  listLocations,
  listOrganizations,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { tursoActions } from './schema'

export type { ProviderEnv as Env }

export function createTursoPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Turso',
    actions: tursoActions,
    // 上游 credentialValidators 打的 `/v1/auth/validate` 没有对应 action;`list_organizations`
    // 同样只读、无必填入参,且同样要求 Platform token 有效,拿它当挂载时的凭证探针。
    credentialProbe: 'list_organizations',
    handlers: {
      list_organizations: listOrganizations,
      get_organization: getOrganization,
      list_locations: listLocations,
      list_groups: listGroups,
      get_group: getGroup,
      create_group: createGroup,
      list_databases: listDatabases,
      get_database: getDatabase,
      create_database: createDatabase,
      delete_database: deleteDatabase,
    },
  })
}

export default createTursoPlugin()
