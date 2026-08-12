/**
 * Bookingmood —— 从 open-connector 迁移的 provider(api_key,3 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { listBookings, listProducts, queryAvailability } from './api'
import { bookingmoodActions } from './schema'

export type { ProviderEnv as Env }

export function createBookingmoodPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Bookingmood',
    actions: bookingmoodActions,
    // 上游 credentialValidators 就是打 /products?select=id,name&limit=1;list_products
    // 是这里唯一只读且无必填入参的 action,正好当挂载时的探针。
    credentialProbe: 'list_products',
    handlers: {
      list_products: listProducts,
      list_bookings: listBookings,
      query_availability: queryAvailability,
    },
  })
}

export default createBookingmoodPlugin()
