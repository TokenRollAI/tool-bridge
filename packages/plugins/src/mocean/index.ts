/**
 * Mocean —— 从 open-connector 迁移的 provider(api_key,5 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { getBalance, getMessageStatus, listPricing, lookupNumber, sendSms } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { moceanActions } from './schema'

export type { ProviderEnv as Env }

export function createMoceanPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Mocean',
    actions: moceanActions,
    // 上游 credentialValidators 打的就是 /account/balance;get_balance 只读、无必填入参。
    credentialProbe: 'get_balance',
    handlers: {
      get_balance: getBalance,
      list_pricing: listPricing,
      get_message_status: getMessageStatus,
      lookup_number: lookupNumber,
      send_sms: sendSms,
    },
  })
}

export default createMoceanPlugin()
