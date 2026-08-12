/**
 * Cincopa 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listGalleriesInput = z.strictObject({
  search: z.string().min(1).describe('Search term matched against gallery captions, descriptions, IDs, and tags.').optional(),
  page: z.int().min(1).describe('Result page number to request from Cincopa.').optional(),
  itemsPerPage: z.int().min(1).describe('Maximum number of galleries to request in one page.').optional(),
  filterTags: z.array(z.string().min(1).describe('One gallery tag filter value.')).min(1).describe('Gallery tags to include or exclude. Prefix a value with \'-\' to exclude it.').optional(),
}).describe('Input parameters for listing galleries from a Cincopa account.')

export const listGalleriesOutput = z.strictObject({
  workspace: z.string().describe('Workspace name returned by Cincopa for the request context.'),
  galleries: z.array(z.looseObject({}).describe('One raw Cincopa row returned by the upstream API.')).describe('Gallery rows returned by Cincopa.'),
  tagCloud: z.record(z.string(), z.int().describe('The item count.')).describe('Mapping of Cincopa tag names to item counts.'),
  pagination: z.strictObject({
    page: z.int().describe('The current result page returned by Cincopa.').optional(),
    itemsPerPage: z.int().describe('The number of rows requested per page.').optional(),
    itemsCount: z.int().describe('The total number of rows available for the current query.').optional(),
    pageCount: z.int().describe('The total number of pages available for the current query.').optional(),
  }).describe('Pagination metadata returned by Cincopa list endpoints.'),
}).describe('Action output.')

export const listGalleryItemsInput = z.strictObject({
  fid: z.string().min(1).describe('The Cincopa gallery FID to inspect.'),
  details: z.array(z.string().min(1).describe('One Cincopa metadata field name.')).min(1).describe('Metadata field names to request from Cincopa for each gallery item.').optional(),
  page: z.int().min(1).describe('Result page number to request from Cincopa.').optional(),
  itemsPerPage: z.int().min(1).describe('Maximum number of gallery items to request in one page.').optional(),
}).describe('Input parameters for listing items inside one Cincopa gallery.')

export const listGalleryItemsOutput = z.strictObject({
  fid: z.string().describe('The gallery FID returned by Cincopa.'),
  uploadUrl: z.url().describe('The upload URL returned for the gallery.'),
  claimed: z.string().describe('The gallery claim marker returned by Cincopa.'),
  spfid: z.string().describe('The secondary gallery identifier returned by Cincopa.'),
  items: z.array(z.looseObject({}).describe('One raw Cincopa row returned by the upstream API.')).describe('Gallery item rows returned by Cincopa.'),
  pagination: z.strictObject({
    page: z.int().describe('The current result page returned by Cincopa.').optional(),
    itemsPerPage: z.int().describe('The number of rows requested per page.').optional(),
    itemsCount: z.int().describe('The total number of rows available for the current query.').optional(),
    pageCount: z.int().describe('The total number of pages available for the current query.').optional(),
  }).describe('Pagination metadata returned by Cincopa list endpoints.'),
}).describe('Action output.')

export const listAssetsInput = z.strictObject({
  search: z.string().min(1).describe('Free-text search term for asset metadata.').optional(),
  types: z.array(z.string().min(1).describe('One Cincopa asset type value.')).min(1).describe('Asset types to include, such as image, video, audio, or other.').optional(),
  rid: z.string().min(1).describe('Exact Cincopa RID to search for.').optional(),
  referenceId: z.string().min(1).describe('Exact Cincopa reference_id to search for.').optional(),
  tag: z.string().min(1).describe('Asset tag filter value.').optional(),
  details: z.array(z.string().min(1).describe('One Cincopa metadata field name.')).min(1).describe('Metadata field names to request from Cincopa for each asset row.').optional(),
  page: z.int().min(1).describe('Result page number to request from Cincopa.').optional(),
  itemsPerPage: z.int().min(1).describe('Maximum number of assets to request in one page.').optional(),
}).describe('Input parameters for listing assets from a Cincopa account.')

export const listAssetsOutput = z.strictObject({
  items: z.array(z.looseObject({}).describe('One raw Cincopa row returned by the upstream API.')).describe('Asset rows returned by Cincopa.'),
  pagination: z.strictObject({
    page: z.int().describe('The current result page returned by Cincopa.').optional(),
    itemsPerPage: z.int().describe('The number of rows requested per page.').optional(),
    itemsCount: z.int().describe('The total number of rows available for the current query.').optional(),
    pageCount: z.int().describe('The total number of pages available for the current query.').optional(),
  }).describe('Pagination metadata returned by Cincopa list endpoints.'),
}).describe('Action output.')

export const listAssetTagsInput = z.strictObject({}).describe('Input parameters for listing Cincopa asset tags.')

export const listAssetTagsOutput = z.strictObject({
  tagCloud: z.record(z.string(), z.int().describe('The item count.')).describe('Mapping of Cincopa tag names to item counts.'),
}).describe('Action output.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const cincopaActions = {
  list_galleries: {
    description: 'List galleries from a Cincopa account with optional search and tag filters.',
    effect: 'read',
    inputSchema: listGalleriesInput,
    outputSchema: z.toJSONSchema(listGalleriesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_gallery_items: {
    description: 'List items from one Cincopa gallery by FID.',
    effect: 'read',
    inputSchema: listGalleryItemsInput,
    outputSchema: z.toJSONSchema(listGalleryItemsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_assets: {
    description: 'List assets from a Cincopa account with optional metadata filters.',
    effect: 'read',
    inputSchema: listAssetsInput,
    outputSchema: z.toJSONSchema(listAssetsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_asset_tags: {
    description: 'List the asset tag cloud available in a Cincopa account.',
    effect: 'read',
    inputSchema: listAssetTagsInput,
    outputSchema: z.toJSONSchema(listAssetTagsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
