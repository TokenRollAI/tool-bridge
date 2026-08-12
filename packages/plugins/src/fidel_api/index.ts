/**
 * Fidel API —— 从 open-connector 迁移的 provider(api_key,6 个只读 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { getBrand, getCard, getTransaction, listBrands, listCards, listTransactions } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { fidelApiActions } from './schema'

export type { ProviderEnv as Env }

export function createFidelApiPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Fidel API',
    actions: fidelApiActions,
    // 与上游 credentialValidators 打的是同一个端点(/brands):只读、无必填入参。
    credentialProbe: 'list_brands',
    handlers: {
      list_brands: listBrands,
      get_brand: getBrand,
      list_cards: listCards,
      get_card: getCard,
      list_transactions: listTransactions,
      get_transaction: getTransaction,
    },
  })
}

export default createFidelApiPlugin()
