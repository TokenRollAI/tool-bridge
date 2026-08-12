/**
 * Metabase —— 从 open-connector 迁移的 provider(api_key + 自建实例地址,10 个只读 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 没有声明 `credentialFields`:凭证就是一个 API key,上游 `extraFields.instanceUrl`
 * 是非密钥配置,落在挂载的 `providerConfig`(见 `api.ts` 顶部注释)。
 *
 * `credentialProbe: 'get_current_user'` —— 上游 `credentialValidators.apiKey` 打的正是
 * `/api/user/current`,而它 `effect: 'read'`、零必填入参,三个条件都满足。自建实例这类
 * provider 尤其需要探针:instanceUrl 与 API key 都可能配错,不探就要等第一次业务调用才发现。
 */

import {
  getCard,
  getCollection,
  getCurrentUser,
  getDashboard,
  getDatabase,
  listCards,
  listCollections,
  listDashboards,
  listDatabases,
  search,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { metabaseActions } from './schema'

export type { ProviderEnv as Env }

export function createMetabasePlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Metabase',
    actions: metabaseActions,
    credentialProbe: 'get_current_user',
    handlers: {
      get_current_user: getCurrentUser,
      list_databases: listDatabases,
      get_database: getDatabase,
      list_collections: listCollections,
      get_collection: getCollection,
      list_cards: listCards,
      get_card: getCard,
      list_dashboards: listDashboards,
      get_dashboard: getDashboard,
      search,
    },
  })
}

export default createMetabasePlugin()
