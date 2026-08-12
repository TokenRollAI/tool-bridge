/**
 * Unsplash 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listPhotosInput = z.strictObject({
  page: z.int().min(1).describe('The 1-based page number to retrieve.').optional(),
  perPage: z.int().min(1).max(30).describe('The number of items to return per page, between 1 and 30.').optional(),
  orderBy: z.enum(['latest', 'oldest', 'popular']).describe('The sort order supported by the Unsplash photo listing endpoints.').optional(),
}).describe('The input payload for listing the latest public photos from Unsplash.')

export const listPhotosOutput = z.strictObject({
  photos: z.array(z.strictObject({
    id: z.string().describe('The unique identifier of the photo.'),
    slug: z.string().describe('The public slug of the photo.').optional(),
    description: z.string().describe('The description of the photo when Unsplash provides it.').nullable().optional(),
    alt_description: z.string().describe('The alternative description of the photo when Unsplash provides it.').nullable().optional(),
    width: z.number().describe('The width of the photo in pixels.').optional(),
    height: z.number().describe('The height of the photo in pixels.').optional(),
    color: z.string().describe('The representative HEX color of the photo.').optional(),
    blur_hash: z.string().describe('The blur hash value of the photo.').optional(),
    urls: z.looseObject({}).describe('The photo URLs returned by Unsplash in multiple sizes.').optional(),
    links: z.looseObject({}).describe('The related links attached to the Unsplash photo resource.').optional(),
    user: z.looseObject({}).describe('The user metadata attached to the photo.').optional(),
  }).describe('A summary photo resource returned by Unsplash.')).describe('The public photo summaries returned by Unsplash.'),
}).describe('The latest public photos returned by Unsplash.')

export const searchPhotosInput = z.strictObject({
  query: z.string().min(1).describe('The search query to run against Unsplash photos.'),
  page: z.int().min(1).describe('The 1-based page number to retrieve.').optional(),
  perPage: z.int().min(1).max(30).describe('The number of items to return per page, between 1 and 30.').optional(),
  orderBy: z.enum(['relevant', 'latest']).describe('The sort order supported by the Unsplash photo search endpoint.').optional(),
  color: z.enum(['black_and_white', 'black', 'white', 'yellow', 'orange', 'red', 'purple', 'magenta', 'green', 'teal', 'blue']).describe('The color filter to apply to photo search results.').optional(),
  orientation: z.enum(['landscape', 'portrait', 'squarish']).describe('The photo orientation filter to apply.').optional(),
  contentFilter: z.enum(['low', 'high']).describe('The safety filter level to apply to supported Unsplash requests.').optional(),
  collections: z.array(z.string().min(1).describe('One identifier value.')).min(1).describe('The collection identifiers to filter the search results by.').optional(),
}).describe('The input payload for searching photos on Unsplash.')

export const searchPhotosOutput = z.strictObject({
  total: z.number().describe('The total number of matching photo results.'),
  totalPages: z.number().describe('The total number of result pages.'),
  results: z.array(z.strictObject({
    id: z.string().describe('The unique identifier of the photo.'),
    slug: z.string().describe('The public slug of the photo.').optional(),
    description: z.string().describe('The description of the photo when Unsplash provides it.').nullable().optional(),
    alt_description: z.string().describe('The alternative description of the photo when Unsplash provides it.').nullable().optional(),
    width: z.number().describe('The width of the photo in pixels.').optional(),
    height: z.number().describe('The height of the photo in pixels.').optional(),
    color: z.string().describe('The representative HEX color of the photo.').optional(),
    blur_hash: z.string().describe('The blur hash value of the photo.').optional(),
    urls: z.looseObject({}).describe('The photo URLs returned by Unsplash in multiple sizes.').optional(),
    links: z.looseObject({}).describe('The related links attached to the Unsplash photo resource.').optional(),
    user: z.looseObject({}).describe('The user metadata attached to the photo.').optional(),
  }).describe('A summary photo resource returned by Unsplash.')).describe('The matching photo summaries returned by Unsplash.'),
}).describe('The photo search results returned by Unsplash.')

export const getPhotoInput = z.strictObject({
  id: z.string().min(1).describe('The Unsplash photo identifier to retrieve.'),
}).describe('The input payload for fetching a single Unsplash photo.')

export const getPhotoOutput = z.strictObject({
  photo: z.strictObject({
    id: z.string().describe('The unique identifier of the photo.'),
    slug: z.string().describe('The public slug of the photo.').optional(),
    description: z.string().describe('The description of the photo when Unsplash provides it.').nullable().optional(),
    alt_description: z.string().describe('The alternative description of the photo when Unsplash provides it.').nullable().optional(),
    width: z.number().describe('The width of the photo in pixels.').optional(),
    height: z.number().describe('The height of the photo in pixels.').optional(),
    color: z.string().describe('The representative HEX color of the photo.').optional(),
    blur_hash: z.string().describe('The blur hash value of the photo.').optional(),
    urls: z.looseObject({}).describe('The photo URLs returned by Unsplash in multiple sizes.').optional(),
    links: z.looseObject({}).describe('The related links attached to the Unsplash photo resource.').optional(),
    user: z.looseObject({}).describe('The user metadata attached to the photo.').optional(),
    created_at: z.string().describe('The creation timestamp of the photo.').optional(),
    liked_by_user: z.boolean().describe('Whether the authenticated user liked the photo.').optional(),
    likes: z.number().describe('The total number of likes on the photo.').optional(),
    current_user_collections: z.array(z.looseObject({}).describe('One current user collection reference.')).describe('The current user collections returned with the photo.').optional(),
  }).describe('A detailed photo resource returned by Unsplash.'),
}).describe('The detailed photo payload returned by Unsplash.')

export const getRandomPhotoInput = z.strictObject({
  query: z.string().min(1).describe('The search query used to constrain the random photo.').optional(),
  collections: z.array(z.string().min(1).describe('One identifier value.')).min(1).describe('The collection identifiers used to constrain the random photo.').optional(),
  topics: z.array(z.string().min(1).describe('One identifier value.')).min(1).describe('The topic identifiers used to constrain the random photo.').optional(),
  username: z.string().min(1).describe('The username used to constrain the random photo.').optional(),
  orientation: z.enum(['landscape', 'portrait', 'squarish']).describe('The photo orientation filter to apply.').optional(),
  contentFilter: z.enum(['low', 'high']).describe('The safety filter level to apply to supported Unsplash requests.').optional(),
  count: z.int().min(1).max(30).describe('The number of random photos to request, between 1 and 30.').optional(),
}).describe('The input payload for fetching one or more random Unsplash photos.')

export const getRandomPhotoOutput = z.strictObject({
  photos: z.array(z.strictObject({
    id: z.string().describe('The unique identifier of the photo.'),
    slug: z.string().describe('The public slug of the photo.').optional(),
    description: z.string().describe('The description of the photo when Unsplash provides it.').nullable().optional(),
    alt_description: z.string().describe('The alternative description of the photo when Unsplash provides it.').nullable().optional(),
    width: z.number().describe('The width of the photo in pixels.').optional(),
    height: z.number().describe('The height of the photo in pixels.').optional(),
    color: z.string().describe('The representative HEX color of the photo.').optional(),
    blur_hash: z.string().describe('The blur hash value of the photo.').optional(),
    urls: z.looseObject({}).describe('The photo URLs returned by Unsplash in multiple sizes.').optional(),
    links: z.looseObject({}).describe('The related links attached to the Unsplash photo resource.').optional(),
    user: z.looseObject({}).describe('The user metadata attached to the photo.').optional(),
    created_at: z.string().describe('The creation timestamp of the photo.').optional(),
    liked_by_user: z.boolean().describe('Whether the authenticated user liked the photo.').optional(),
    likes: z.number().describe('The total number of likes on the photo.').optional(),
    current_user_collections: z.array(z.looseObject({}).describe('One current user collection reference.')).describe('The current user collections returned with the photo.').optional(),
  }).describe('A detailed photo resource returned by Unsplash.')).describe('The random photo resources returned by Unsplash.'),
}).describe('The normalized random photo payload returned by Unsplash.')

export const listTopicsInput = z.strictObject({
  page: z.int().min(1).describe('The 1-based page number to retrieve.').optional(),
  perPage: z.int().min(1).max(30).describe('The number of items to return per page, between 1 and 30.').optional(),
  orderBy: z.enum(['position', 'latest', 'oldest', 'popular']).describe('The sort order supported by the Unsplash topic listing endpoint.').optional(),
}).describe('The input payload for listing Unsplash topics.')

export const listTopicsOutput = z.strictObject({
  topics: z.array(z.strictObject({
    id: z.string().describe('The unique identifier of the topic.'),
    slug: z.string().describe('The topic slug.').optional(),
    title: z.string().describe('The display title of the topic.'),
    description: z.string().describe('The description of the topic when Unsplash provides it.').nullable().optional(),
    featured: z.boolean().describe('Whether the topic is marked as featured.').optional(),
    total_photos: z.number().describe('The total number of photos in the topic.').optional(),
    links: z.looseObject({}).describe('The related links attached to the Unsplash topic resource.').optional(),
    cover_photo: z.looseObject({}).describe('The cover photo attached to the topic when Unsplash provides it.').optional(),
  }).describe('A topic resource returned by Unsplash.')).describe('The topics returned by Unsplash.'),
}).describe('The topic listing returned by Unsplash.')

export const getTopicPhotosInput = z.strictObject({
  topicIdOrSlug: z.string().min(1).describe('The topic identifier or slug to read photos from.'),
  page: z.int().min(1).describe('The 1-based page number to retrieve.').optional(),
  perPage: z.int().min(1).max(30).describe('The number of items to return per page, between 1 and 30.').optional(),
  orientation: z.enum(['landscape', 'portrait', 'squarish']).describe('The photo orientation filter to apply.').optional(),
  orderBy: z.enum(['latest', 'oldest', 'popular']).describe('The sort order supported by the Unsplash photo listing endpoints.').optional(),
}).describe('The input payload for listing photos from an Unsplash topic.')

export const getTopicPhotosOutput = z.strictObject({
  photos: z.array(z.strictObject({
    id: z.string().describe('The unique identifier of the photo.'),
    slug: z.string().describe('The public slug of the photo.').optional(),
    description: z.string().describe('The description of the photo when Unsplash provides it.').nullable().optional(),
    alt_description: z.string().describe('The alternative description of the photo when Unsplash provides it.').nullable().optional(),
    width: z.number().describe('The width of the photo in pixels.').optional(),
    height: z.number().describe('The height of the photo in pixels.').optional(),
    color: z.string().describe('The representative HEX color of the photo.').optional(),
    blur_hash: z.string().describe('The blur hash value of the photo.').optional(),
    urls: z.looseObject({}).describe('The photo URLs returned by Unsplash in multiple sizes.').optional(),
    links: z.looseObject({}).describe('The related links attached to the Unsplash photo resource.').optional(),
    user: z.looseObject({}).describe('The user metadata attached to the photo.').optional(),
  }).describe('A summary photo resource returned by Unsplash.')).describe('The photo summaries returned for the requested Unsplash topic.'),
}).describe('The topic photo listing returned by Unsplash.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const unsplashActions = {
  list_photos: {
    description: 'List the latest public photos from Unsplash.',
    effect: 'read',
    inputSchema: listPhotosInput,
    outputSchema: z.toJSONSchema(listPhotosOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_photos: {
    description: 'Search photos on Unsplash using keyword and filter inputs.',
    effect: 'read',
    inputSchema: searchPhotosInput,
    outputSchema: z.toJSONSchema(searchPhotosOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_photo: {
    description: 'Fetch the detailed payload for a single Unsplash photo.',
    effect: 'read',
    inputSchema: getPhotoInput,
    outputSchema: z.toJSONSchema(getPhotoOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_random_photo: {
    description: 'Fetch one or more random Unsplash photos using optional filters.',
    effect: 'read',
    inputSchema: getRandomPhotoInput,
    outputSchema: z.toJSONSchema(getRandomPhotoOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_topics: {
    description: 'List topics curated by Unsplash.',
    effect: 'read',
    inputSchema: listTopicsInput,
    outputSchema: z.toJSONSchema(listTopicsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_topic_photos: {
    description: 'List photos from a specific Unsplash topic.',
    effect: 'read',
    inputSchema: getTopicPhotosInput,
    outputSchema: z.toJSONSchema(getTopicPhotosOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
