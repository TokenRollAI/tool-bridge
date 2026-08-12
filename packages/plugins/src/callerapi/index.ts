/**
 * CallerAPI —— 从 open-connector 迁移的 provider(api_key,2 个 action,全部只读)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { getPhoneNumberInformation, getUserInformation } from './api'
import { callerapiActions } from './schema'

export type { ProviderEnv as Env }

export function createCallerapiPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'CallerAPI',
    actions: callerapiActions,
    // 上游 credentialValidators 打的就是 /api/me,与 get_user_information 同一个接口,
    // 且它不消耗查询额度(lookup 才计费),适合当挂载时的探针。
    credentialProbe: 'get_user_information',
    handlers: {
      get_user_information: getUserInformation,
      get_phone_number_information: getPhoneNumberInformation,
    },
  })
}

export default createCallerapiPlugin()
