/**
 * Brave Search —— 从 open-connector 迁移的 provider(4 个 search action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { imageSearch, newsSearch, videoSearch, webSearch } from './api'
import { braveSearchActions } from './schema'

export type { ProviderEnv as Env }

export function createBraveSearchPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Brave Search',
    actions: braveSearchActions,
    handlers: {
      web_search: webSearch,
      news_search: newsSearch,
      video_search: videoSearch,
      image_search: imageSearch,
    },
  })
}

export default createBraveSearchPlugin()
