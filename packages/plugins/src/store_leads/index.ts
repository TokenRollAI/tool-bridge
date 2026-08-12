/**
 * Store Leads —— 从 open-connector 迁移的 provider(api_key,6 个 action,全部只读)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { getApp, getDomain, getTechnology, listApps, listDomains, listTechnologies } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { storeLeadsActions } from './schema'

export type { ProviderEnv as Env }

export function createStoreLeadsPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Store Leads',
    actions: storeLeadsActions,
    // 上游 credentialValidators 打的就是 /app?page_size=1,与 list_apps 同一个接口。
    credentialProbe: 'list_apps',
    handlers: {
      get_domain: getDomain,
      list_domains: listDomains,
      get_app: getApp,
      list_apps: listApps,
      get_technology: getTechnology,
      list_technologies: listTechnologies,
    },
  })
}

export default createStoreLeadsPlugin()
