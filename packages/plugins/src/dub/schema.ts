/**
 * Dub 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const createLinkInput = z.strictObject({
  url: z.url().max(32000).describe('The destination URL of the short link.'),
  domain: z.string().max(190).describe('The short-link domain without protocol.').optional(),
  key: z.string().max(190).describe('The short-link slug.').optional(),
  keyLength: z.int().min(3).max(190).describe('The length of the generated short-link slug.').optional(),
  externalId: z.string().max(255).describe('The ID of the link in your database.').nullable().optional(),
  tenantId: z.string().max(255).describe('The tenant ID that created the link in your system.').nullable().optional(),
  programId: z.string().describe('The partner program ID associated with the link.').nullable().optional(),
  partnerId: z.string().describe('The partner ID associated with the link.').nullable().optional(),
  prefix: z.string().describe('The prefix used for randomly generated slugs.').optional(),
  trackConversion: z.boolean().describe('Whether Dub should track conversions for this link.').optional(),
  archived: z.boolean().describe('Whether the link should be archived.').optional(),
  tagIds: z.union([z.string().describe('A Dub tag ID.'), z.array(z.string().describe('A Dub identifier or name.')).min(1).describe('Dub tag IDs assigned to the link.')]).describe('The tag IDs assigned to the link.').optional(),
  tagNames: z.union([z.string().describe('A Dub tag name.'), z.array(z.string().describe('A Dub identifier or name.')).min(1).describe('Dub tag names assigned to the link.')]).describe('The tag names assigned to the link.').optional(),
  folderId: z.string().describe('The folder ID assigned to the link.').nullable().optional(),
  comments: z.string().describe('Comments for the link.').nullable().optional(),
  expiresAt: z.string().describe('The ISO-8601 timestamp when the link expires.').nullable().optional(),
  expiredUrl: z.url().max(32000).describe('The URL used when the short link has expired.').nullable().optional(),
  password: z.string().describe('The password required to access the destination URL.').nullable().optional(),
  proxy: z.boolean().describe('Whether the link uses Dub custom link previews.').optional(),
  title: z.string().describe('The custom link preview title.').nullable().optional(),
  description: z.string().describe('The custom link preview description.').nullable().optional(),
  image: z.string().describe('The custom link preview image URL.').nullable().optional(),
  video: z.string().describe('The custom link preview video URL.').nullable().optional(),
  rewrite: z.boolean().describe('Whether the link uses link cloaking.').optional(),
  ios: z.url().max(32000).describe('The iOS destination URL for device targeting.').nullable().optional(),
  android: z.url().max(32000).describe('The Android destination URL for device targeting.').nullable().optional(),
  geo: z.record(z.string(), z.url().max(32000).describe('The destination URL for this country.')).describe('Geo targeting destinations keyed by country code.').nullable().optional(),
  doIndex: z.boolean().describe('Whether search engines may index the short link.').optional(),
  utm_source: z.string().describe('The UTM source to apply to the destination URL.').nullable().optional(),
  utm_medium: z.string().describe('The UTM medium to apply to the destination URL.').nullable().optional(),
  utm_campaign: z.string().describe('The UTM campaign to apply to the destination URL.').nullable().optional(),
  utm_term: z.string().describe('The UTM term to apply to the destination URL.').nullable().optional(),
  utm_content: z.string().describe('The UTM content to apply to the destination URL.').nullable().optional(),
  ref: z.string().describe('The referral query parameter to apply to the destination URL.').nullable().optional(),
  webhookIds: z.array(z.string().describe('A Dub webhook ID.')).describe('Webhook IDs to trigger when the link is clicked.').nullable().optional(),
  testVariants: z.array(z.strictObject({
    url: z.url().describe('The variant destination URL.').optional(),
    percentage: z.int().min(10).max(90).describe('The traffic percentage for this variant.').optional(),
  }).describe('An A/B test URL variant.')).min(2).max(4).describe('A/B test URL variants for the short link.').nullable().optional(),
  testStartedAt: z.string().describe('The ISO-8601 timestamp when A/B testing started.').nullable().optional(),
  testCompletedAt: z.string().describe('The ISO-8601 timestamp when A/B testing completes.').nullable().optional(),
}).describe('Input parameters for creating a Dub link.')

export const createLinkOutput = z.strictObject({
  link: z.strictObject({
    id: z.string().describe('The unique ID of the Dub link.').optional(),
    domain: z.string().describe('The domain of the short link.').optional(),
    key: z.string().describe('The short-link slug.').optional(),
    url: z.string().describe('The destination URL of the link.').optional(),
    shortLink: z.string().describe('The full short-link URL.').nullable().optional(),
    qrCode: z.string().describe('The QR code URL for the short link.').nullable().optional(),
    title: z.string().describe('The custom link preview title.').nullable().optional(),
    archived: z.boolean().describe('Whether the link is archived.').nullable().optional(),
    clicks: z.number().describe('The number of recorded clicks.').nullable().optional(),
    leads: z.number().describe('The number of generated leads.').nullable().optional(),
    sales: z.number().describe('The number of generated sales.').nullable().optional(),
    saleAmount: z.number().describe('The total sales amount in cents.').nullable().optional(),
    createdAt: z.string().describe('The timestamp when the link was created.').nullable().optional(),
    updatedAt: z.string().describe('The timestamp when the link was last updated.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw Dub link payload.').optional(),
  }).describe('A normalized Dub link returned by the connector.').optional(),
}).describe('A Dub link action result.')

export const listLinksInput = z.strictObject({
  domain: z.string().describe('Only return links for this domain.').optional(),
  tagIds: z.union([z.string().describe('A Dub tag ID.'), z.array(z.string().describe('A Dub identifier or name.')).min(1).describe('Dub tag IDs.')]).describe('Only return links with these tag IDs.').optional(),
  tagNames: z.union([z.string().describe('A Dub tag name.'), z.array(z.string().describe('A Dub identifier or name.')).min(1).describe('Dub tag names.')]).describe('Only return links with these tag names.').optional(),
  folderId: z.string().describe('Only return links in this folder.').optional(),
  search: z.string().describe('Search against link slugs and destination URLs.').optional(),
  userId: z.string().describe('Only return links created by this Dub user ID.').optional(),
  tenantId: z.string().describe('Only return links for this tenant ID.').optional(),
  showArchived: z.boolean().describe('Whether archived links should be included.').optional(),
  sortBy: z.enum(['createdAt', 'clicks', 'saleAmount', 'lastClicked']).describe('The field used to sort links.').optional(),
  sortOrder: z.enum(['asc', 'desc']).describe('The sort direction.').optional(),
  endingBefore: z.string().describe('Return links before this cursor.').optional(),
  startingAfter: z.string().describe('Return links after this cursor.').optional(),
  pageSize: z.int().max(100).gt(0).describe('The number of links to return.').optional(),
}).describe('Filters and pagination options for listing Dub links.')

export const listLinksOutput = z.strictObject({
  links: z.array(z.strictObject({
    id: z.string().describe('The unique ID of the Dub link.').optional(),
    domain: z.string().describe('The domain of the short link.').optional(),
    key: z.string().describe('The short-link slug.').optional(),
    url: z.string().describe('The destination URL of the link.').optional(),
    shortLink: z.string().describe('The full short-link URL.').nullable().optional(),
    qrCode: z.string().describe('The QR code URL for the short link.').nullable().optional(),
    title: z.string().describe('The custom link preview title.').nullable().optional(),
    archived: z.boolean().describe('Whether the link is archived.').nullable().optional(),
    clicks: z.number().describe('The number of recorded clicks.').nullable().optional(),
    leads: z.number().describe('The number of generated leads.').nullable().optional(),
    sales: z.number().describe('The number of generated sales.').nullable().optional(),
    saleAmount: z.number().describe('The total sales amount in cents.').nullable().optional(),
    createdAt: z.string().describe('The timestamp when the link was created.').nullable().optional(),
    updatedAt: z.string().describe('The timestamp when the link was last updated.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw Dub link payload.').optional(),
  }).describe('A normalized Dub link returned by the connector.')).describe('Dub links returned by the API.').optional(),
}).describe('A list of Dub links.')

export const retrieveLinkInput = z.strictObject({
  linkId: z.string().describe('The Dub link ID to retrieve.').optional(),
  domain: z.string().describe('The short-link domain used with key lookup.').optional(),
  key: z.string().describe('The short-link slug used with domain lookup.').optional(),
  externalId: z.string().describe('The external ID for the link. Prefix with ext_ when required by Dub.').optional(),
}).describe('Identifiers for retrieving a Dub link.')

export const retrieveLinkOutput = z.strictObject({
  link: z.strictObject({
    id: z.string().describe('The unique ID of the Dub link.').optional(),
    domain: z.string().describe('The domain of the short link.').optional(),
    key: z.string().describe('The short-link slug.').optional(),
    url: z.string().describe('The destination URL of the link.').optional(),
    shortLink: z.string().describe('The full short-link URL.').nullable().optional(),
    qrCode: z.string().describe('The QR code URL for the short link.').nullable().optional(),
    title: z.string().describe('The custom link preview title.').nullable().optional(),
    archived: z.boolean().describe('Whether the link is archived.').nullable().optional(),
    clicks: z.number().describe('The number of recorded clicks.').nullable().optional(),
    leads: z.number().describe('The number of generated leads.').nullable().optional(),
    sales: z.number().describe('The number of generated sales.').nullable().optional(),
    saleAmount: z.number().describe('The total sales amount in cents.').nullable().optional(),
    createdAt: z.string().describe('The timestamp when the link was created.').nullable().optional(),
    updatedAt: z.string().describe('The timestamp when the link was last updated.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw Dub link payload.').optional(),
  }).describe('A normalized Dub link returned by the connector.').optional(),
}).describe('A Dub link action result.')

export const updateLinkInput = z.strictObject({
  linkId: z.string().min(1).describe('The Dub link ID to update.'),
  url: z.url().max(32000).describe('The destination URL of the short link.').optional(),
  domain: z.string().max(190).describe('The short-link domain without protocol.').optional(),
  key: z.string().max(190).describe('The short-link slug.').optional(),
  keyLength: z.int().min(3).max(190).describe('The length of the generated short-link slug.').optional(),
  externalId: z.string().max(255).describe('The ID of the link in your database.').nullable().optional(),
  tenantId: z.string().max(255).describe('The tenant ID that created the link in your system.').nullable().optional(),
  programId: z.string().describe('The partner program ID associated with the link.').nullable().optional(),
  partnerId: z.string().describe('The partner ID associated with the link.').nullable().optional(),
  prefix: z.string().describe('The prefix used for randomly generated slugs.').optional(),
  trackConversion: z.boolean().describe('Whether Dub should track conversions for this link.').optional(),
  archived: z.boolean().describe('Whether the link should be archived.').optional(),
  tagIds: z.union([z.string().describe('A Dub tag ID.'), z.array(z.string().describe('A Dub identifier or name.')).min(1).describe('Dub tag IDs assigned to the link.')]).describe('The tag IDs assigned to the link.').optional(),
  tagNames: z.union([z.string().describe('A Dub tag name.'), z.array(z.string().describe('A Dub identifier or name.')).min(1).describe('Dub tag names assigned to the link.')]).describe('The tag names assigned to the link.').optional(),
  folderId: z.string().describe('The folder ID assigned to the link.').nullable().optional(),
  comments: z.string().describe('Comments for the link.').nullable().optional(),
  expiresAt: z.string().describe('The ISO-8601 timestamp when the link expires.').nullable().optional(),
  expiredUrl: z.url().max(32000).describe('The URL used when the short link has expired.').nullable().optional(),
  password: z.string().describe('The password required to access the destination URL.').nullable().optional(),
  proxy: z.boolean().describe('Whether the link uses Dub custom link previews.').optional(),
  title: z.string().describe('The custom link preview title.').nullable().optional(),
  description: z.string().describe('The custom link preview description.').nullable().optional(),
  image: z.string().describe('The custom link preview image URL.').nullable().optional(),
  video: z.string().describe('The custom link preview video URL.').nullable().optional(),
  rewrite: z.boolean().describe('Whether the link uses link cloaking.').optional(),
  ios: z.url().max(32000).describe('The iOS destination URL for device targeting.').nullable().optional(),
  android: z.url().max(32000).describe('The Android destination URL for device targeting.').nullable().optional(),
  geo: z.record(z.string(), z.url().max(32000).describe('The destination URL for this country.')).describe('Geo targeting destinations keyed by country code.').nullable().optional(),
  doIndex: z.boolean().describe('Whether search engines may index the short link.').optional(),
  utm_source: z.string().describe('The UTM source to apply to the destination URL.').nullable().optional(),
  utm_medium: z.string().describe('The UTM medium to apply to the destination URL.').nullable().optional(),
  utm_campaign: z.string().describe('The UTM campaign to apply to the destination URL.').nullable().optional(),
  utm_term: z.string().describe('The UTM term to apply to the destination URL.').nullable().optional(),
  utm_content: z.string().describe('The UTM content to apply to the destination URL.').nullable().optional(),
  ref: z.string().describe('The referral query parameter to apply to the destination URL.').nullable().optional(),
  webhookIds: z.array(z.string().describe('A Dub webhook ID.')).describe('Webhook IDs to trigger when the link is clicked.').nullable().optional(),
  testVariants: z.array(z.strictObject({
    url: z.url().describe('The variant destination URL.').optional(),
    percentage: z.int().min(10).max(90).describe('The traffic percentage for this variant.').optional(),
  }).describe('An A/B test URL variant.')).min(2).max(4).describe('A/B test URL variants for the short link.').nullable().optional(),
  testStartedAt: z.string().describe('The ISO-8601 timestamp when A/B testing started.').nullable().optional(),
  testCompletedAt: z.string().describe('The ISO-8601 timestamp when A/B testing completes.').nullable().optional(),
}).describe('Input parameters for updating a Dub link.')

export const updateLinkOutput = z.strictObject({
  link: z.strictObject({
    id: z.string().describe('The unique ID of the Dub link.').optional(),
    domain: z.string().describe('The domain of the short link.').optional(),
    key: z.string().describe('The short-link slug.').optional(),
    url: z.string().describe('The destination URL of the link.').optional(),
    shortLink: z.string().describe('The full short-link URL.').nullable().optional(),
    qrCode: z.string().describe('The QR code URL for the short link.').nullable().optional(),
    title: z.string().describe('The custom link preview title.').nullable().optional(),
    archived: z.boolean().describe('Whether the link is archived.').nullable().optional(),
    clicks: z.number().describe('The number of recorded clicks.').nullable().optional(),
    leads: z.number().describe('The number of generated leads.').nullable().optional(),
    sales: z.number().describe('The number of generated sales.').nullable().optional(),
    saleAmount: z.number().describe('The total sales amount in cents.').nullable().optional(),
    createdAt: z.string().describe('The timestamp when the link was created.').nullable().optional(),
    updatedAt: z.string().describe('The timestamp when the link was last updated.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw Dub link payload.').optional(),
  }).describe('A normalized Dub link returned by the connector.').optional(),
}).describe('A Dub link action result.')

export const deleteLinkInput = z.strictObject({
  linkId: z.string().min(1).describe('The Dub link ID to delete.').optional(),
}).describe('Identifier for deleting a Dub link.')

export const deleteLinkOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the connector completed the delete request.').optional(),
  raw: z.unknown().describe('The raw Dub deletion response, if any.').nullable().optional(),
}).describe('A Dub link deletion acknowledgement.')

export const countLinksInput = z.strictObject({
  domain: z.string().describe('Only count links for this domain.').optional(),
  tagIds: z.union([z.string().describe('A Dub tag ID.'), z.array(z.string().describe('A Dub identifier or name.')).min(1).describe('Dub tag IDs.')]).describe('Only count links with these tag IDs.').optional(),
  tagNames: z.union([z.string().describe('A Dub tag name.'), z.array(z.string().describe('A Dub identifier or name.')).min(1).describe('Dub tag names.')]).describe('Only count links with these tag names.').optional(),
  folderId: z.string().describe('Only count links in this folder.').optional(),
  search: z.string().describe('Search against link slugs and destination URLs.').optional(),
  userId: z.string().describe('Only count links created by this Dub user ID.').optional(),
  tenantId: z.string().describe('Only count links for this tenant ID.').optional(),
  showArchived: z.boolean().describe('Whether archived links should be included.').optional(),
}).describe('Filters for counting Dub links.')

export const countLinksOutput = z.strictObject({
  count: z.number().describe('The number of matching Dub links.').optional(),
  raw: z.unknown().describe('The raw Dub count response.').optional(),
}).describe('The Dub links count result.')

export const listTagsInput = z.strictObject({
  page: z.int().gt(0).describe('The page number to retrieve.').optional(),
  pageSize: z.int().max(100).gt(0).describe('The number of tags to return.').optional(),
}).describe('Pagination options for listing Dub tags.')

export const listTagsOutput = z.strictObject({
  tags: z.array(z.strictObject({
    id: z.string().describe('The unique ID of the tag.').optional(),
    name: z.string().describe('The tag name.').optional(),
    color: z.string().describe('The tag color.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw Dub tag payload.').optional(),
  }).describe('A normalized Dub tag.')).describe('Dub tags returned by the API.').optional(),
}).describe('A list of Dub tags.')

export const createTagInput = z.strictObject({
  name: z.string().min(1).describe('The tag name.'),
  color: z.enum(['red', 'yellow', 'green', 'blue', 'purple', 'brown', 'gray', 'pink']).describe('The Dub tag color.').optional(),
}).describe('Input parameters for creating a Dub tag.')

export const createTagOutput = z.strictObject({
  tag: z.strictObject({
    id: z.string().describe('The unique ID of the tag.').optional(),
    name: z.string().describe('The tag name.').optional(),
    color: z.string().describe('The tag color.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw Dub tag payload.').optional(),
  }).describe('A normalized Dub tag.').optional(),
}).describe('A Dub tag action result.')

export const updateTagInput = z.strictObject({
  id: z.string().min(1).describe('The Dub tag ID to update.'),
  name: z.string().min(1).describe('The updated tag name.').optional(),
  color: z.enum(['red', 'yellow', 'green', 'blue', 'purple', 'brown', 'gray', 'pink']).describe('The Dub tag color.').optional(),
}).describe('Input parameters for updating a Dub tag.')

export const updateTagOutput = z.strictObject({
  tag: z.strictObject({
    id: z.string().describe('The unique ID of the tag.').optional(),
    name: z.string().describe('The tag name.').optional(),
    color: z.string().describe('The tag color.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw Dub tag payload.').optional(),
  }).describe('A normalized Dub tag.').optional(),
}).describe('A Dub tag action result.')

export const deleteTagInput = z.strictObject({
  id: z.string().min(1).describe('The Dub tag ID to delete.').optional(),
}).describe('Identifier for deleting a Dub tag.')

export const deleteTagOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the connector completed the delete request.').optional(),
  raw: z.unknown().describe('The raw Dub deletion response, if any.').nullable().optional(),
}).describe('A Dub link deletion acknowledgement.')

export const listFoldersInput = z.strictObject({
  page: z.int().gt(0).describe('The page number to retrieve.').optional(),
  pageSize: z.int().max(100).gt(0).describe('The number of folders to return.').optional(),
}).describe('Pagination options for listing Dub folders.')

export const listFoldersOutput = z.strictObject({
  folders: z.array(z.strictObject({
    id: z.string().describe('The unique ID of the folder.').optional(),
    name: z.string().describe('The folder name.').optional(),
    accessLevel: z.string().describe('The folder access level returned by Dub.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw Dub folder payload.').optional(),
  }).describe('A normalized Dub folder.')).describe('Dub folders returned by the API.').optional(),
}).describe('A list of Dub folders.')

export const createFolderInput = z.strictObject({
  name: z.string().min(1).describe('The folder name.').optional(),
}).describe('Input parameters for creating a Dub folder.')

export const createFolderOutput = z.strictObject({
  folder: z.strictObject({
    id: z.string().describe('The unique ID of the folder.').optional(),
    name: z.string().describe('The folder name.').optional(),
    accessLevel: z.string().describe('The folder access level returned by Dub.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw Dub folder payload.').optional(),
  }).describe('A normalized Dub folder.').optional(),
}).describe('A Dub folder action result.')

export const updateFolderInput = z.strictObject({
  id: z.string().min(1).describe('The Dub folder ID to update.').optional(),
  name: z.string().min(1).describe('The updated folder name.').optional(),
}).describe('Input parameters for updating a Dub folder.')

export const updateFolderOutput = z.strictObject({
  folder: z.strictObject({
    id: z.string().describe('The unique ID of the folder.').optional(),
    name: z.string().describe('The folder name.').optional(),
    accessLevel: z.string().describe('The folder access level returned by Dub.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw Dub folder payload.').optional(),
  }).describe('A normalized Dub folder.').optional(),
}).describe('A Dub folder action result.')

export const deleteFolderInput = z.strictObject({
  id: z.string().min(1).describe('The Dub folder ID to delete.').optional(),
}).describe('Identifier for deleting a Dub folder.')

export const deleteFolderOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the connector completed the delete request.').optional(),
  raw: z.unknown().describe('The raw Dub deletion response, if any.').nullable().optional(),
}).describe('A Dub link deletion acknowledgement.')

export const retrieveAnalyticsInput = z.strictObject({
  event: z.enum(['clicks', 'leads', 'sales', 'composite']).describe('The event metric to retrieve from Dub analytics.').optional(),
  groupBy: z.enum(['count', 'timeseries', 'continents', 'regions', 'countries', 'cities', 'devices', 'browsers', 'os', 'trigger', 'triggers', 'referers', 'referer_urls', 'top_folders', 'top_link_tags', 'top_domains', 'top_links', 'top_urls', 'top_base_urls', 'top_partners', 'top_groups', 'top_partner_tags', 'utm_sources', 'utm_mediums', 'utm_campaigns', 'utm_terms', 'utm_contents']).describe('The dimension used to group Dub analytics.').optional(),
  domain: z.string().describe('The domain filter for analytics.').optional(),
  key: z.string().describe('The link slug used with a domain filter.').optional(),
  linkId: z.string().describe('The Dub link ID filter.').optional(),
  externalId: z.string().describe('The external link ID filter.').optional(),
  tenantId: z.string().describe('The tenant ID filter.').optional(),
  tagId: z.string().describe('The tag ID filter.').optional(),
  folderId: z.string().describe('The folder ID filter.').optional(),
  partnerTagId: z.string().describe('The partner tag ID filter.').optional(),
  groupId: z.string().describe('The partner group ID filter.').optional(),
  partnerId: z.string().describe('The partner ID filter.').optional(),
  customerId: z.string().describe('The customer ID filter.').optional(),
  interval: z.enum(['24h', '7d', '30d', '90d', '1y', 'mtd', 'qtd', 'ytd', 'all']).describe('The analytics date range shortcut.').optional(),
  start: z.string().describe('The start timestamp for the analytics range.').optional(),
  end: z.string().describe('The end timestamp for the analytics range.').optional(),
  timezone: z.string().describe('The IANA time zone used to align timeseries buckets.').optional(),
  country: z.string().describe('The country filter using ISO 3166-1 alpha-2 codes.').optional(),
  city: z.string().describe('The city filter.').optional(),
  region: z.string().describe('The ISO 3166-2 region code filter.').optional(),
  continent: z.string().describe('The continent filter.').optional(),
  device: z.string().describe('The device filter.').optional(),
  browser: z.string().describe('The browser filter.').optional(),
  os: z.string().describe('The operating system filter.').optional(),
  trigger: z.string().describe('The trigger filter.').optional(),
  referer: z.string().describe('The referer hostname filter.').optional(),
  refererUrl: z.string().describe('The full referer URL filter.').optional(),
  url: z.string().describe('The destination URL filter.').optional(),
  utm_source: z.string().describe('The UTM source filter.').optional(),
  utm_medium: z.string().describe('The UTM medium filter.').optional(),
  utm_campaign: z.string().describe('The UTM campaign filter.').optional(),
  utm_term: z.string().describe('The UTM term filter.').optional(),
  utm_content: z.string().describe('The UTM content filter.').optional(),
}).describe('Filters for retrieving Dub analytics.')

export const retrieveAnalyticsOutput = z.strictObject({
  data: z.unknown().describe('The analytics data returned by Dub.').optional(),
}).describe('A Dub analytics result.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const dubActions = {
  create_link: {
    description: 'Create a short link in the authenticated Dub workspace.',
    effect: 'write',
    inputSchema: createLinkInput,
    outputSchema: z.toJSONSchema(createLinkOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_links: {
    description: 'List short links in the authenticated Dub workspace.',
    effect: 'read',
    inputSchema: listLinksInput,
    outputSchema: z.toJSONSchema(listLinksOutput, { io: 'output', unrepresentable: 'any' }),
  },
  retrieve_link: {
    description: 'Retrieve a Dub short link by ID or by supported lookup fields.',
    effect: 'read',
    inputSchema: retrieveLinkInput,
    outputSchema: z.toJSONSchema(retrieveLinkOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_link: {
    description: 'Update a short link in the authenticated Dub workspace.',
    effect: 'write',
    inputSchema: updateLinkInput,
    outputSchema: z.toJSONSchema(updateLinkOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_link: {
    description: 'Delete a short link from the authenticated Dub workspace.',
    effect: 'destructive',
    inputSchema: deleteLinkInput,
    outputSchema: z.toJSONSchema(deleteLinkOutput, { io: 'output', unrepresentable: 'any' }),
  },
  count_links: {
    description: 'Retrieve the number of matching links in the authenticated Dub workspace.',
    effect: 'read',
    inputSchema: countLinksInput,
    outputSchema: z.toJSONSchema(countLinksOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_tags: {
    description: 'List tags in the authenticated Dub workspace.',
    effect: 'read',
    inputSchema: listTagsInput,
    outputSchema: z.toJSONSchema(listTagsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_tag: {
    description: 'Create a tag in the authenticated Dub workspace.',
    effect: 'write',
    inputSchema: createTagInput,
    outputSchema: z.toJSONSchema(createTagOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_tag: {
    description: 'Update a tag in the authenticated Dub workspace.',
    effect: 'write',
    inputSchema: updateTagInput,
    outputSchema: z.toJSONSchema(updateTagOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_tag: {
    description: 'Delete a tag from the authenticated Dub workspace.',
    effect: 'destructive',
    inputSchema: deleteTagInput,
    outputSchema: z.toJSONSchema(deleteTagOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_folders: {
    description: 'List folders in the authenticated Dub workspace.',
    effect: 'read',
    inputSchema: listFoldersInput,
    outputSchema: z.toJSONSchema(listFoldersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_folder: {
    description: 'Create a folder in the authenticated Dub workspace.',
    effect: 'write',
    inputSchema: createFolderInput,
    outputSchema: z.toJSONSchema(createFolderOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_folder: {
    description: 'Update a folder in the authenticated Dub workspace.',
    effect: 'write',
    inputSchema: updateFolderInput,
    outputSchema: z.toJSONSchema(updateFolderOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_folder: {
    description: 'Delete a folder from the authenticated Dub workspace.',
    effect: 'destructive',
    inputSchema: deleteFolderInput,
    outputSchema: z.toJSONSchema(deleteFolderOutput, { io: 'output', unrepresentable: 'any' }),
  },
  retrieve_analytics: {
    description: 'Retrieve analytics for a Dub link, domain, or workspace.',
    effect: 'read',
    inputSchema: retrieveAnalyticsInput,
    outputSchema: z.toJSONSchema(retrieveAnalyticsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
