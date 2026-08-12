/**
 * OpenSea 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const searchInput = z.strictObject({
  query: z.string().min(1).describe('Search query text.'),
  chains: z.array(z.string().min(1).describe('The blockchain identifier used by OpenSea, such as ethereum, polygon, or base.')).min(1).describe('Blockchain identifiers used to filter search results.').optional(),
  assetTypes: z.array(z.enum(['collection', 'nft', 'token', 'account']).describe('OpenSea asset type filter for search results.')).min(1).describe('Asset type filters. OpenSea defaults to collection and token when omitted.').optional(),
  limit: z.int().min(1).max(50).describe('Number of search results to return.').optional(),
}).describe('Input parameters for searching OpenSea.')

export const searchOutput = z.strictObject({
  results: z.array(z.looseObject({}).describe('The raw object returned by OpenSea.')).describe('Raw ranked search results returned by OpenSea.').optional(),
  raw: z.looseObject({}).describe('The raw object returned by OpenSea.').optional(),
}).describe('Search results returned by OpenSea.')

export const getCollectionInput = z.strictObject({
  slug: z.string().min(1).describe('The unique OpenSea collection slug.'),
}).describe('Input parameters for retrieving one OpenSea collection.')

export const getCollectionOutput = z.strictObject({
  collection: z.strictObject({
    slug: z.string().describe('The OpenSea collection slug.').nullable().optional(),
    name: z.string().describe('The collection display name.').nullable().optional(),
    description: z.string().describe('The collection description.').nullable().optional(),
    imageUrl: z.string().describe('The collection image URL.').nullable().optional(),
    bannerImageUrl: z.string().describe('The collection banner image URL.').nullable().optional(),
    owner: z.string().describe('The collection owner address when returned by OpenSea.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw object returned by OpenSea.').optional(),
  }).describe('A normalized OpenSea collection summary.').optional(),
}).describe('Collection details returned by OpenSea.')

export const getCollectionStatsInput = z.strictObject({
  slug: z.string().min(1).describe('The unique OpenSea collection slug.'),
}).describe('Input parameters for retrieving OpenSea collection statistics.')

export const getCollectionStatsOutput = z.strictObject({
  stats: z.looseObject({
    total: z.looseObject({
      volume: z.number().describe('Total trading volume.').optional(),
      sales: z.int().describe('Total sales count.').optional(),
      num_owners: z.int().describe('Total number of owners.').optional(),
      floor_price: z.number().describe('Current floor price.').optional(),
      floor_price_symbol: z.string().describe('Symbol for the floor price currency.').optional(),
    }).describe('Total collection statistics returned by OpenSea.').optional(),
    intervals: z.array(z.looseObject({
      interval: z.string().describe('The interval label returned by OpenSea.').optional(),
      volume: z.number().describe('The trading volume for the interval.').optional(),
      sales: z.int().describe('The sales count for the interval.').optional(),
    }).describe('One interval statistic returned for an OpenSea collection.')).describe('Interval statistics for the collection.').optional(),
  }).describe('Collection statistics returned by OpenSea.').optional(),
}).describe('Collection statistics returned by OpenSea.')

export const listCollectionNftsInput = z.strictObject({
  slug: z.string().min(1).describe('The unique OpenSea collection slug.'),
  traits: z.array(z.strictObject({
    traitType: z.string().min(1).describe('The trait category name.').optional(),
    value: z.string().min(1).describe('The trait value to match.').optional(),
  }).describe('One OpenSea trait filter for collection NFT searches.')).min(1).describe('Trait filters to AND-combine for returned NFTs.').optional(),
  hasAgentBinding: z.boolean().describe('Filter to NFTs that have an ERC-8217 agent binding.').optional(),
  limit: z.int().min(1).max(200).describe('Number of items to return per page.').optional(),
  next: z.string().min(1).describe('The OpenSea pagination cursor from the previous response.').optional(),
}).describe('Input parameters for listing NFTs in an OpenSea collection.')

export const listCollectionNftsOutput = z.strictObject({
  nfts: z.array(z.strictObject({
    identifier: z.string().describe('The NFT token identifier.').nullable().optional(),
    name: z.string().describe('The NFT display name.').nullable().optional(),
    description: z.string().describe('The NFT description.').nullable().optional(),
    imageUrl: z.string().describe('The NFT image URL.').nullable().optional(),
    collection: z.string().describe('The collection slug associated with the NFT.').nullable().optional(),
    contract: z.string().describe('The NFT contract address.').nullable().optional(),
    chain: z.string().describe('The blockchain identifier associated with the NFT.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw object returned by OpenSea.').optional(),
  }).describe('A normalized OpenSea NFT summary.')).describe('Normalized OpenSea NFT summaries.').optional(),
  pagination: z.strictObject({
    next: z.string().describe('The cursor for the next page when one is available.').nullable().optional(),
    previous: z.string().describe('The cursor for the previous page when one is available.').nullable().optional(),
  }).describe('Pagination cursors returned by OpenSea.').optional(),
  raw: z.looseObject({}).describe('The raw object returned by OpenSea.').optional(),
}).describe('NFTs returned for an OpenSea collection.')

export const listCollectionTraitsInput = z.strictObject({
  slug: z.string().min(1).describe('The unique OpenSea collection slug.'),
}).describe('Input parameters for listing OpenSea collection traits.')

export const listCollectionTraitsOutput = z.strictObject({
  traits: z.looseObject({
    categories: z.record(z.string(), z.string().describe('The OpenSea trait data type.')).describe('Trait category names mapped to their OpenSea data type.').optional(),
    counts: z.record(z.string(), z.looseObject({}).describe('The raw object returned by OpenSea.')).describe('Trait category names mapped to value counts or numeric range metadata.').optional(),
  }).describe('Collection trait metadata returned by OpenSea.').optional(),
}).describe('Collection trait metadata returned by OpenSea.')

export const listCollectionOffersInput = z.strictObject({
  slug: z.string().min(1).describe('The unique OpenSea collection slug.'),
  limit: z.int().min(1).max(200).describe('Number of items to return per page.').optional(),
  next: z.string().min(1).describe('The OpenSea pagination cursor from the previous response.').optional(),
}).describe('Input parameters for listing OpenSea collection offers.')

export const listCollectionOffersOutput = z.strictObject({
  offers: z.array(z.strictObject({
    orderHash: z.string().describe('The OpenSea order hash.').nullable().optional(),
    type: z.string().describe('The order type returned by OpenSea.').nullable().optional(),
    price: z.string().describe('The current order price when returned by OpenSea.').nullable().optional(),
    currency: z.string().describe('The order currency symbol when returned by OpenSea.').nullable().optional(),
    maker: z.string().describe('The maker address when returned by OpenSea.').nullable().optional(),
    taker: z.string().describe('The taker address when returned by OpenSea.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw object returned by OpenSea.').optional(),
  }).describe('A normalized OpenSea marketplace order.')).describe('Normalized OpenSea offers.').optional(),
  pagination: z.strictObject({
    next: z.string().describe('The cursor for the next page when one is available.').nullable().optional(),
    previous: z.string().describe('The cursor for the previous page when one is available.').nullable().optional(),
  }).describe('Pagination cursors returned by OpenSea.').optional(),
  raw: z.looseObject({}).describe('The raw object returned by OpenSea.').optional(),
}).describe('Collection offers returned by OpenSea.')

export const getBestNftListingInput = z.strictObject({
  slug: z.string().min(1).describe('The unique OpenSea collection slug.'),
  identifier: z.string().min(1).describe('The NFT token identifier.'),
  includePrivateListings: z.boolean().describe('Whether OpenSea should include private listings.').optional(),
}).describe('Input parameters for retrieving the best listing for an NFT.')

export const getBestNftListingOutput = z.strictObject({
  listing: z.strictObject({
    orderHash: z.string().describe('The OpenSea order hash.').nullable().optional(),
    type: z.string().describe('The order type returned by OpenSea.').nullable().optional(),
    price: z.string().describe('The current order price when returned by OpenSea.').nullable().optional(),
    currency: z.string().describe('The order currency symbol when returned by OpenSea.').nullable().optional(),
    maker: z.string().describe('The maker address when returned by OpenSea.').nullable().optional(),
    taker: z.string().describe('The taker address when returned by OpenSea.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw object returned by OpenSea.').optional(),
  }).describe('A normalized OpenSea marketplace order.').optional(),
}).describe('Best NFT listing returned by OpenSea.')

export const getBestNftOfferInput = z.strictObject({
  slug: z.string().min(1).describe('The unique OpenSea collection slug.'),
  identifier: z.string().min(1).describe('The NFT token identifier.'),
}).describe('Input parameters for retrieving the best offer for an NFT.')

export const getBestNftOfferOutput = z.strictObject({
  offer: z.strictObject({
    orderHash: z.string().describe('The OpenSea order hash.').nullable().optional(),
    type: z.string().describe('The order type returned by OpenSea.').nullable().optional(),
    price: z.string().describe('The current order price when returned by OpenSea.').nullable().optional(),
    currency: z.string().describe('The order currency symbol when returned by OpenSea.').nullable().optional(),
    maker: z.string().describe('The maker address when returned by OpenSea.').nullable().optional(),
    taker: z.string().describe('The taker address when returned by OpenSea.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw object returned by OpenSea.').optional(),
  }).describe('A normalized OpenSea marketplace order.').optional(),
}).describe('Best NFT offer returned by OpenSea.')

export const getNftInput = z.strictObject({
  chain: z.string().min(1).describe('The blockchain identifier used by OpenSea, such as ethereum, polygon, or base.'),
  address: z.string().min(1).describe('The NFT contract address.'),
  identifier: z.string().min(1).describe('The NFT token identifier.'),
}).describe('Input parameters for retrieving a single OpenSea NFT.')

export const getNftOutput = z.strictObject({
  nft: z.strictObject({
    identifier: z.string().describe('The NFT token identifier.').nullable().optional(),
    name: z.string().describe('The NFT display name.').nullable().optional(),
    description: z.string().describe('The NFT description.').nullable().optional(),
    imageUrl: z.string().describe('The NFT image URL.').nullable().optional(),
    collection: z.string().describe('The collection slug associated with the NFT.').nullable().optional(),
    contract: z.string().describe('The NFT contract address.').nullable().optional(),
    chain: z.string().describe('The blockchain identifier associated with the NFT.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw object returned by OpenSea.').optional(),
  }).describe('A normalized OpenSea NFT summary.').optional(),
}).describe('NFT details returned by OpenSea.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const openseaActions = {
  search: {
    description: 'Search OpenSea collections, tokens, NFTs, and accounts by relevance.',
    effect: 'write',
    inputSchema: searchInput,
    outputSchema: z.toJSONSchema(searchOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_collection: {
    description: 'Get one OpenSea collection including details, links, fees, and traits.',
    effect: 'read',
    inputSchema: getCollectionInput,
    outputSchema: z.toJSONSchema(getCollectionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_collection_stats: {
    description: 'Get comprehensive OpenSea statistics for one collection.',
    effect: 'read',
    inputSchema: getCollectionStatsInput,
    outputSchema: z.toJSONSchema(getCollectionStatsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_collection_nfts: {
    description: 'List NFTs in one OpenSea collection with optional trait filtering.',
    effect: 'read',
    inputSchema: listCollectionNftsInput,
    outputSchema: z.toJSONSchema(listCollectionNftsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_collection_traits: {
    description: 'List all available traits for an OpenSea collection.',
    effect: 'read',
    inputSchema: listCollectionTraitsInput,
    outputSchema: z.toJSONSchema(listCollectionTraitsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_collection_offers: {
    description: 'List collection-level offers for an OpenSea collection.',
    effect: 'read',
    inputSchema: listCollectionOffersInput,
    outputSchema: z.toJSONSchema(listCollectionOffersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_best_nft_listing: {
    description: 'Get the best current OpenSea listing for a single NFT.',
    effect: 'read',
    inputSchema: getBestNftListingInput,
    outputSchema: z.toJSONSchema(getBestNftListingOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_best_nft_offer: {
    description: 'Get the best current OpenSea offer for a single NFT.',
    effect: 'read',
    inputSchema: getBestNftOfferInput,
    outputSchema: z.toJSONSchema(getBestNftOfferOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_nft: {
    description: 'Get metadata, traits, ownership, and rarity for a single OpenSea NFT.',
    effect: 'read',
    inputSchema: getNftInput,
    outputSchema: z.toJSONSchema(getNftOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
