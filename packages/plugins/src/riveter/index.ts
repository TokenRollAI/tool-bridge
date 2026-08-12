/**
 * Riveter —— 从 open-connector 迁移的 provider(api_key,2 个 action:账户信息 + 网页抓取)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { getAccount, scrape } from './api'
import { riveterActions } from './schema'

export type { ProviderEnv as Env }

export function createRiveterPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Riveter',
    actions: riveterActions,
    // 上游 credentialValidator 也是打 /account 试凭证:只读、无入参、不消耗抓取额度。
    credentialProbe: 'get_account',
    handlers: {
      get_account: getAccount,
      scrape,
    },
  })
}

export default createRiveterPlugin()
