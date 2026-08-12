/**
 * RealPhoneValidation —— 从 open-connector 迁移的 provider(api_key,2 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 不设 credentialProbe:两个 action 的 effect 都是 write(每次校验都消耗配额),
 * 上游 credentialValidators 是拿一个写死的号码去打 Turbo —— 那属于计费调用,
 * 不适合在挂载时替租户空转一次。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { validatePhoneStandard, validatePhoneV3 } from './api'
import { realphonevalidationActions } from './schema'

export type { ProviderEnv as Env }

export function createRealphonevalidationPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'RealPhoneValidation',
    actions: realphonevalidationActions,
    handlers: {
      validate_phone_standard: validatePhoneStandard,
      validate_phone_v3: validatePhoneV3,
    },
  })
}

export default createRealphonevalidationPlugin()
