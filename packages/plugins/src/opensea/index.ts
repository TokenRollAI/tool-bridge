/**
 * OpenSea —— 从 open-connector 迁移的 provider(9 个 action,全是只读查询)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  getBestNftListing,
  getBestNftOffer,
  getCollection,
  getCollectionStats,
  getNft,
  listCollectionNfts,
  listCollectionOffers,
  listCollectionTraits,
  search,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { openseaActions } from './schema'

export type { ProviderEnv as Env }

export function createOpenseaPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'OpenSea',
    actions: openseaActions,
    handlers: {
      search,
      get_collection: getCollection,
      get_collection_stats: getCollectionStats,
      list_collection_nfts: listCollectionNfts,
      list_collection_traits: listCollectionTraits,
      list_collection_offers: listCollectionOffers,
      get_best_nft_listing: getBestNftListing,
      get_best_nft_offer: getBestNftOffer,
      get_nft: getNft,
    },
  })
}

export default createOpenseaPlugin()
