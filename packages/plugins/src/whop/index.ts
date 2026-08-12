/**
 * Whop —— 从 open-connector 迁移的 provider(api_key,8 个 action,全部只读)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  getAuthorizedUser,
  getCompany,
  getMembership,
  getProduct,
  listAuthorizedUsers,
  listCompanies,
  listMemberships,
  listProducts,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { whopActions } from './schema'

export type { ProviderEnv as Env }

export function createWhopPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Whop',
    actions: whopActions,
    // 上游 credentialValidators 打的就是 /companies?first=1;list_companies 只读且无必填入参。
    credentialProbe: 'list_companies',
    handlers: {
      list_companies: listCompanies,
      get_company: getCompany,
      list_products: listProducts,
      get_product: getProduct,
      list_memberships: listMemberships,
      get_membership: getMembership,
      list_authorized_users: listAuthorizedUsers,
      get_authorized_user: getAuthorizedUser,
    },
  })
}

export default createWhopPlugin()
