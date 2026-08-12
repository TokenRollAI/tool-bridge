/**
 * Gumroad —— 从 open-connector 迁移的 provider(api_key,9 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  getCurrentUser,
  getProduct,
  getSale,
  listProducts,
  listProductSubscribers,
  listSales,
  markSaleAsShipped,
  refundSale,
  resendSaleReceipt,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { gumroadActions } from './schema'

export type { ProviderEnv as Env }

export function createGumroadPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Gumroad',
    actions: gumroadActions,
    // 上游 credentialValidators 打的就是 /user,与 get_current_user 同一个接口。
    credentialProbe: 'get_current_user',
    handlers: {
      get_current_user: getCurrentUser,
      list_products: listProducts,
      get_product: getProduct,
      list_sales: listSales,
      get_sale: getSale,
      list_product_subscribers: listProductSubscribers,
      mark_sale_as_shipped: markSaleAsShipped,
      refund_sale: refundSale,
      resend_sale_receipt: resendSaleReceipt,
    },
  })
}

export default createGumroadPlugin()
