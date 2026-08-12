/**
 * Statamic —— 从 open-connector 迁移的 provider(api_key,4 个 action,围绕 Sites API)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { createSite, deleteSite, listSites, updateSite } from './api'
import { statamicActions } from './schema'

export type { ProviderEnv as Env }

export function createStatamicPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Statamic',
    actions: statamicActions,
    // 上游的 credentialValidators 就打 /sites;list_sites 是它的同一个调用。
    credentialProbe: 'list_sites',
    handlers: {
      list_sites: listSites,
      create_site: createSite,
      update_site: updateSite,
      delete_site: deleteSite,
    },
  })
}

export default createStatamicPlugin()
