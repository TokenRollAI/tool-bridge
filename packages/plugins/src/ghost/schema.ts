/**
 * Ghost 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listPostsInput = z.strictObject({
  limit: z.int().min(1).max(100).describe('The maximum number of resources to request from Ghost.').optional(),
  page: z.int().min(1).describe('The one-based page number to request from Ghost.').optional(),
  include: z.string().min(1).describe('Comma-separated Ghost include expression, such as authors,tags or count.posts.').optional(),
  fields: z.string().min(1).describe('Comma-separated Ghost field list to return.').optional(),
  formats: z.string().min(1).describe('Comma-separated Ghost formats to return, such as html,plaintext.').optional(),
  filter: z.string().min(1).describe('Ghost Content API filter expression.').optional(),
  order: z.string().min(1).describe('Ghost Content API order expression.').optional(),
}).describe('Input for browsing Ghost content resources.')

export const listPostsOutput = z.strictObject({
  posts: z.array(z.looseObject({}).describe('The raw Ghost Content API object.')).describe('The Ghost posts returned by the Content API.').optional(),
  meta: z.looseObject({}).describe('The Ghost Content API pagination metadata.').nullable().optional(),
}).describe('Ghost posts browse response.')

export const getPostInput = z.strictObject({
  id: z.string().min(1).describe('The Ghost resource ID.').optional(),
  slug: z.string().min(1).describe('The Ghost resource slug.').optional(),
  include: z.string().min(1).describe('Comma-separated Ghost include expression, such as authors,tags or count.posts.').optional(),
  fields: z.string().min(1).describe('Comma-separated Ghost field list to return.').optional(),
  formats: z.string().min(1).describe('Comma-separated Ghost formats to return, such as html,plaintext.').optional(),
}).describe('Input for reading one Ghost content resource.')

export const getPostOutput = z.strictObject({
  post: z.looseObject({}).describe('The raw Ghost Content API object.').nullable().optional(),
}).describe('Ghost post read response.')

export const listPagesInput = z.strictObject({
  limit: z.int().min(1).max(100).describe('The maximum number of resources to request from Ghost.').optional(),
  page: z.int().min(1).describe('The one-based page number to request from Ghost.').optional(),
  include: z.string().min(1).describe('Comma-separated Ghost include expression, such as authors,tags or count.posts.').optional(),
  fields: z.string().min(1).describe('Comma-separated Ghost field list to return.').optional(),
  formats: z.string().min(1).describe('Comma-separated Ghost formats to return, such as html,plaintext.').optional(),
  filter: z.string().min(1).describe('Ghost Content API filter expression.').optional(),
  order: z.string().min(1).describe('Ghost Content API order expression.').optional(),
}).describe('Input for browsing Ghost content resources.')

export const listPagesOutput = z.strictObject({
  pages: z.array(z.looseObject({}).describe('The raw Ghost Content API object.')).describe('The Ghost pages returned by the Content API.').optional(),
  meta: z.looseObject({}).describe('The Ghost Content API pagination metadata.').nullable().optional(),
}).describe('Ghost pages browse response.')

export const getPageInput = z.strictObject({
  id: z.string().min(1).describe('The Ghost resource ID.').optional(),
  slug: z.string().min(1).describe('The Ghost resource slug.').optional(),
  include: z.string().min(1).describe('Comma-separated Ghost include expression, such as authors,tags or count.posts.').optional(),
  fields: z.string().min(1).describe('Comma-separated Ghost field list to return.').optional(),
  formats: z.string().min(1).describe('Comma-separated Ghost formats to return, such as html,plaintext.').optional(),
}).describe('Input for reading one Ghost content resource.')

export const getPageOutput = z.strictObject({
  page: z.looseObject({}).describe('The raw Ghost Content API object.').nullable().optional(),
}).describe('Ghost page read response.')

export const listTagsInput = z.strictObject({
  limit: z.int().min(1).max(100).describe('The maximum number of resources to request from Ghost.').optional(),
  page: z.int().min(1).describe('The one-based page number to request from Ghost.').optional(),
  include: z.string().min(1).describe('Comma-separated Ghost include expression, such as authors,tags or count.posts.').optional(),
  fields: z.string().min(1).describe('Comma-separated Ghost field list to return.').optional(),
  formats: z.string().min(1).describe('Comma-separated Ghost formats to return, such as html,plaintext.').optional(),
  filter: z.string().min(1).describe('Ghost Content API filter expression.').optional(),
  order: z.string().min(1).describe('Ghost Content API order expression.').optional(),
}).describe('Input for browsing Ghost content resources.')

export const listTagsOutput = z.strictObject({
  tags: z.array(z.looseObject({}).describe('The raw Ghost Content API object.')).describe('The Ghost tags returned by the Content API.').optional(),
  meta: z.looseObject({}).describe('The Ghost Content API pagination metadata.').nullable().optional(),
}).describe('Ghost tags browse response.')

export const getTagInput = z.strictObject({
  id: z.string().min(1).describe('The Ghost resource ID.').optional(),
  slug: z.string().min(1).describe('The Ghost resource slug.').optional(),
  include: z.string().min(1).describe('Comma-separated Ghost include expression, such as authors,tags or count.posts.').optional(),
  fields: z.string().min(1).describe('Comma-separated Ghost field list to return.').optional(),
  formats: z.string().min(1).describe('Comma-separated Ghost formats to return, such as html,plaintext.').optional(),
}).describe('Input for reading one Ghost content resource.')

export const getTagOutput = z.strictObject({
  tag: z.looseObject({}).describe('The raw Ghost Content API object.').nullable().optional(),
}).describe('Ghost tag read response.')

export const listAuthorsInput = z.strictObject({
  limit: z.int().min(1).max(100).describe('The maximum number of resources to request from Ghost.').optional(),
  page: z.int().min(1).describe('The one-based page number to request from Ghost.').optional(),
  include: z.string().min(1).describe('Comma-separated Ghost include expression, such as authors,tags or count.posts.').optional(),
  fields: z.string().min(1).describe('Comma-separated Ghost field list to return.').optional(),
  formats: z.string().min(1).describe('Comma-separated Ghost formats to return, such as html,plaintext.').optional(),
  filter: z.string().min(1).describe('Ghost Content API filter expression.').optional(),
  order: z.string().min(1).describe('Ghost Content API order expression.').optional(),
}).describe('Input for browsing Ghost content resources.')

export const listAuthorsOutput = z.strictObject({
  authors: z.array(z.looseObject({}).describe('The raw Ghost Content API object.')).describe('The Ghost authors returned by the Content API.').optional(),
  meta: z.looseObject({}).describe('The Ghost Content API pagination metadata.').nullable().optional(),
}).describe('Ghost authors browse response.')

export const getAuthorInput = z.strictObject({
  id: z.string().min(1).describe('The Ghost resource ID.').optional(),
  slug: z.string().min(1).describe('The Ghost resource slug.').optional(),
  include: z.string().min(1).describe('Comma-separated Ghost include expression, such as authors,tags or count.posts.').optional(),
  fields: z.string().min(1).describe('Comma-separated Ghost field list to return.').optional(),
  formats: z.string().min(1).describe('Comma-separated Ghost formats to return, such as html,plaintext.').optional(),
}).describe('Input for reading one Ghost content resource.')

export const getAuthorOutput = z.strictObject({
  author: z.looseObject({}).describe('The raw Ghost Content API object.').nullable().optional(),
}).describe('Ghost author read response.')

export const readSettingsInput = z.strictObject({}).describe('No input is required to read Ghost settings.')

export const readSettingsOutput = z.strictObject({
  settings: z.looseObject({}).describe('The raw Ghost settings object.').nullable().optional(),
}).describe('Ghost settings response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const ghostActions = {
  list_posts: {
    description: 'List published posts from the connected Ghost site.',
    effect: 'read',
    inputSchema: listPostsInput,
    outputSchema: z.toJSONSchema(listPostsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_post: {
    description: 'Get one published Ghost post by ID or slug.',
    effect: 'read',
    inputSchema: getPostInput,
    outputSchema: z.toJSONSchema(getPostOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_pages: {
    description: 'List published pages from the connected Ghost site.',
    effect: 'read',
    inputSchema: listPagesInput,
    outputSchema: z.toJSONSchema(listPagesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_page: {
    description: 'Get one published Ghost page by ID or slug.',
    effect: 'read',
    inputSchema: getPageInput,
    outputSchema: z.toJSONSchema(getPageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_tags: {
    description: 'List public tags from the connected Ghost site.',
    effect: 'read',
    inputSchema: listTagsInput,
    outputSchema: z.toJSONSchema(listTagsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_tag: {
    description: 'Get one public Ghost tag by ID or slug.',
    effect: 'read',
    inputSchema: getTagInput,
    outputSchema: z.toJSONSchema(getTagOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_authors: {
    description: 'List public authors from the connected Ghost site.',
    effect: 'read',
    inputSchema: listAuthorsInput,
    outputSchema: z.toJSONSchema(listAuthorsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_author: {
    description: 'Get one public Ghost author by ID or slug.',
    effect: 'read',
    inputSchema: getAuthorInput,
    outputSchema: z.toJSONSchema(getAuthorOutput, { io: 'output', unrepresentable: 'any' }),
  },
  read_settings: {
    description: 'Read public settings for the connected Ghost site.',
    effect: 'read',
    inputSchema: readSettingsInput,
    outputSchema: z.toJSONSchema(readSettingsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
