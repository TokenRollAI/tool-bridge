/**
 * Zorus —— 从 open-connector 迁移的 provider(api_key,5 个 action,全部是只读搜索)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  searchActiveUnblockRequests,
  searchCustomers,
  searchEndpoints,
  searchGroups,
  searchPolicies,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { zorusActions } from './schema'

export type { ProviderEnv as Env }

export function createZorusPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Zorus',
    actions: zorusActions,
    // 上游 credentialValidators 打的就是 /api/customers/search;search_customers 只读、
    // 无必填入参(分页参数全可选)。
    credentialProbe: 'search_customers',
    handlers: {
      search_customers: searchCustomers,
      search_endpoints: searchEndpoints,
      search_groups: searchGroups,
      search_policies: searchPolicies,
      search_active_unblock_requests: searchActiveUnblockRequests,
    },
  })
}

export default createZorusPlugin()
