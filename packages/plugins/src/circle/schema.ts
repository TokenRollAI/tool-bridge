/**
 * Circle 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getCommunityInput = z.strictObject({}).describe('The input payload for getting Circle community details.')

export const getCommunityOutput = z.strictObject({
  community: z.strictObject({
    id: z.int().describe('The Circle community ID.').optional(),
    name: z.string().describe('The Circle community name.').nullable().optional(),
    slug: z.string().describe('The Circle community slug.').nullable().optional(),
    locale: z.string().describe('The Circle community locale.').nullable().optional(),
    is_private: z.boolean().describe('Whether the community is private.').nullable().optional(),
    created_at: z.string().describe('The time when the community was created.').nullable().optional(),
    updated_at: z.string().describe('The time when the community was last updated.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw community object returned by Circle.').optional(),
  }).describe('A normalized Circle community.'),
}).describe('Action output.')

export const listCommunityMembersInput = z.strictObject({
  page: z.int().min(1).describe('The page number to request from Circle.').optional(),
  per_page: z.int().min(1).describe('The number of records to request per page.').optional(),
  status: z.enum(['active', 'inactive', 'all']).describe('The community member status filter.').optional(),
  member_tag_ids: z.array(z.int().min(1).describe('One Circle member tag ID.')).min(1).describe('Member tag IDs used by Circle to filter community members.').optional(),
}).describe('Input parameters for listing Circle community members.')

export const listCommunityMembersOutput = z.strictObject({
  pagination: z.strictObject({
    page: z.int().describe('The current page number returned by Circle.').optional(),
    per_page: z.int().describe('The number of records returned per page.').optional(),
    has_next_page: z.boolean().describe('Whether Circle reports another page after this one.').optional(),
    count: z.int().describe('The total number of records reported by Circle.').optional(),
    page_count: z.int().describe('The total number of pages reported by Circle.').optional(),
  }).describe('Circle pagination metadata.'),
  members: z.array(z.strictObject({
    id: z.int().describe('The Circle community member ID.').optional(),
    user_id: z.int().describe('The Circle user ID associated with the member.').nullable().optional(),
    name: z.string().describe('The member display name.').nullable().optional(),
    first_name: z.string().describe('The member first name.').nullable().optional(),
    last_name: z.string().describe('The member last name.').nullable().optional(),
    email: z.string().describe('The member email address when returned by Circle.').nullable().optional(),
    headline: z.string().describe('The member headline.').nullable().optional(),
    status: z.string().describe('The member status when returned by Circle.').nullable().optional(),
    profile_url: z.string().describe('The member profile URL.').nullable().optional(),
    public_uid: z.string().describe('The public UID for the member.').nullable().optional(),
    avatar_url: z.string().describe('The member avatar URL.').nullable().optional(),
    community_id: z.int().describe('The Circle community ID associated with the member.').nullable().optional(),
    created_at: z.string().describe('The time when the member was created.').nullable().optional(),
    updated_at: z.string().describe('The time when the member was last updated.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw community member object returned by Circle.').optional(),
  }).describe('A normalized Circle community member.')).describe('The community members returned by Circle.'),
}).describe('Action output.')

export const getCommunityMemberInput = z.strictObject({
  id: z.int().min(1).describe('The Circle community member ID.'),
}).describe('Action input.')

export const getCommunityMemberOutput = z.strictObject({
  member: z.strictObject({
    id: z.int().describe('The Circle community member ID.').optional(),
    user_id: z.int().describe('The Circle user ID associated with the member.').nullable().optional(),
    name: z.string().describe('The member display name.').nullable().optional(),
    first_name: z.string().describe('The member first name.').nullable().optional(),
    last_name: z.string().describe('The member last name.').nullable().optional(),
    email: z.string().describe('The member email address when returned by Circle.').nullable().optional(),
    headline: z.string().describe('The member headline.').nullable().optional(),
    status: z.string().describe('The member status when returned by Circle.').nullable().optional(),
    profile_url: z.string().describe('The member profile URL.').nullable().optional(),
    public_uid: z.string().describe('The public UID for the member.').nullable().optional(),
    avatar_url: z.string().describe('The member avatar URL.').nullable().optional(),
    community_id: z.int().describe('The Circle community ID associated with the member.').nullable().optional(),
    created_at: z.string().describe('The time when the member was created.').nullable().optional(),
    updated_at: z.string().describe('The time when the member was last updated.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw community member object returned by Circle.').optional(),
  }).describe('A normalized Circle community member.'),
}).describe('Action output.')

export const listPostsInput = z.strictObject({
  page: z.int().min(1).describe('The page number to request from Circle.').optional(),
  per_page: z.int().min(1).describe('The number of records to request per page.').optional(),
  space_id: z.int().min(1).describe('The Circle basic space ID used to filter posts.').optional(),
  space_group_id: z.int().min(1).describe('The Circle space group ID used to filter posts.').optional(),
  status: z.enum(['draft', 'published', 'scheduled', 'all']).describe('The Circle post status filter.').optional(),
  search_text: z.string().min(1).describe('Text used to search Circle posts.').optional(),
  sort: z.enum(['oldest', 'latest', 'alphabetical', 'likes', 'latest_updated', 'oldest_updated']).describe('The Circle post sort order.').optional(),
}).describe('Input parameters for listing Circle basic posts.')

export const listPostsOutput = z.strictObject({
  pagination: z.strictObject({
    page: z.int().describe('The current page number returned by Circle.').optional(),
    per_page: z.int().describe('The number of records returned per page.').optional(),
    has_next_page: z.boolean().describe('Whether Circle reports another page after this one.').optional(),
    count: z.int().describe('The total number of records reported by Circle.').optional(),
    page_count: z.int().describe('The total number of pages reported by Circle.').optional(),
  }).describe('Circle pagination metadata.'),
  posts: z.array(z.strictObject({
    id: z.int().describe('The Circle post ID.').optional(),
    status: z.string().describe('The Circle post status.').nullable().optional(),
    name: z.string().describe('The post title or name.').nullable().optional(),
    slug: z.string().describe('The post slug.').nullable().optional(),
    url: z.string().describe('The post URL.').nullable().optional(),
    space_id: z.int().describe('The Circle space ID containing the post.').nullable().optional(),
    space_group_id: z.int().describe('The Circle space group ID containing the post.').nullable().optional(),
    user_id: z.int().describe('The Circle user ID for the post author.').nullable().optional(),
    user_email: z.string().describe('The post author email address.').nullable().optional(),
    user_name: z.string().describe('The post author display name.').nullable().optional(),
    comments_count: z.int().describe('The number of comments on the post.').nullable().optional(),
    likes_count: z.int().describe('The number of likes on the post.').nullable().optional(),
    published_at: z.string().describe('The time when the post was published.').nullable().optional(),
    created_at: z.string().describe('The time when the post was created.').nullable().optional(),
    updated_at: z.string().describe('The time when the post was last updated.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw post object returned by Circle.').optional(),
  }).describe('A normalized Circle post.')).describe('The posts returned by Circle.'),
}).describe('Action output.')

export const getPostInput = z.strictObject({
  id: z.int().min(1).describe('The Circle post ID.'),
}).describe('Action input.')

export const getPostOutput = z.strictObject({
  post: z.strictObject({
    id: z.int().describe('The Circle post ID.').optional(),
    status: z.string().describe('The Circle post status.').nullable().optional(),
    name: z.string().describe('The post title or name.').nullable().optional(),
    slug: z.string().describe('The post slug.').nullable().optional(),
    url: z.string().describe('The post URL.').nullable().optional(),
    space_id: z.int().describe('The Circle space ID containing the post.').nullable().optional(),
    space_group_id: z.int().describe('The Circle space group ID containing the post.').nullable().optional(),
    user_id: z.int().describe('The Circle user ID for the post author.').nullable().optional(),
    user_email: z.string().describe('The post author email address.').nullable().optional(),
    user_name: z.string().describe('The post author display name.').nullable().optional(),
    comments_count: z.int().describe('The number of comments on the post.').nullable().optional(),
    likes_count: z.int().describe('The number of likes on the post.').nullable().optional(),
    published_at: z.string().describe('The time when the post was published.').nullable().optional(),
    created_at: z.string().describe('The time when the post was created.').nullable().optional(),
    updated_at: z.string().describe('The time when the post was last updated.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw post object returned by Circle.').optional(),
  }).describe('A normalized Circle post.'),
}).describe('Action output.')

export const listSpaceGroupsInput = z.strictObject({
  page: z.int().min(1).describe('The page number to request from Circle.').optional(),
  per_page: z.int().min(1).describe('The number of records to request per page.').optional(),
  name: z.string().min(1).describe('The space group name filter.').optional(),
}).describe('Input parameters for listing Circle space groups.')

export const listSpaceGroupsOutput = z.strictObject({
  pagination: z.strictObject({
    page: z.int().describe('The current page number returned by Circle.').optional(),
    per_page: z.int().describe('The number of records returned per page.').optional(),
    has_next_page: z.boolean().describe('Whether Circle reports another page after this one.').optional(),
    count: z.int().describe('The total number of records reported by Circle.').optional(),
    page_count: z.int().describe('The total number of pages reported by Circle.').optional(),
  }).describe('Circle pagination metadata.'),
  space_groups: z.array(z.strictObject({
    id: z.int().describe('The Circle space group ID.').optional(),
    name: z.string().describe('The space group name.').nullable().optional(),
    slug: z.string().describe('The space group slug.').nullable().optional(),
    community_id: z.int().describe('The Circle community ID associated with the space group.').nullable().optional(),
    spaces_count: z.int().describe('The number of spaces in the group.').nullable().optional(),
    space_group_members_count: z.int().describe('The number of members in the group.').nullable().optional(),
    is_hidden_from_non_members: z.boolean().describe('Whether the space group is hidden from non-members.').nullable().optional(),
    hide_members_count: z.boolean().describe('Whether Circle hides the member count.').nullable().optional(),
    created_at: z.string().describe('The time when the space group was created.').nullable().optional(),
    updated_at: z.string().describe('The time when the space group was last updated.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw space group object returned by Circle.').optional(),
  }).describe('A normalized Circle space group.')).describe('The space groups returned by Circle.'),
}).describe('Action output.')

export const getSpaceGroupInput = z.strictObject({
  id: z.int().min(1).describe('The Circle space group ID.'),
}).describe('Action input.')

export const getSpaceGroupOutput = z.strictObject({
  space_group: z.strictObject({
    id: z.int().describe('The Circle space group ID.').optional(),
    name: z.string().describe('The space group name.').nullable().optional(),
    slug: z.string().describe('The space group slug.').nullable().optional(),
    community_id: z.int().describe('The Circle community ID associated with the space group.').nullable().optional(),
    spaces_count: z.int().describe('The number of spaces in the group.').nullable().optional(),
    space_group_members_count: z.int().describe('The number of members in the group.').nullable().optional(),
    is_hidden_from_non_members: z.boolean().describe('Whether the space group is hidden from non-members.').nullable().optional(),
    hide_members_count: z.boolean().describe('Whether Circle hides the member count.').nullable().optional(),
    created_at: z.string().describe('The time when the space group was created.').nullable().optional(),
    updated_at: z.string().describe('The time when the space group was last updated.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw space group object returned by Circle.').optional(),
  }).describe('A normalized Circle space group.'),
}).describe('Action output.')

export const listSpaceMembersInput = z.strictObject({
  page: z.int().min(1).describe('The page number to request from Circle.').optional(),
  per_page: z.int().min(1).describe('The number of records to request per page.').optional(),
  space_id: z.int().min(1).describe('The Circle space ID whose members should be listed.'),
  status: z.enum(['active', 'inactive', 'all']).describe('The Circle space member status filter.').optional(),
}).describe('Input parameters for listing Circle space members.')

export const listSpaceMembersOutput = z.strictObject({
  pagination: z.strictObject({
    page: z.int().describe('The current page number returned by Circle.').optional(),
    per_page: z.int().describe('The number of records returned per page.').optional(),
    has_next_page: z.boolean().describe('Whether Circle reports another page after this one.').optional(),
    count: z.int().describe('The total number of records reported by Circle.').optional(),
    page_count: z.int().describe('The total number of pages reported by Circle.').optional(),
  }).describe('Circle pagination metadata.'),
  space_members: z.array(z.strictObject({
    id: z.int().describe('The Circle space member ID.').optional(),
    user_id: z.int().describe('The Circle user ID associated with the space member.').nullable().optional(),
    space_id: z.int().describe('The Circle space ID associated with the membership.').nullable().optional(),
    community_member_id: z.int().describe('The Circle community member ID.').nullable().optional(),
    status: z.string().describe('The space member status.').nullable().optional(),
    access_type: z.string().describe('The access type reported by Circle.').nullable().optional(),
    moderator: z.boolean().describe('Whether the member is a moderator in the space.').nullable().optional(),
    notification_type: z.string().describe('The email notification setting for the space member.').nullable().optional(),
    community_member: z.looseObject({}).describe('The nested community member summary returned with the space membership.').nullable().optional(),
    created_at: z.string().describe('The time when the space membership was created.').nullable().optional(),
    updated_at: z.string().describe('The time when the space membership was last updated.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw space member object returned by Circle.').optional(),
  }).describe('A normalized Circle space member.')).describe('The space members returned by Circle.'),
}).describe('Action output.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const circleActions = {
  get_community: {
    description: 'Get details about the Circle community associated with the current API token.',
    effect: 'read',
    inputSchema: getCommunityInput,
    outputSchema: z.toJSONSchema(getCommunityOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_community_members: {
    description: 'List Circle community members with optional status and tag filters.',
    effect: 'read',
    inputSchema: listCommunityMembersInput,
    outputSchema: z.toJSONSchema(listCommunityMembersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_community_member: {
    description: 'Get a Circle community member by ID.',
    effect: 'read',
    inputSchema: getCommunityMemberInput,
    outputSchema: z.toJSONSchema(getCommunityMemberOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_posts: {
    description: 'List Circle basic posts with optional space, status, search, and sort filters.',
    effect: 'read',
    inputSchema: listPostsInput,
    outputSchema: z.toJSONSchema(listPostsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_post: {
    description: 'Get a Circle basic post by ID.',
    effect: 'read',
    inputSchema: getPostInput,
    outputSchema: z.toJSONSchema(getPostOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_space_groups: {
    description: 'List Circle space groups with optional name filtering.',
    effect: 'read',
    inputSchema: listSpaceGroupsInput,
    outputSchema: z.toJSONSchema(listSpaceGroupsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_space_group: {
    description: 'Get a Circle space group by ID.',
    effect: 'read',
    inputSchema: getSpaceGroupInput,
    outputSchema: z.toJSONSchema(getSpaceGroupOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_space_members: {
    description: 'List Circle members in a specific space.',
    effect: 'read',
    inputSchema: listSpaceMembersInput,
    outputSchema: z.toJSONSchema(listSpaceMembersOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
