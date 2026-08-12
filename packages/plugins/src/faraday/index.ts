/**
 * Faraday —— 从 open-connector 迁移的 provider(api_key,12 个 action,全部只读)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  getAccount,
  getCurrentAccount,
  getDataset,
  getScope,
  getTarget,
  getTrait,
  listAccounts,
  listDatasets,
  listScopes,
  listTargets,
  listTraits,
  listUsages,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { faradayActions } from './schema'

export type { ProviderEnv as Env }

export function createFaradayPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Faraday',
    actions: faradayActions,
    // 上游 credentialValidators 就是打 /accounts/current 试凭证,这里对应到同一个 action。
    credentialProbe: 'get_current_account',
    handlers: {
      get_current_account: getCurrentAccount,
      list_accounts: listAccounts,
      get_account: getAccount,
      list_scopes: listScopes,
      get_scope: getScope,
      list_datasets: listDatasets,
      get_dataset: getDataset,
      list_traits: listTraits,
      get_trait: getTrait,
      list_targets: listTargets,
      get_target: getTarget,
      list_usages: listUsages,
    },
  })
}

export default createFaradayPlugin()
