/**
 * Recharge —— 从 open-connector 迁移的 provider(api_key,10 个只读 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  getCharge,
  getCustomer,
  getOrder,
  getProduct,
  getSubscription,
  listCharges,
  listCustomers,
  listOrders,
  listProducts,
  listSubscriptions,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { rechargeActions } from './schema'

export type { ProviderEnv as Env }

export function createRechargePlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Recharge',
    actions: rechargeActions,
    // 上游的 credentialValidators 打的是 `/`(token 信息),但那不对应任何 action。
    // list_products 是只读、无必填入参里最轻的一个,拿它当探针。
    credentialProbe: 'list_products',
    handlers: {
      list_customers: listCustomers,
      get_customer: getCustomer,
      list_subscriptions: listSubscriptions,
      get_subscription: getSubscription,
      list_orders: listOrders,
      get_order: getOrder,
      list_charges: listCharges,
      get_charge: getCharge,
      list_products: listProducts,
      get_product: getProduct,
    },
  })
}

export default createRechargePlugin()
