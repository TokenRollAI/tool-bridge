/**
 * Cincopa —— 从 open-connector 迁移的 provider(api_key,4 个只读 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { listAssets, listAssetTags, listGalleries, listGalleryItems } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { cincopaActions } from './schema'

export type { ProviderEnv as Env }

export function createCincopaPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Cincopa',
    actions: cincopaActions,
    // 上游用 /ping.json 验凭证,但那个端点没有对应的 action;list_asset_tags 是最便宜的
    // 只读、无必填入参的替代(只回一张 tag → 数量的表)。
    credentialProbe: 'list_asset_tags',
    handlers: {
      list_galleries: listGalleries,
      list_gallery_items: listGalleryItems,
      list_assets: listAssets,
      list_asset_tags: listAssetTags,
    },
  })
}

export default createCincopaPlugin()
