/**
 * Loyverse —— 从 open-connector 迁移的 provider(api_key,11 个只读 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  getCategory,
  getCustomer,
  getItem,
  getMerchant,
  getReceipt,
  getStore,
  listCategories,
  listCustomers,
  listItems,
  listReceipts,
  listStores,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { loyverseActions } from './schema'

export type { ProviderEnv as Env }

export function createLoyversePlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Loyverse',
    actions: loyverseActions,
    // 上游 credentialValidators 也是打 /merchant/ 验凭证:只读、无入参,直接沿用。
    credentialProbe: 'get_merchant',
    handlers: {
      get_merchant: getMerchant,
      list_stores: listStores,
      get_store: getStore,
      list_items: listItems,
      get_item: getItem,
      list_categories: listCategories,
      get_category: getCategory,
      list_customers: listCustomers,
      get_customer: getCustomer,
      list_receipts: listReceipts,
      get_receipt: getReceipt,
    },
  })
}

export default createLoyversePlugin()
