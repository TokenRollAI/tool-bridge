/**
 * Shopify REST Admin (Legacy) 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getShopInput = z.strictObject({}).describe('No input is required to retrieve the Shopify shop.')

export const getShopOutput = z.strictObject({
  shop: z.looseObject({
    id: z.int().min(1).describe('The Shopify shop ID.'),
    name: z.string().describe('The shop display name.'),
    myshopify_domain: z.string().describe('The canonical myshopify.com domain for the shop.'),
  }).describe('A Shopify REST shop object.').optional(),
}).describe('The Shopify REST shop response.')

export const listBlogsInput = z.strictObject({
  handle: z.string().min(1).describe('Filter blogs by Shopify blog handle.').optional(),
  since_id: z.int().min(1).describe('Return records with Shopify numeric IDs greater than this value.').optional(),
  limit: z.int().min(1).max(250).describe('The maximum number of records to return. Shopify REST supports values from 1 to 250.').optional(),
  page_info: z.string().min(1).describe('The opaque Shopify REST page_info cursor from a previous response pagination value.').optional(),
}).describe('The input payload for listing Shopify REST blogs.')

export const listBlogsOutput = z.strictObject({
  blogs: z.array(z.looseObject({
    id: z.int().min(1).describe('The Shopify blog ID.'),
    title: z.string().describe('The blog title.'),
    handle: z.string().describe('The blog handle.'),
    commentable: z.string().describe('The blog comment policy returned by Shopify.').nullable(),
    tags: z.string().describe('The comma-separated tags from the 200 most recent articles.').nullable(),
    template_suffix: z.string().describe('The Liquid template suffix used by the blog.').nullable(),
    feedburner: z.string().describe('The FeedBurner identifier when configured.').nullable(),
    feedburner_location: z.string().describe('The FeedBurner URL when configured.').nullable(),
    created_at: z.string().describe('The blog creation timestamp returned by Shopify.').nullable(),
    updated_at: z.string().describe('The blog update timestamp returned by Shopify.').nullable(),
    admin_graphql_api_id: z.string().describe('The Shopify Admin GraphQL ID for the blog.').nullable(),
  }).describe('A Shopify REST blog object.')).describe('Blogs returned by Shopify.').optional(),
  pagination: z.strictObject({
    nextPageInfo: z.string().describe('The page_info cursor for the next page when Shopify returned one.').nullable().optional(),
    previousPageInfo: z.string().describe('The page_info cursor for the previous page when Shopify returned one.').nullable().optional(),
  }).describe('Shopify REST Link-header pagination cursors.').optional(),
  raw: z.looseObject({}).describe('The raw object returned by Shopify REST Admin.').optional(),
}).describe('The Shopify REST blog list response.')

export const getBlogInput = z.strictObject({
  blog_id: z.int().min(1).describe('The Shopify blog ID.').optional(),
}).describe('The input payload for retrieving one Shopify REST blog.')

export const getBlogOutput = z.strictObject({
  blog: z.looseObject({
    id: z.int().min(1).describe('The Shopify blog ID.'),
    title: z.string().describe('The blog title.'),
    handle: z.string().describe('The blog handle.'),
    commentable: z.string().describe('The blog comment policy returned by Shopify.').nullable(),
    tags: z.string().describe('The comma-separated tags from the 200 most recent articles.').nullable(),
    template_suffix: z.string().describe('The Liquid template suffix used by the blog.').nullable(),
    feedburner: z.string().describe('The FeedBurner identifier when configured.').nullable(),
    feedburner_location: z.string().describe('The FeedBurner URL when configured.').nullable(),
    created_at: z.string().describe('The blog creation timestamp returned by Shopify.').nullable(),
    updated_at: z.string().describe('The blog update timestamp returned by Shopify.').nullable(),
    admin_graphql_api_id: z.string().describe('The Shopify Admin GraphQL ID for the blog.').nullable(),
  }).describe('A Shopify REST blog object.').optional(),
}).describe('The Shopify REST blog response.')

export const countBlogsInput = z.strictObject({}).describe('No input is required to count Shopify REST blogs.')

export const countBlogsOutput = z.strictObject({
  count: z.int().min(0).describe('The count returned by Shopify REST Admin.').optional(),
}).describe('The Shopify REST blog count response.')

export const listPagesInput = z.strictObject({
  title: z.string().min(1).describe('Retrieve pages with this exact Shopify page title.').optional(),
  handle: z.string().min(1).describe('Retrieve pages with this Shopify page handle.').optional(),
  published_status: z.enum(['published', 'unpublished', 'any']).describe('The Shopify publication status filter.').optional(),
  since_id: z.int().min(1).describe('Return records with Shopify numeric IDs greater than this value.').optional(),
  created_at_min: z.string().min(1).describe('An ISO 8601 date-time filter accepted by Shopify REST Admin.').optional(),
  created_at_max: z.string().min(1).describe('An ISO 8601 date-time filter accepted by Shopify REST Admin.').optional(),
  updated_at_min: z.string().min(1).describe('An ISO 8601 date-time filter accepted by Shopify REST Admin.').optional(),
  updated_at_max: z.string().min(1).describe('An ISO 8601 date-time filter accepted by Shopify REST Admin.').optional(),
  published_at_min: z.string().min(1).describe('An ISO 8601 date-time filter accepted by Shopify REST Admin.').optional(),
  published_at_max: z.string().min(1).describe('An ISO 8601 date-time filter accepted by Shopify REST Admin.').optional(),
  limit: z.int().min(1).max(250).describe('The maximum number of records to return. Shopify REST supports values from 1 to 250.').optional(),
  page_info: z.string().min(1).describe('The opaque Shopify REST page_info cursor from a previous response pagination value.').optional(),
}).describe('The input payload for listing Shopify REST pages.')

export const listPagesOutput = z.strictObject({
  pages: z.array(z.looseObject({
    id: z.int().min(1).describe('The Shopify page ID.'),
    title: z.string().describe('The page title.'),
    handle: z.string().describe('The page handle.'),
    body_html: z.string().describe('The page body HTML returned by Shopify.').nullable(),
    author: z.string().describe('The page author returned by Shopify.').nullable(),
    published_at: z.string().describe('The page publication timestamp, or null when hidden.').nullable(),
    template_suffix: z.string().describe('The Liquid template suffix used by the page.').nullable(),
    created_at: z.string().describe('The page creation timestamp returned by Shopify.').nullable(),
    updated_at: z.string().describe('The page update timestamp returned by Shopify.').nullable(),
    admin_graphql_api_id: z.string().describe('The Shopify Admin GraphQL ID for the page.').nullable(),
  }).describe('A Shopify REST page object.')).describe('Pages returned by Shopify.').optional(),
  pagination: z.strictObject({
    nextPageInfo: z.string().describe('The page_info cursor for the next page when Shopify returned one.').nullable().optional(),
    previousPageInfo: z.string().describe('The page_info cursor for the previous page when Shopify returned one.').nullable().optional(),
  }).describe('Shopify REST Link-header pagination cursors.').optional(),
  raw: z.looseObject({}).describe('The raw object returned by Shopify REST Admin.').optional(),
}).describe('The Shopify REST page list response.')

export const getPageInput = z.strictObject({
  page_id: z.int().min(1).describe('The Shopify page ID.').optional(),
}).describe('The input payload for retrieving one Shopify REST page.')

export const getPageOutput = z.strictObject({
  page: z.looseObject({
    id: z.int().min(1).describe('The Shopify page ID.'),
    title: z.string().describe('The page title.'),
    handle: z.string().describe('The page handle.'),
    body_html: z.string().describe('The page body HTML returned by Shopify.').nullable(),
    author: z.string().describe('The page author returned by Shopify.').nullable(),
    published_at: z.string().describe('The page publication timestamp, or null when hidden.').nullable(),
    template_suffix: z.string().describe('The Liquid template suffix used by the page.').nullable(),
    created_at: z.string().describe('The page creation timestamp returned by Shopify.').nullable(),
    updated_at: z.string().describe('The page update timestamp returned by Shopify.').nullable(),
    admin_graphql_api_id: z.string().describe('The Shopify Admin GraphQL ID for the page.').nullable(),
  }).describe('A Shopify REST page object.').optional(),
}).describe('The Shopify REST page response.')

export const countPagesInput = z.strictObject({
  title: z.string().min(1).describe('Count pages with this exact Shopify page title.').optional(),
  published_status: z.enum(['published', 'unpublished', 'any']).describe('The Shopify publication status filter.').optional(),
  created_at_min: z.string().min(1).describe('An ISO 8601 date-time filter accepted by Shopify REST Admin.').optional(),
  created_at_max: z.string().min(1).describe('An ISO 8601 date-time filter accepted by Shopify REST Admin.').optional(),
  updated_at_min: z.string().min(1).describe('An ISO 8601 date-time filter accepted by Shopify REST Admin.').optional(),
  updated_at_max: z.string().min(1).describe('An ISO 8601 date-time filter accepted by Shopify REST Admin.').optional(),
  published_at_min: z.string().min(1).describe('An ISO 8601 date-time filter accepted by Shopify REST Admin.').optional(),
  published_at_max: z.string().min(1).describe('An ISO 8601 date-time filter accepted by Shopify REST Admin.').optional(),
}).describe('The input payload for counting Shopify REST pages.')

export const countPagesOutput = z.strictObject({
  count: z.int().min(0).describe('The count returned by Shopify REST Admin.').optional(),
}).describe('The Shopify REST page count response.')

export const listArticlesInput = z.strictObject({
  blog_id: z.int().min(1).describe('The Shopify blog ID.'),
  author: z.string().min(1).describe('Filter articles by author.').optional(),
  handle: z.string().min(1).describe('Retrieve an article with this Shopify article handle.').optional(),
  tag: z.string().min(1).describe('Filter articles by tag.').optional(),
  published_status: z.enum(['published', 'unpublished', 'any']).describe('The Shopify publication status filter.').optional(),
  since_id: z.int().min(1).describe('Return records with Shopify numeric IDs greater than this value.').optional(),
  created_at_min: z.string().min(1).describe('An ISO 8601 date-time filter accepted by Shopify REST Admin.').optional(),
  created_at_max: z.string().min(1).describe('An ISO 8601 date-time filter accepted by Shopify REST Admin.').optional(),
  updated_at_min: z.string().min(1).describe('An ISO 8601 date-time filter accepted by Shopify REST Admin.').optional(),
  updated_at_max: z.string().min(1).describe('An ISO 8601 date-time filter accepted by Shopify REST Admin.').optional(),
  published_at_min: z.string().min(1).describe('An ISO 8601 date-time filter accepted by Shopify REST Admin.').optional(),
  published_at_max: z.string().min(1).describe('An ISO 8601 date-time filter accepted by Shopify REST Admin.').optional(),
  limit: z.int().min(1).max(250).describe('The maximum number of records to return. Shopify REST supports values from 1 to 250.').optional(),
  page_info: z.string().min(1).describe('The opaque Shopify REST page_info cursor from a previous response pagination value.').optional(),
}).describe('The input payload for listing Shopify REST articles.')

export const listArticlesOutput = z.strictObject({
  articles: z.array(z.looseObject({
    id: z.int().min(1).describe('The Shopify article ID.'),
    blog_id: z.int().min(1).describe('The Shopify blog ID that owns the article.'),
    title: z.string().describe('The article title.'),
    handle: z.string().describe('The article handle.'),
    body_html: z.string().describe('The article body HTML returned by Shopify.').nullable(),
    summary_html: z.string().describe('The article summary HTML returned by Shopify.').nullable(),
    author: z.string().describe('The article author returned by Shopify.').nullable(),
    tags: z.string().describe('The comma-separated article tags returned by Shopify.').nullable(),
    published_at: z.string().describe('The article publication timestamp, or null when hidden.').nullable(),
    template_suffix: z.string().describe('The Liquid template suffix used by the article.').nullable(),
    created_at: z.string().describe('The article creation timestamp returned by Shopify.').nullable(),
    updated_at: z.string().describe('The article update timestamp returned by Shopify.').nullable(),
    image: z.looseObject({}).describe('The article image object returned by Shopify.').nullable().optional(),
    admin_graphql_api_id: z.string().describe('The Shopify Admin GraphQL ID for the article.').nullable(),
  }).describe('A Shopify REST article object.')).describe('Articles returned by Shopify.').optional(),
  pagination: z.strictObject({
    nextPageInfo: z.string().describe('The page_info cursor for the next page when Shopify returned one.').nullable().optional(),
    previousPageInfo: z.string().describe('The page_info cursor for the previous page when Shopify returned one.').nullable().optional(),
  }).describe('Shopify REST Link-header pagination cursors.').optional(),
  raw: z.looseObject({}).describe('The raw object returned by Shopify REST Admin.').optional(),
}).describe('The Shopify REST article list response.')

export const getArticleInput = z.strictObject({
  blog_id: z.int().min(1).describe('The Shopify blog ID.').optional(),
  article_id: z.int().min(1).describe('The Shopify article ID.').optional(),
}).describe('The input payload for retrieving one Shopify REST article.')

export const getArticleOutput = z.strictObject({
  article: z.looseObject({
    id: z.int().min(1).describe('The Shopify article ID.'),
    blog_id: z.int().min(1).describe('The Shopify blog ID that owns the article.'),
    title: z.string().describe('The article title.'),
    handle: z.string().describe('The article handle.'),
    body_html: z.string().describe('The article body HTML returned by Shopify.').nullable(),
    summary_html: z.string().describe('The article summary HTML returned by Shopify.').nullable(),
    author: z.string().describe('The article author returned by Shopify.').nullable(),
    tags: z.string().describe('The comma-separated article tags returned by Shopify.').nullable(),
    published_at: z.string().describe('The article publication timestamp, or null when hidden.').nullable(),
    template_suffix: z.string().describe('The Liquid template suffix used by the article.').nullable(),
    created_at: z.string().describe('The article creation timestamp returned by Shopify.').nullable(),
    updated_at: z.string().describe('The article update timestamp returned by Shopify.').nullable(),
    image: z.looseObject({}).describe('The article image object returned by Shopify.').nullable().optional(),
    admin_graphql_api_id: z.string().describe('The Shopify Admin GraphQL ID for the article.').nullable(),
  }).describe('A Shopify REST article object.').optional(),
}).describe('The Shopify REST article response.')

export const countArticlesInput = z.strictObject({
  blog_id: z.int().min(1).describe('The Shopify blog ID.'),
  published_status: z.enum(['published', 'unpublished', 'any']).describe('The Shopify publication status filter.').optional(),
  created_at_min: z.string().min(1).describe('An ISO 8601 date-time filter accepted by Shopify REST Admin.').optional(),
  created_at_max: z.string().min(1).describe('An ISO 8601 date-time filter accepted by Shopify REST Admin.').optional(),
  updated_at_min: z.string().min(1).describe('An ISO 8601 date-time filter accepted by Shopify REST Admin.').optional(),
  updated_at_max: z.string().min(1).describe('An ISO 8601 date-time filter accepted by Shopify REST Admin.').optional(),
  published_at_min: z.string().min(1).describe('An ISO 8601 date-time filter accepted by Shopify REST Admin.').optional(),
  published_at_max: z.string().min(1).describe('An ISO 8601 date-time filter accepted by Shopify REST Admin.').optional(),
}).describe('The input payload for counting Shopify REST articles.')

export const countArticlesOutput = z.strictObject({
  count: z.int().min(0).describe('The count returned by Shopify REST Admin.').optional(),
}).describe('The Shopify REST article count response.')

export const listArticleTagsInput = z.strictObject({
  limit: z.int().min(1).max(250).describe('The maximum number of records to return. Shopify REST supports values from 1 to 250.').optional(),
  popular: z.boolean().describe('Whether Shopify should order tags by popularity.').optional(),
}).describe('The input payload for listing Shopify REST article tags.')

export const listArticleTagsOutput = z.strictObject({
  tags: z.array(z.string().describe('One article tag.')).describe('Article tags returned by Shopify.').optional(),
}).describe('The Shopify REST article tags response.')

export const listBlogArticleTagsInput = z.strictObject({
  blog_id: z.int().min(1).describe('The Shopify blog ID.'),
  limit: z.int().min(1).max(250).describe('The maximum number of records to return. Shopify REST supports values from 1 to 250.').optional(),
  popular: z.boolean().describe('Whether Shopify should order tags by popularity.').optional(),
}).describe('The input payload for listing Shopify REST article tags in one blog.')

export const listBlogArticleTagsOutput = z.strictObject({
  tags: z.array(z.string().describe('One article tag.')).describe('Article tags returned by Shopify.').optional(),
}).describe('The Shopify REST blog article tags response.')

export const listArticleAuthorsInput = z.strictObject({}).describe('No input is required to list Shopify REST article authors.')

export const listArticleAuthorsOutput = z.strictObject({
  authors: z.array(z.string().describe('One article author.')).describe('Article authors returned by Shopify.').optional(),
}).describe('The Shopify REST article authors response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const shopifyActions = {
  get_shop: {
    description: 'Retrieve the connected Shopify REST Admin shop configuration.',
    effect: 'read',
    inputSchema: getShopInput,
    outputSchema: z.toJSONSchema(getShopOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_blogs: {
    description: 'List Shopify REST blogs with optional handle filtering and pagination.',
    effect: 'read',
    inputSchema: listBlogsInput,
    outputSchema: z.toJSONSchema(listBlogsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_blog: {
    description: 'Retrieve one Shopify REST blog by numeric ID.',
    effect: 'read',
    inputSchema: getBlogInput,
    outputSchema: z.toJSONSchema(getBlogOutput, { io: 'output', unrepresentable: 'any' }),
  },
  count_blogs: {
    description: 'Count Shopify REST blogs in the connected shop.',
    effect: 'read',
    inputSchema: countBlogsInput,
    outputSchema: z.toJSONSchema(countBlogsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_pages: {
    description: 'List Shopify REST pages with optional filters and pagination.',
    effect: 'read',
    inputSchema: listPagesInput,
    outputSchema: z.toJSONSchema(listPagesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_page: {
    description: 'Retrieve one Shopify REST page by numeric ID.',
    effect: 'read',
    inputSchema: getPageInput,
    outputSchema: z.toJSONSchema(getPageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  count_pages: {
    description: 'Count Shopify REST pages with optional filters.',
    effect: 'read',
    inputSchema: countPagesInput,
    outputSchema: z.toJSONSchema(countPagesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_articles: {
    description: 'List Shopify REST articles in a blog with optional filters and pagination.',
    effect: 'read',
    inputSchema: listArticlesInput,
    outputSchema: z.toJSONSchema(listArticlesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_article: {
    description: 'Retrieve one Shopify REST article by blog ID and article ID.',
    effect: 'read',
    inputSchema: getArticleInput,
    outputSchema: z.toJSONSchema(getArticleOutput, { io: 'output', unrepresentable: 'any' }),
  },
  count_articles: {
    description: 'Count Shopify REST articles in a blog with optional filters.',
    effect: 'read',
    inputSchema: countArticlesInput,
    outputSchema: z.toJSONSchema(countArticlesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_article_tags: {
    description: 'List Shopify REST article tags across all articles in the connected shop.',
    effect: 'read',
    inputSchema: listArticleTagsInput,
    outputSchema: z.toJSONSchema(listArticleTagsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_blog_article_tags: {
    description: 'List Shopify REST article tags for one blog.',
    effect: 'read',
    inputSchema: listBlogArticleTagsInput,
    outputSchema: z.toJSONSchema(listBlogArticleTagsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_article_authors: {
    description: 'List Shopify REST article authors across the connected shop.',
    effect: 'read',
    inputSchema: listArticleAuthorsInput,
    outputSchema: z.toJSONSchema(listArticleAuthorsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
