/**
 * Brandfetch —— 从 open-connector 迁移的 provider(api_key,2 个只读 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 没有 credentialProbe:两个 action 都要必填业务入参(品牌标识 / 交易标签),
 * 挂载时拿不到一个"空转"调用。上游 credentialValidator 是拿硬编码的 `brandfetch.com`
 * 去打 —— 那会替租户消耗一次真实查询配额,不移植。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { getBrand, getTransactionInfo } from './api'
import { brandfetchActions } from './schema'

export type { ProviderEnv as Env }

export function createBrandfetchPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Brandfetch',
    actions: brandfetchActions,
    handlers: {
      get_brand: getBrand,
      get_transaction_info: getTransactionInfo,
    },
  })
}

export default createBrandfetchPlugin()
