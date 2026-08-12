/**
 * Umami —— 从 open-connector 迁移的 provider(8 个 action,全是只读查询)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * `credentialProbe: 'get_current_user'` —— 它 effect 为 read、入参是空对象,满足探针的
 * 三个条件。上游的 `credentialValidators` 打的是 `POST /api/auth/verify`,那个端点没有
 * 对应的 action,而 `GET /api/me` 同样能判定 key 是否有效,且它已经是注册过的工具名。
 */

import {
  getCurrentUser,
  getMetrics,
  getPageviews,
  getRealtime,
  getWebsite,
  getWebsiteStats,
  listEvents,
  listWebsites,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { umamiActions } from './schema'

export type { ProviderEnv as Env }

export function createUmamiPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Umami',
    actions: umamiActions,
    credentialProbe: 'get_current_user',
    handlers: {
      get_current_user: getCurrentUser,
      list_websites: listWebsites,
      get_website: getWebsite,
      get_website_stats: getWebsiteStats,
      get_pageviews: getPageviews,
      get_metrics: getMetrics,
      get_realtime: getRealtime,
      list_events: listEvents,
    },
  })
}

export default createUmamiPlugin()
