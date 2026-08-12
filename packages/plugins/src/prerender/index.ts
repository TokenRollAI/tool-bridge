/**
 * Prerender —— 从 open-connector 迁移的 provider(api_key,4 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { addSitemap, clearCache, getCacheClearStatus, recacheUrls } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { prerenderActions } from './schema'

export type { ProviderEnv as Env }

export function createPrerenderPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Prerender',
    actions: prerenderActions,
    // 上游 credentialValidators 就是打 /cache-clear-status/<token> 试凭证,
    // 它也是这里唯一只读、无必填入参的 action。
    credentialProbe: 'get_cache_clear_status',
    handlers: {
      recache_urls: recacheUrls,
      add_sitemap: addSitemap,
      clear_cache: clearCache,
      get_cache_clear_status: getCacheClearStatus,
    },
  })
}

export default createPrerenderPlugin()
