/**
 * IPQualityScore —— 从 open-connector 迁移的 provider(4 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  checkIpReputation,
  scanUrl,
  validateEmail,
  validatePhone,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { ipqualityscoreActions } from './schema'

export type { ProviderEnv as Env }

export function createIpqualityscorePlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'IPQualityScore',
    actions: ipqualityscoreActions,
    handlers: {
      check_ip_reputation: checkIpReputation,
      validate_email: validateEmail,
      validate_phone: validatePhone,
      scan_url: scanUrl,
    },
  })
}

export default createIpqualityscorePlugin()
