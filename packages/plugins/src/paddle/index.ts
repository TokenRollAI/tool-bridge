/**
 * Paddle —— 从 open-connector 迁移的 provider(api_key,12 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  createCustomer,
  createPrice,
  createProduct,
  getCustomer,
  getPrice,
  getProduct,
  listCustomers,
  listPrices,
  listProducts,
  updateCustomer,
  updatePrice,
  updateProduct,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { paddleActions } from './schema'

export type { ProviderEnv as Env }

export function createPaddlePlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Paddle',
    actions: paddleActions,
    // 上游 credentialValidators 打的就是 /products,与 list_products 同一个接口。
    credentialProbe: 'list_products',
    handlers: {
      list_products: listProducts,
      get_product: getProduct,
      create_product: createProduct,
      update_product: updateProduct,
      list_prices: listPrices,
      get_price: getPrice,
      create_price: createPrice,
      update_price: updatePrice,
      list_customers: listCustomers,
      get_customer: getCustomer,
      create_customer: createCustomer,
      update_customer: updateCustomer,
    },
  })
}

export default createPaddlePlugin()
