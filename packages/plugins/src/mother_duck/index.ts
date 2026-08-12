/**
 * MotherDuck —— 从 open-connector 迁移的 provider(api_key,8 个 action,Admin API)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  createToken,
  createUser,
  deleteToken,
  deleteUser,
  getUserDucklingConfig,
  listActiveAccounts,
  listTokens,
  setUserDucklingConfig,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { motherDuckActions } from './schema'

export type { ProviderEnv as Env }

export function createMotherDuckPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'MotherDuck',
    actions: motherDuckActions,
    // 上游 credentialValidators 就是打 /v1/active_accounts 试凭证,这里对应到同一个 action。
    credentialProbe: 'list_active_accounts',
    handlers: {
      list_active_accounts: listActiveAccounts,
      create_user: createUser,
      delete_user: deleteUser,
      list_tokens: listTokens,
      create_token: createToken,
      delete_token: deleteToken,
      get_user_duckling_config: getUserDucklingConfig,
      set_user_duckling_config: setUserDucklingConfig,
    },
  })
}

export default createMotherDuckPlugin()
