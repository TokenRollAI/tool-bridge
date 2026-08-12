/**
 * Lob —— 从 open-connector 迁移的 provider(api_key,5 个 action,全部围绕地址校验)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * **不声明 credentialProbe**:上游 `credentialValidators` 打的是 `/addresses?limit=1`,
 * 而这个 provider 没有把它开成 action;剩下 5 个 action 全是 effect:'write' 的校验调用
 * (会计费),不适合挂载时空转。
 */

import {
  autocompleteUsAddresses,
  bulkVerifyInternationalAddresses,
  bulkVerifyUsAddresses,
  verifyInternationalAddress,
  verifyUsAddress,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { lobActions } from './schema'

export type { ProviderEnv as Env }

export function createLobPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Lob',
    actions: lobActions,
    handlers: {
      verify_us_address: verifyUsAddress,
      bulk_verify_us_addresses: bulkVerifyUsAddresses,
      autocomplete_us_addresses: autocompleteUsAddresses,
      verify_international_address: verifyInternationalAddress,
      bulk_verify_international_addresses: bulkVerifyInternationalAddresses,
    },
  })
}

export default createLobPlugin()
