/**
 * Stripe —— 从 open-connector 迁移的 provider(首批样本之一,18 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  createCustomer,
  createPrice,
  createProduct,
  deleteCustomer,
  deleteProduct,
  getCustomer,
  getPrice,
  getProduct,
  identifyAccount,
  listCustomers,
  listPrices,
  listProducts,
  searchCustomers,
  searchPrices,
  searchProducts,
  updateCustomer,
  updatePrice,
  updateProduct,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { stripeActions } from './schema'

export type { ProviderEnv as Env }

export function createStripePlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Stripe',
    actions: stripeActions,
    handlers: {
      identify_account: identifyAccount,
      create_customer: createCustomer,
      update_customer: updateCustomer,
      get_customer: getCustomer,
      list_customers: listCustomers,
      search_customers: searchCustomers,
      delete_customer: deleteCustomer,
      create_product: createProduct,
      update_product: updateProduct,
      get_product: getProduct,
      list_products: listProducts,
      search_products: searchProducts,
      delete_product: deleteProduct,
      create_price: createPrice,
      update_price: updatePrice,
      get_price: getPrice,
      list_prices: listPrices,
      search_prices: searchPrices,
    },
  })
}

export default createStripePlugin()
