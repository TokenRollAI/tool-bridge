/**
 * StoreCensus —— 从 open-connector 迁移的 provider(4 个 action,全是只读查询)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  getWebsite,
  listAppCategories,
  listApps,
  searchStores,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { storecensusActions } from './schema'

export type { ProviderEnv as Env }

export function createStorecensusPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'StoreCensus',
    actions: storecensusActions,
    // 上游的 credentialValidator 打的就是 /app-categories,只读且入参为空对象。
    credentialProbe: 'list_app_categories',
    handlers: {
      get_website: getWebsite,
      search_stores: searchStores,
      list_apps: listApps,
      list_app_categories: listAppCategories,
    },
  })
}

export default createStorecensusPlugin()
