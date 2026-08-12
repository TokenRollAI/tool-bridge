/**
 * WordPress 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getCurrentUserInput = z.strictObject({}).describe('The input payload for getting the authenticated WordPress user.')

export const getCurrentUserOutput = z.strictObject({
  user: z.looseObject({
    id: z.int().min(1).describe('The numeric WordPress user ID.'),
    name: z.string().describe('The WordPress user display name.'),
  }).describe('The authenticated WordPress user.').optional(),
}).describe('The response returned when getting the authenticated WordPress user.')

export const listPostsInput = z.strictObject({
  search: z.string().min(1).regex(new RegExp('\\S')).describe('Limit results to resources matching this search string.').optional(),
  page: z.int().min(1).describe('The page number of WordPress results to return.').optional(),
  perPage: z.int().min(1).max(100).describe('The maximum number of WordPress results to return.').optional(),
  order: z.enum(['asc', 'desc']).describe('The sort direction for WordPress list results.').optional(),
  status: z.array(z.enum(['publish', 'future', 'draft', 'pending', 'private']).describe('The WordPress publication status.')).min(1).describe('WordPress statuses to include.').optional(),
  categories: z.array(z.int().min(1).describe('One numeric WordPress resource ID.')).min(1).describe('Category IDs used to filter WordPress posts.').optional(),
  tags: z.array(z.int().min(1).describe('One numeric WordPress resource ID.')).min(1).describe('Tag IDs used to filter WordPress posts.').optional(),
  include: z.array(z.int().min(1).describe('One numeric WordPress resource ID.')).min(1).describe('Post IDs to include in the response.').optional(),
  exclude: z.array(z.int().min(1).describe('One numeric WordPress resource ID.')).min(1).describe('Post IDs to exclude from the response.').optional(),
  author: z.array(z.int().min(1).describe('One numeric WordPress resource ID.')).min(1).describe('Author user IDs used to filter WordPress posts.').optional(),
  slug: z.array(z.string().min(1).regex(new RegExp('\\S')).describe('The WordPress URL slug.')).min(1).describe('Post slugs used to filter WordPress posts.').optional(),
  orderby: z.enum(['author', 'date', 'id', 'include', 'modified', 'parent', 'relevance', 'slug', 'include_slugs', 'title']).describe('The field used to sort WordPress posts or pages.').optional(),
}).describe('Input parameters for listing WordPress posts.')

export const listPostsOutput = z.strictObject({
  posts: z.array(z.looseObject({
    id: z.int().min(1).describe('The numeric WordPress post ID.'),
    slug: z.string().describe('The WordPress post slug.'),
    status: z.string().describe('The WordPress post status.'),
    title: z.looseObject({
      rendered: z.string().describe('The rendered HTML value returned by WordPress.').optional(),
    }).describe('A WordPress rendered object.'),
  }).describe('A WordPress post object.')).describe('The WordPress posts returned by the list request.').optional(),
  pagination: z.strictObject({
    total: z.int().describe('The total number of matching WordPress resources.').nullable().optional(),
    totalPages: z.int().describe('The total number of WordPress result pages.').nullable().optional(),
  }).describe('Pagination metadata returned in WordPress response headers.').optional(),
}).describe('The response returned when listing WordPress posts.')

export const getPostInput = z.strictObject({
  id: z.int().min(1).describe('The numeric WordPress resource ID.').optional(),
}).describe('Input parameters for retrieving one WordPress resource.')

export const getPostOutput = z.strictObject({
  post: z.looseObject({
    id: z.int().min(1).describe('The numeric WordPress post ID.'),
    slug: z.string().describe('The WordPress post slug.'),
    status: z.string().describe('The WordPress post status.'),
    title: z.looseObject({
      rendered: z.string().describe('The rendered HTML value returned by WordPress.').optional(),
    }).describe('A WordPress rendered object.'),
  }).describe('A WordPress post object.').optional(),
}).describe('The response returned when getting a WordPress post.')

export const createPostInput = z.strictObject({
  title: z.string().min(1).regex(new RegExp('\\S')).describe('The post title.').optional(),
  content: z.string().describe('The post content.').optional(),
  excerpt: z.string().describe('The post excerpt.').optional(),
  slug: z.string().min(1).regex(new RegExp('\\S')).describe('The WordPress URL slug.').optional(),
  status: z.enum(['publish', 'future', 'draft', 'pending', 'private']).describe('The WordPress publication status.').optional(),
  categories: z.array(z.int().min(1).describe('One numeric WordPress resource ID.')).min(1).describe('Category IDs assigned to the post.').optional(),
  tags: z.array(z.int().min(1).describe('One numeric WordPress resource ID.')).min(1).describe('Tag IDs assigned to the post.').optional(),
  featuredMedia: z.int().min(1).describe('The featured media attachment ID.').optional(),
  meta: z.looseObject({}).describe('Meta fields to send to WordPress.').optional(),
}).describe('Input fields for creating or updating a WordPress post.')

export const createPostOutput = z.strictObject({
  post: z.looseObject({
    id: z.int().min(1).describe('The numeric WordPress post ID.'),
    slug: z.string().describe('The WordPress post slug.'),
    status: z.string().describe('The WordPress post status.'),
    title: z.looseObject({
      rendered: z.string().describe('The rendered HTML value returned by WordPress.').optional(),
    }).describe('A WordPress rendered object.'),
  }).describe('A WordPress post object.').optional(),
}).describe('The response returned when creating a WordPress post.')

export const updatePostInput = z.strictObject({
  id: z.int().min(1).describe('The numeric WordPress resource ID.'),
  title: z.string().min(1).regex(new RegExp('\\S')).describe('The post title.').optional(),
  content: z.string().describe('The post content.').optional(),
  excerpt: z.string().describe('The post excerpt.').optional(),
  slug: z.string().min(1).regex(new RegExp('\\S')).describe('The WordPress URL slug.').optional(),
  status: z.enum(['publish', 'future', 'draft', 'pending', 'private']).describe('The WordPress publication status.').optional(),
  categories: z.array(z.int().min(1).describe('One numeric WordPress resource ID.')).min(1).describe('Category IDs assigned to the post.').optional(),
  tags: z.array(z.int().min(1).describe('One numeric WordPress resource ID.')).min(1).describe('Tag IDs assigned to the post.').optional(),
  featuredMedia: z.int().min(1).describe('The featured media attachment ID.').optional(),
  meta: z.looseObject({}).describe('Meta fields to send to WordPress.').optional(),
}).describe('Input parameters for updating a WordPress post.')

export const updatePostOutput = z.strictObject({
  post: z.looseObject({
    id: z.int().min(1).describe('The numeric WordPress post ID.'),
    slug: z.string().describe('The WordPress post slug.'),
    status: z.string().describe('The WordPress post status.'),
    title: z.looseObject({
      rendered: z.string().describe('The rendered HTML value returned by WordPress.').optional(),
    }).describe('A WordPress rendered object.'),
  }).describe('A WordPress post object.').optional(),
}).describe('The response returned when updating a WordPress post.')

export const deletePostInput = z.strictObject({
  id: z.int().min(1).describe('The numeric WordPress resource ID.'),
  force: z.boolean().describe('Whether to permanently delete the resource instead of moving it to trash.').optional(),
}).describe('Input parameters for deleting one WordPress resource.')

export const deletePostOutput = z.strictObject({
  deleted: z.boolean().describe('Whether WordPress deleted the resource.').optional(),
  previous: z.looseObject({}).describe('The previous WordPress resource payload when returned.').nullable().optional(),
}).describe('The response returned when deleting a WordPress resource.')

export const listPagesInput = z.strictObject({
  search: z.string().min(1).regex(new RegExp('\\S')).describe('Limit results to resources matching this search string.').optional(),
  page: z.int().min(1).describe('The page number of WordPress results to return.').optional(),
  perPage: z.int().min(1).max(100).describe('The maximum number of WordPress results to return.').optional(),
  order: z.enum(['asc', 'desc']).describe('The sort direction for WordPress list results.').optional(),
  status: z.array(z.enum(['publish', 'future', 'draft', 'pending', 'private']).describe('The WordPress publication status.')).min(1).describe('WordPress statuses to include.').optional(),
  include: z.array(z.int().min(1).describe('One numeric WordPress resource ID.')).min(1).describe('Page IDs to include in the response.').optional(),
  exclude: z.array(z.int().min(1).describe('One numeric WordPress resource ID.')).min(1).describe('Page IDs to exclude from the response.').optional(),
  parent: z.array(z.int().min(1).describe('One numeric WordPress resource ID.')).min(1).describe('Parent page IDs used to filter WordPress pages.').optional(),
  author: z.array(z.int().min(1).describe('One numeric WordPress resource ID.')).min(1).describe('Author user IDs used to filter WordPress pages.').optional(),
  slug: z.array(z.string().min(1).regex(new RegExp('\\S')).describe('The WordPress URL slug.')).min(1).describe('Page slugs used to filter WordPress pages.').optional(),
  orderby: z.enum(['author', 'date', 'id', 'include', 'modified', 'parent', 'relevance', 'slug', 'include_slugs', 'title']).describe('The field used to sort WordPress posts or pages.').optional(),
}).describe('Input parameters for listing WordPress pages.')

export const listPagesOutput = z.strictObject({
  pages: z.array(z.looseObject({
    id: z.int().min(1).describe('The numeric WordPress page ID.'),
    slug: z.string().describe('The WordPress page slug.'),
    status: z.string().describe('The WordPress page status.'),
    title: z.looseObject({
      rendered: z.string().describe('The rendered HTML value returned by WordPress.').optional(),
    }).describe('A WordPress rendered object.'),
  }).describe('A WordPress page object.')).describe('The WordPress pages returned by the list request.').optional(),
  pagination: z.strictObject({
    total: z.int().describe('The total number of matching WordPress resources.').nullable().optional(),
    totalPages: z.int().describe('The total number of WordPress result pages.').nullable().optional(),
  }).describe('Pagination metadata returned in WordPress response headers.').optional(),
}).describe('The response returned when listing WordPress pages.')

export const getPageInput = z.strictObject({
  id: z.int().min(1).describe('The numeric WordPress resource ID.').optional(),
}).describe('Input parameters for retrieving one WordPress resource.')

export const getPageOutput = z.strictObject({
  page: z.looseObject({
    id: z.int().min(1).describe('The numeric WordPress page ID.'),
    slug: z.string().describe('The WordPress page slug.'),
    status: z.string().describe('The WordPress page status.'),
    title: z.looseObject({
      rendered: z.string().describe('The rendered HTML value returned by WordPress.').optional(),
    }).describe('A WordPress rendered object.'),
  }).describe('A WordPress page object.').optional(),
}).describe('The response returned when getting a WordPress page.')

export const createPageInput = z.strictObject({
  title: z.string().min(1).regex(new RegExp('\\S')).describe('The page title.').optional(),
  content: z.string().describe('The page content.').optional(),
  excerpt: z.string().describe('The page excerpt.').optional(),
  slug: z.string().min(1).regex(new RegExp('\\S')).describe('The WordPress URL slug.').optional(),
  status: z.enum(['publish', 'future', 'draft', 'pending', 'private']).describe('The WordPress publication status.').optional(),
  parent: z.int().min(1).describe('The parent page ID.').optional(),
  featuredMedia: z.int().min(1).describe('The featured media attachment ID.').optional(),
  menuOrder: z.int().describe('The page menu order.').optional(),
  meta: z.looseObject({}).describe('Meta fields to send to WordPress.').optional(),
}).describe('Input fields for creating or updating a WordPress page.')

export const createPageOutput = z.strictObject({
  page: z.looseObject({
    id: z.int().min(1).describe('The numeric WordPress page ID.'),
    slug: z.string().describe('The WordPress page slug.'),
    status: z.string().describe('The WordPress page status.'),
    title: z.looseObject({
      rendered: z.string().describe('The rendered HTML value returned by WordPress.').optional(),
    }).describe('A WordPress rendered object.'),
  }).describe('A WordPress page object.').optional(),
}).describe('The response returned when creating a WordPress page.')

export const updatePageInput = z.strictObject({
  id: z.int().min(1).describe('The numeric WordPress resource ID.'),
  title: z.string().min(1).regex(new RegExp('\\S')).describe('The page title.').optional(),
  content: z.string().describe('The page content.').optional(),
  excerpt: z.string().describe('The page excerpt.').optional(),
  slug: z.string().min(1).regex(new RegExp('\\S')).describe('The WordPress URL slug.').optional(),
  status: z.enum(['publish', 'future', 'draft', 'pending', 'private']).describe('The WordPress publication status.').optional(),
  parent: z.int().min(1).describe('The parent page ID.').optional(),
  featuredMedia: z.int().min(1).describe('The featured media attachment ID.').optional(),
  menuOrder: z.int().describe('The page menu order.').optional(),
  meta: z.looseObject({}).describe('Meta fields to send to WordPress.').optional(),
}).describe('Input parameters for updating a WordPress page.')

export const updatePageOutput = z.strictObject({
  page: z.looseObject({
    id: z.int().min(1).describe('The numeric WordPress page ID.'),
    slug: z.string().describe('The WordPress page slug.'),
    status: z.string().describe('The WordPress page status.'),
    title: z.looseObject({
      rendered: z.string().describe('The rendered HTML value returned by WordPress.').optional(),
    }).describe('A WordPress rendered object.'),
  }).describe('A WordPress page object.').optional(),
}).describe('The response returned when updating a WordPress page.')

export const deletePageInput = z.strictObject({
  id: z.int().min(1).describe('The numeric WordPress resource ID.'),
  force: z.boolean().describe('Whether to permanently delete the resource instead of moving it to trash.').optional(),
}).describe('Input parameters for deleting one WordPress resource.')

export const deletePageOutput = z.strictObject({
  deleted: z.boolean().describe('Whether WordPress deleted the resource.').optional(),
  previous: z.looseObject({}).describe('The previous WordPress resource payload when returned.').nullable().optional(),
}).describe('The response returned when deleting a WordPress resource.')

export const listCategoriesInput = z.strictObject({
  search: z.string().min(1).regex(new RegExp('\\S')).describe('Limit results to resources matching this search string.').optional(),
  page: z.int().min(1).describe('The page number of WordPress results to return.').optional(),
  perPage: z.int().min(1).max(100).describe('The maximum number of WordPress results to return.').optional(),
  order: z.enum(['asc', 'desc']).describe('The sort direction for WordPress list results.').optional(),
  include: z.array(z.int().min(1).describe('One numeric WordPress resource ID.')).min(1).describe('Term IDs to include in the response.').optional(),
  exclude: z.array(z.int().min(1).describe('One numeric WordPress resource ID.')).min(1).describe('Term IDs to exclude from the response.').optional(),
  parent: z.int().min(1).describe('Parent term ID used to filter child terms.').optional(),
  slug: z.array(z.string().min(1).regex(new RegExp('\\S')).describe('The WordPress URL slug.')).min(1).describe('Term slugs used to filter WordPress terms.').optional(),
  hideEmpty: z.boolean().describe('Whether to hide terms not assigned to any post.').optional(),
  orderby: z.enum(['id', 'include', 'name', 'slug', 'include_slugs', 'term_group', 'description', 'count']).describe('The field used to sort WordPress terms.').optional(),
}).describe('Input parameters for listing WordPress terms.')

export const listCategoriesOutput = z.strictObject({
  categories: z.array(z.looseObject({
    id: z.int().min(1).describe('The numeric WordPress term ID.'),
    name: z.string().describe('The term display name.'),
    slug: z.string().describe('The WordPress term slug.'),
  }).describe('A WordPress taxonomy term object.')).describe('The WordPress categories returned by the list request.').optional(),
  pagination: z.strictObject({
    total: z.int().describe('The total number of matching WordPress resources.').nullable().optional(),
    totalPages: z.int().describe('The total number of WordPress result pages.').nullable().optional(),
  }).describe('Pagination metadata returned in WordPress response headers.').optional(),
}).describe('The response returned when listing WordPress categories.')

export const createCategoryInput = z.strictObject({
  name: z.string().min(1).regex(new RegExp('\\S')).describe('The term display name.'),
  slug: z.string().min(1).regex(new RegExp('\\S')).describe('The WordPress URL slug.').optional(),
  description: z.string().describe('The term description.').optional(),
  parent: z.int().min(1).describe('The parent term ID.').optional(),
  meta: z.looseObject({}).describe('Meta fields to send to WordPress.').optional(),
}).describe('Input fields for creating a WordPress taxonomy term.')

export const createCategoryOutput = z.strictObject({
  category: z.looseObject({
    id: z.int().min(1).describe('The numeric WordPress term ID.'),
    name: z.string().describe('The term display name.'),
    slug: z.string().describe('The WordPress term slug.'),
  }).describe('A WordPress taxonomy term object.').optional(),
}).describe('The response returned when creating a WordPress category.')

export const listTagsInput = z.strictObject({
  search: z.string().min(1).regex(new RegExp('\\S')).describe('Limit results to resources matching this search string.').optional(),
  page: z.int().min(1).describe('The page number of WordPress results to return.').optional(),
  perPage: z.int().min(1).max(100).describe('The maximum number of WordPress results to return.').optional(),
  order: z.enum(['asc', 'desc']).describe('The sort direction for WordPress list results.').optional(),
  include: z.array(z.int().min(1).describe('One numeric WordPress resource ID.')).min(1).describe('Term IDs to include in the response.').optional(),
  exclude: z.array(z.int().min(1).describe('One numeric WordPress resource ID.')).min(1).describe('Term IDs to exclude from the response.').optional(),
  parent: z.int().min(1).describe('Parent term ID used to filter child terms.').optional(),
  slug: z.array(z.string().min(1).regex(new RegExp('\\S')).describe('The WordPress URL slug.')).min(1).describe('Term slugs used to filter WordPress terms.').optional(),
  hideEmpty: z.boolean().describe('Whether to hide terms not assigned to any post.').optional(),
  orderby: z.enum(['id', 'include', 'name', 'slug', 'include_slugs', 'term_group', 'description', 'count']).describe('The field used to sort WordPress terms.').optional(),
}).describe('Input parameters for listing WordPress terms.')

export const listTagsOutput = z.strictObject({
  tags: z.array(z.looseObject({
    id: z.int().min(1).describe('The numeric WordPress term ID.'),
    name: z.string().describe('The term display name.'),
    slug: z.string().describe('The WordPress term slug.'),
  }).describe('A WordPress taxonomy term object.')).describe('The WordPress tags returned by the list request.').optional(),
  pagination: z.strictObject({
    total: z.int().describe('The total number of matching WordPress resources.').nullable().optional(),
    totalPages: z.int().describe('The total number of WordPress result pages.').nullable().optional(),
  }).describe('Pagination metadata returned in WordPress response headers.').optional(),
}).describe('The response returned when listing WordPress tags.')

export const createTagInput = z.strictObject({
  name: z.string().min(1).regex(new RegExp('\\S')).describe('The term display name.'),
  slug: z.string().min(1).regex(new RegExp('\\S')).describe('The WordPress URL slug.').optional(),
  description: z.string().describe('The term description.').optional(),
  parent: z.int().min(1).describe('The parent term ID.').optional(),
  meta: z.looseObject({}).describe('Meta fields to send to WordPress.').optional(),
}).describe('Input fields for creating a WordPress taxonomy term.')

export const createTagOutput = z.strictObject({
  tag: z.looseObject({
    id: z.int().min(1).describe('The numeric WordPress term ID.'),
    name: z.string().describe('The term display name.'),
    slug: z.string().describe('The WordPress term slug.'),
  }).describe('A WordPress taxonomy term object.').optional(),
}).describe('The response returned when creating a WordPress tag.')

export const listCommentsInput = z.strictObject({
  search: z.string().min(1).regex(new RegExp('\\S')).describe('Limit results to resources matching this search string.').optional(),
  page: z.int().min(1).describe('The page number of WordPress results to return.').optional(),
  perPage: z.int().min(1).max(100).describe('The maximum number of WordPress results to return.').optional(),
  order: z.enum(['asc', 'desc']).describe('The sort direction for WordPress list results.').optional(),
  status: z.array(z.enum(['hold', 'approve', 'approved', 'spam', 'trash']).describe('The WordPress comment status.')).min(1).describe('WordPress comment statuses to include.').optional(),
  post: z.array(z.int().min(1).describe('One numeric WordPress resource ID.')).min(1).describe('Post IDs used to filter comments.').optional(),
  author: z.array(z.int().min(1).describe('One numeric WordPress resource ID.')).min(1).describe('Author user IDs used to filter comments.').optional(),
  parent: z.array(z.int().min(1).describe('One numeric WordPress resource ID.')).min(1).describe('Parent comment IDs used to filter comments.').optional(),
  include: z.array(z.int().min(1).describe('One numeric WordPress resource ID.')).min(1).describe('Comment IDs to include in the response.').optional(),
  exclude: z.array(z.int().min(1).describe('One numeric WordPress resource ID.')).min(1).describe('Comment IDs to exclude from the response.').optional(),
  orderby: z.enum(['date', 'date_gmt', 'id', 'include', 'post', 'parent', 'type']).describe('The field used to sort WordPress comments.').optional(),
}).describe('Input parameters for listing WordPress comments.')

export const listCommentsOutput = z.strictObject({
  comments: z.array(z.looseObject({
    id: z.int().min(1).describe('The numeric WordPress comment ID.'),
    status: z.string().describe('The WordPress comment status.'),
  }).describe('A WordPress comment object.')).describe('The WordPress comments returned by the list request.').optional(),
  pagination: z.strictObject({
    total: z.int().describe('The total number of matching WordPress resources.').nullable().optional(),
    totalPages: z.int().describe('The total number of WordPress result pages.').nullable().optional(),
  }).describe('Pagination metadata returned in WordPress response headers.').optional(),
}).describe('The response returned when listing WordPress comments.')

export const updateCommentInput = z.strictObject({
  id: z.int().min(1).describe('The numeric WordPress resource ID.'),
  content: z.string().describe('The comment content.').optional(),
  status: z.enum(['hold', 'approve', 'approved', 'spam', 'trash']).describe('The WordPress comment status.').optional(),
  authorName: z.string().min(1).describe('The display name for the comment author.').optional(),
  authorEmail: z.email().describe('The email address for the comment author.').optional(),
  authorUrl: z.url().describe('The URL for the comment author.').optional(),
}).describe('Input fields for updating a WordPress comment.')

export const updateCommentOutput = z.strictObject({
  comment: z.looseObject({
    id: z.int().min(1).describe('The numeric WordPress comment ID.'),
    status: z.string().describe('The WordPress comment status.'),
  }).describe('A WordPress comment object.').optional(),
}).describe('The response returned when updating a WordPress comment.')

export const deleteCommentInput = z.strictObject({
  id: z.int().min(1).describe('The numeric WordPress resource ID.'),
  force: z.boolean().describe('Whether to permanently delete the resource instead of moving it to trash.').optional(),
}).describe('Input parameters for deleting one WordPress resource.')

export const deleteCommentOutput = z.strictObject({
  deleted: z.boolean().describe('Whether WordPress deleted the resource.').optional(),
  previous: z.looseObject({}).describe('The previous WordPress resource payload when returned.').nullable().optional(),
}).describe('The response returned when deleting a WordPress resource.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const wordpressActions = {
  get_current_user: {
    description: 'Get the authenticated WordPress user.',
    effect: 'read',
    inputSchema: getCurrentUserInput,
    outputSchema: z.toJSONSchema(getCurrentUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_posts: {
    description: 'List WordPress posts with optional filters and pagination.',
    effect: 'read',
    inputSchema: listPostsInput,
    outputSchema: z.toJSONSchema(listPostsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_post: {
    description: 'Get a WordPress post by ID.',
    effect: 'read',
    inputSchema: getPostInput,
    outputSchema: z.toJSONSchema(getPostOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_post: {
    description: 'Create a WordPress post.',
    effect: 'write',
    inputSchema: createPostInput,
    outputSchema: z.toJSONSchema(createPostOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_post: {
    description: 'Update a WordPress post by ID.',
    effect: 'write',
    inputSchema: updatePostInput,
    outputSchema: z.toJSONSchema(updatePostOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_post: {
    description: 'Delete a WordPress post by ID.',
    effect: 'destructive',
    inputSchema: deletePostInput,
    outputSchema: z.toJSONSchema(deletePostOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_pages: {
    description: 'List WordPress pages with optional filters and pagination.',
    effect: 'read',
    inputSchema: listPagesInput,
    outputSchema: z.toJSONSchema(listPagesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_page: {
    description: 'Get a WordPress page by ID.',
    effect: 'read',
    inputSchema: getPageInput,
    outputSchema: z.toJSONSchema(getPageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_page: {
    description: 'Create a WordPress page.',
    effect: 'write',
    inputSchema: createPageInput,
    outputSchema: z.toJSONSchema(createPageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_page: {
    description: 'Update a WordPress page by ID.',
    effect: 'write',
    inputSchema: updatePageInput,
    outputSchema: z.toJSONSchema(updatePageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_page: {
    description: 'Delete a WordPress page by ID.',
    effect: 'destructive',
    inputSchema: deletePageInput,
    outputSchema: z.toJSONSchema(deletePageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_categories: {
    description: 'List WordPress categories with optional filters and pagination.',
    effect: 'read',
    inputSchema: listCategoriesInput,
    outputSchema: z.toJSONSchema(listCategoriesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_category: {
    description: 'Create a WordPress category.',
    effect: 'write',
    inputSchema: createCategoryInput,
    outputSchema: z.toJSONSchema(createCategoryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_tags: {
    description: 'List WordPress tags with optional filters and pagination.',
    effect: 'read',
    inputSchema: listTagsInput,
    outputSchema: z.toJSONSchema(listTagsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_tag: {
    description: 'Create a WordPress tag.',
    effect: 'write',
    inputSchema: createTagInput,
    outputSchema: z.toJSONSchema(createTagOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_comments: {
    description: 'List WordPress comments with optional filters and pagination.',
    effect: 'read',
    inputSchema: listCommentsInput,
    outputSchema: z.toJSONSchema(listCommentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_comment: {
    description: 'Update a WordPress comment by ID.',
    effect: 'write',
    inputSchema: updateCommentInput,
    outputSchema: z.toJSONSchema(updateCommentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_comment: {
    description: 'Delete a WordPress comment by ID.',
    effect: 'destructive',
    inputSchema: deleteCommentInput,
    outputSchema: z.toJSONSchema(deleteCommentOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
