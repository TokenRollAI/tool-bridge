/**
 * FraudLabs Pro —— 从 open-connector 迁移的 provider(api_key,3 个 action:订单反欺诈筛查)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 没有 credentialProbe:唯一的 read action `get_order_result` 必填 `id`(某笔真实交易号),
 * 挂载时拿不到一个"空转"调用。上游 credentialValidator 是拿假 id 去打,靠错误消息分辨
 * "key 无效"与"单号不存在" —— 那套判定太脆,不移植。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { feedbackOrder, getOrderResult, screenOrder } from './api'
import { fraudlabsproActions } from './schema'

export type { ProviderEnv as Env }

export function createFraudlabsproPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'FraudLabs Pro',
    actions: fraudlabsproActions,
    handlers: {
      screen_order: screenOrder,
      get_order_result: getOrderResult,
      feedback_order: feedbackOrder,
    },
  })
}

export default createFraudlabsproPlugin()
