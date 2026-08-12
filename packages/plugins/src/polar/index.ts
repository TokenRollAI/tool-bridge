/**
 * Polar —— 从 open-connector 迁移的 provider(13 个只读 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * credentialProbe 选 `list_organizations`:上游 credentialValidators 打的正是
 * `/organizations/?limit=1`,且它 effect 为 read、无必填入参 —— 三个条件都满足。
 */

import {
  getCustomer,
  getCustomerByExternalId,
  getCustomerState,
  getCustomerStateByExternalId,
  getOrder,
  getOrganization,
  getProduct,
  getSubscription,
  listCustomers,
  listOrders,
  listOrganizations,
  listProducts,
  listSubscriptions,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { polarActions } from './schema'

export type { ProviderEnv as Env }

export function createPolarPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Polar',
    actions: polarActions,
    credentialProbe: 'list_organizations',
    handlers: {
      list_organizations: listOrganizations,
      get_organization: getOrganization,
      list_products: listProducts,
      get_product: getProduct,
      list_customers: listCustomers,
      get_customer: getCustomer,
      get_customer_by_external_id: getCustomerByExternalId,
      get_customer_state: getCustomerState,
      get_customer_state_by_external_id: getCustomerStateByExternalId,
      list_orders: listOrders,
      get_order: getOrder,
      list_subscriptions: listSubscriptions,
      get_subscription: getSubscription,
    },
  })
}

export default createPolarPlugin()
