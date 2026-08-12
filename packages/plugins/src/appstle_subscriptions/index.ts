/**
 * Appstle Subscriptions —— 从 open-connector 迁移的 provider(4 个 action,全是只读查询)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  getCustomerWithSubscriptions,
  getValidSubscriptionContractIds,
  listCustomerSubscriptionDetails,
  listCustomersWithSubscriptions,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { appstleSubscriptionsActions } from './schema'

export type { ProviderEnv as Env }

export function createAppstleSubscriptionsPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Appstle Subscriptions',
    actions: appstleSubscriptionsActions,
    // 上游的 credentialValidator 打的就是这个端点(page=0&size=1),只读且无必填入参。
    credentialProbe: 'list_customers_with_subscriptions',
    handlers: {
      list_customers_with_subscriptions: listCustomersWithSubscriptions,
      get_customer_with_subscriptions: getCustomerWithSubscriptions,
      get_valid_subscription_contract_ids: getValidSubscriptionContractIds,
      list_customer_subscription_details: listCustomerSubscriptionDetails,
    },
  })
}

export default createAppstleSubscriptionsPlugin()
