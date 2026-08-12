/**
 * Resend —— 从 open-connector 迁移的 provider(首批样本之一)。
 *
 * 这个 provider 走的是**手写豁免**路径:它的 inputSchema 带 Zod 无法反推的组合约束,
 * schema 由人写在 `schema.handwritten.ts`,`handwritten.json` 登记豁免理由。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { resendActions } from './schema'
import { sendEmail } from './api'

export type { ProviderEnv as Env }

export function createResendPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Resend',
    actions: resendActions,
    handlers: { send_email: sendEmail },
  })
}

export default createResendPlugin()
