/**
 * Slab 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getOrganizationInput = z.strictObject({}).describe('No input is required.')

export const getOrganizationOutput = z.strictObject({
  organization: z.looseObject({
    id: z.string().min(1).describe('A Slab GraphQL ID.'),
    name: z.string().describe('The organization name.'),
    host: z.string().describe('The Slab organization host.'),
    insertedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    updatedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
  }).describe('A Slab organization.').optional(),
}).describe('The current Slab organization.')

export const listUsersInput = z.strictObject({
  includeDeactivated: z.boolean().describe('Whether to include deactivated users.').optional(),
}).describe('Input for listing users in the current Slab organization.')

export const listUsersOutput = z.strictObject({
  users: z.array(z.looseObject({
    id: z.string().min(1).describe('A Slab GraphQL ID.'),
    name: z.string().describe('The user\'s display name.'),
    title: z.string().describe('The user\'s title.'),
    email: z.email().describe('The user\'s email address.'),
    description: z.unknown().describe('A JSON value returned by Slab.'),
    type: z.string().describe('The Slab user type.'),
    deactivatedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.').nullable().optional(),
    insertedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    updatedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    avatar: z.looseObject({
      original: z.string().describe('The original image URL.').nullable().optional(),
      thumb: z.string().describe('The thumbnail image URL.').nullable().optional(),
      preset: z.string().describe('The preset image URL.').nullable().optional(),
    }).describe('A Slab image object.').nullable().optional(),
  }).describe('A Slab user.')).describe('Users returned by Slab.').optional(),
}).describe('A list of Slab users.')

export const getUserInput = z.strictObject({
  id: z.string().min(1).describe('A Slab GraphQL ID.').optional(),
}).describe('Input containing one Slab ID.')

export const getUserOutput = z.strictObject({
  user: z.looseObject({
    id: z.string().min(1).describe('A Slab GraphQL ID.'),
    name: z.string().describe('The user\'s display name.'),
    title: z.string().describe('The user\'s title.'),
    email: z.email().describe('The user\'s email address.'),
    description: z.unknown().describe('A JSON value returned by Slab.'),
    type: z.string().describe('The Slab user type.'),
    deactivatedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.').nullable().optional(),
    insertedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    updatedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    avatar: z.looseObject({
      original: z.string().describe('The original image URL.').nullable().optional(),
      thumb: z.string().describe('The thumbnail image URL.').nullable().optional(),
      preset: z.string().describe('The preset image URL.').nullable().optional(),
    }).describe('A Slab image object.').nullable().optional(),
  }).describe('A Slab user.').optional(),
}).describe('A Slab user lookup result.')

export const getPostInput = z.strictObject({
  id: z.string().min(1).describe('A Slab GraphQL ID.').optional(),
}).describe('Input containing one Slab ID.')

export const getPostOutput = z.strictObject({
  post: z.looseObject({
    id: z.string().min(1).describe('A Slab GraphQL ID.'),
    linkAccess: z.enum(['INTERNAL', 'INTERNAL_VIEW', 'PUBLIC', 'PUBLIC_EDIT', 'DISABLED']).describe('The Slab post link access mode.'),
    archivedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.').nullable().optional(),
    publishedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.').nullable().optional(),
    title: z.string().describe('The post title.'),
    insertedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    content: z.unknown().describe('A JSON value returned by Slab.'),
    updatedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    version: z.int().describe('The Slab post version.'),
    owner: z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The user\'s display name.'),
      email: z.email().describe('The user\'s email address.').optional(),
    }).describe('A compact Slab user reference.'),
    topics: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.')).describe('Topics attached to the post.'),
  }).describe('A Slab post.').optional(),
}).describe('A Slab post result.')

export const getPostsInput = z.strictObject({
  ids: z.array(z.string().min(1).describe('A Slab GraphQL ID.')).min(1).max(100).describe('The Slab IDs to retrieve. Slab accepts between 1 and 100 IDs.').optional(),
}).describe('Input containing one or more Slab IDs.')

export const getPostsOutput = z.strictObject({
  posts: z.array(z.looseObject({
    id: z.string().min(1).describe('A Slab GraphQL ID.'),
    linkAccess: z.enum(['INTERNAL', 'INTERNAL_VIEW', 'PUBLIC', 'PUBLIC_EDIT', 'DISABLED']).describe('The Slab post link access mode.'),
    archivedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.').nullable().optional(),
    publishedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.').nullable().optional(),
    title: z.string().describe('The post title.'),
    insertedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    content: z.unknown().describe('A JSON value returned by Slab.'),
    updatedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    version: z.int().describe('The Slab post version.'),
    owner: z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The user\'s display name.'),
      email: z.email().describe('The user\'s email address.').optional(),
    }).describe('A compact Slab user reference.'),
    topics: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.')).describe('Topics attached to the post.'),
  }).describe('A Slab post.')).describe('Posts returned by Slab.').optional(),
}).describe('A list of Slab posts.')

export const createPostInput = z.strictObject({
  title: z.string().min(1).describe('The new post title.').optional(),
  topicId: z.string().min(1).describe('A Slab GraphQL ID.').optional(),
  templateId: z.string().min(1).describe('A Slab GraphQL ID.').optional(),
}).describe('Input for creating a blank Slab post.')

export const createPostOutput = z.strictObject({
  post: z.looseObject({
    id: z.string().min(1).describe('A Slab GraphQL ID.'),
    linkAccess: z.enum(['INTERNAL', 'INTERNAL_VIEW', 'PUBLIC', 'PUBLIC_EDIT', 'DISABLED']).describe('The Slab post link access mode.'),
    archivedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.').nullable().optional(),
    publishedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.').nullable().optional(),
    title: z.string().describe('The post title.'),
    insertedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    content: z.unknown().describe('A JSON value returned by Slab.'),
    updatedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    version: z.int().describe('The Slab post version.'),
    owner: z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The user\'s display name.'),
      email: z.email().describe('The user\'s email address.').optional(),
    }).describe('A compact Slab user reference.'),
    topics: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.')).describe('Topics attached to the post.'),
  }).describe('A Slab post.').optional(),
}).describe('A Slab post result.')

export const updatePostInput = z.strictObject({
  id: z.string().min(1).describe('A Slab GraphQL ID.'),
  ownerId: z.string().min(1).describe('A Slab GraphQL ID.').optional(),
  archived: z.boolean().describe('Whether the post should be archived.').optional(),
  published: z.boolean().describe('Whether the post should be published.').optional(),
  linkAccess: z.enum(['INTERNAL', 'INTERNAL_VIEW', 'PUBLIC', 'PUBLIC_EDIT', 'DISABLED']).describe('The Slab post link access mode.').optional(),
  bannerUrl: z.url().describe('The post banner image URL.').optional(),
}).describe('Input for updating a Slab post.')

export const updatePostOutput = z.strictObject({
  post: z.looseObject({
    id: z.string().min(1).describe('A Slab GraphQL ID.'),
    linkAccess: z.enum(['INTERNAL', 'INTERNAL_VIEW', 'PUBLIC', 'PUBLIC_EDIT', 'DISABLED']).describe('The Slab post link access mode.'),
    archivedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.').nullable().optional(),
    publishedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.').nullable().optional(),
    title: z.string().describe('The post title.'),
    insertedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    content: z.unknown().describe('A JSON value returned by Slab.'),
    updatedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    version: z.int().describe('The Slab post version.'),
    owner: z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The user\'s display name.'),
      email: z.email().describe('The user\'s email address.').optional(),
    }).describe('A compact Slab user reference.'),
    topics: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.')).describe('Topics attached to the post.'),
  }).describe('A Slab post.').optional(),
}).describe('A Slab post result.')

export const syncPostInput = z.strictObject({
  externalId: z.string().min(1).describe('A Slab GraphQL ID.'),
  format: z.enum(['HTML', 'MARKDOWN']).describe('The content format for a synced Slab post.'),
  content: z.string().min(1).describe('The HTML or Markdown content to sync into Slab.'),
  editUrl: z.url().describe('The external edit URL for the source content.').optional(),
  readUrl: z.url().describe('The external read URL for the source content.').optional(),
}).describe('Input for creating or updating a Slab post from external content.')

export const syncPostOutput = z.strictObject({
  post: z.looseObject({
    id: z.string().min(1).describe('A Slab GraphQL ID.'),
    linkAccess: z.enum(['INTERNAL', 'INTERNAL_VIEW', 'PUBLIC', 'PUBLIC_EDIT', 'DISABLED']).describe('The Slab post link access mode.'),
    archivedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.').nullable().optional(),
    publishedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.').nullable().optional(),
    title: z.string().describe('The post title.'),
    insertedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    content: z.unknown().describe('A JSON value returned by Slab.'),
    updatedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    version: z.int().describe('The Slab post version.'),
    owner: z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The user\'s display name.'),
      email: z.email().describe('The user\'s email address.').optional(),
    }).describe('A compact Slab user reference.'),
    topics: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.')).describe('Topics attached to the post.'),
  }).describe('A Slab post.').optional(),
}).describe('A Slab post result.')

export const deletePostInput = z.strictObject({
  id: z.string().min(1).describe('A Slab GraphQL ID.').optional(),
}).describe('Input containing one Slab ID.')

export const deletePostOutput = z.strictObject({
  post: z.looseObject({
    id: z.string().min(1).describe('A Slab GraphQL ID.'),
    linkAccess: z.enum(['INTERNAL', 'INTERNAL_VIEW', 'PUBLIC', 'PUBLIC_EDIT', 'DISABLED']).describe('The Slab post link access mode.'),
    archivedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.').nullable().optional(),
    publishedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.').nullable().optional(),
    title: z.string().describe('The post title.'),
    insertedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    content: z.unknown().describe('A JSON value returned by Slab.'),
    updatedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    version: z.int().describe('The Slab post version.'),
    owner: z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The user\'s display name.'),
      email: z.email().describe('The user\'s email address.').optional(),
    }).describe('A compact Slab user reference.'),
    topics: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.')).describe('Topics attached to the post.'),
  }).describe('A Slab post.').optional(),
}).describe('A Slab post result.')

export const getTopicInput = z.strictObject({
  id: z.string().min(1).describe('A Slab GraphQL ID.').optional(),
}).describe('Input containing one Slab ID.')

export const getTopicOutput = z.strictObject({
  topic: z.looseObject({
    id: z.string().min(1).describe('A Slab GraphQL ID.'),
    name: z.string().describe('The topic name.'),
    description: z.unknown().describe('A JSON value returned by Slab.'),
    insertedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    updatedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.'),
    memberEditable: z.enum(['ALL', 'POST', 'NONE']).describe('The Slab topic member editability mode.'),
    inheritParent: z.boolean().describe('Whether the topic inherits members and owners from its parent.'),
    hierarchy: z.array(z.string().min(1).describe('A Slab GraphQL ID.')).describe('The topic hierarchy IDs.').nullable().optional(),
    parent: z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.').nullable().optional(),
    ancestors: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.')).describe('Topic ancestors from the Slab hierarchy.').optional(),
    children: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.')).describe('Child topics under this topic.').optional(),
    owners: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The user\'s display name.'),
      email: z.email().describe('The user\'s email address.').optional(),
    }).describe('A compact Slab user reference.')).describe('Topic owner users.').optional(),
    members: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The user\'s display name.'),
      email: z.email().describe('The user\'s email address.').optional(),
    }).describe('A compact Slab user reference.')).describe('Topic member users.').optional(),
  }).describe('A Slab topic.').optional(),
}).describe('A Slab topic result.')

export const getTopicsInput = z.strictObject({
  ids: z.array(z.string().min(1).describe('A Slab GraphQL ID.')).min(1).max(100).describe('The Slab IDs to retrieve. Slab accepts between 1 and 100 IDs.').optional(),
}).describe('Input containing one or more Slab IDs.')

export const getTopicsOutput = z.strictObject({
  topics: z.array(z.looseObject({
    id: z.string().min(1).describe('A Slab GraphQL ID.'),
    name: z.string().describe('The topic name.'),
    description: z.unknown().describe('A JSON value returned by Slab.'),
    insertedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    updatedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.'),
    memberEditable: z.enum(['ALL', 'POST', 'NONE']).describe('The Slab topic member editability mode.'),
    inheritParent: z.boolean().describe('Whether the topic inherits members and owners from its parent.'),
    hierarchy: z.array(z.string().min(1).describe('A Slab GraphQL ID.')).describe('The topic hierarchy IDs.').nullable().optional(),
    parent: z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.').nullable().optional(),
    ancestors: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.')).describe('Topic ancestors from the Slab hierarchy.').optional(),
    children: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.')).describe('Child topics under this topic.').optional(),
    owners: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The user\'s display name.'),
      email: z.email().describe('The user\'s email address.').optional(),
    }).describe('A compact Slab user reference.')).describe('Topic owner users.').optional(),
    members: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The user\'s display name.'),
      email: z.email().describe('The user\'s email address.').optional(),
    }).describe('A compact Slab user reference.')).describe('Topic member users.').optional(),
  }).describe('A Slab topic.')).describe('Topics returned by Slab.').optional(),
}).describe('A list of Slab topics.')

export const createTopicInput = z.strictObject({
  name: z.string().min(1).describe('The topic name.'),
  description: z.unknown().describe('A JSON value returned by Slab.').optional(),
  parentId: z.string().min(1).describe('A Slab GraphQL ID.').optional(),
  memberEditable: z.enum(['ALL', 'POST', 'NONE']).describe('The Slab topic member editability mode.').optional(),
  privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
  inheritParent: z.boolean().describe('Whether to inherit parent topic owners and members.').optional(),
}).describe('Input for creating a Slab topic.')

export const createTopicOutput = z.strictObject({
  topic: z.looseObject({
    id: z.string().min(1).describe('A Slab GraphQL ID.'),
    name: z.string().describe('The topic name.'),
    description: z.unknown().describe('A JSON value returned by Slab.'),
    insertedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    updatedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.'),
    memberEditable: z.enum(['ALL', 'POST', 'NONE']).describe('The Slab topic member editability mode.'),
    inheritParent: z.boolean().describe('Whether the topic inherits members and owners from its parent.'),
    hierarchy: z.array(z.string().min(1).describe('A Slab GraphQL ID.')).describe('The topic hierarchy IDs.').nullable().optional(),
    parent: z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.').nullable().optional(),
    ancestors: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.')).describe('Topic ancestors from the Slab hierarchy.').optional(),
    children: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.')).describe('Child topics under this topic.').optional(),
    owners: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The user\'s display name.'),
      email: z.email().describe('The user\'s email address.').optional(),
    }).describe('A compact Slab user reference.')).describe('Topic owner users.').optional(),
    members: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The user\'s display name.'),
      email: z.email().describe('The user\'s email address.').optional(),
    }).describe('A compact Slab user reference.')).describe('Topic member users.').optional(),
  }).describe('A Slab topic.').optional(),
}).describe('A Slab topic result.')

export const updateTopicInput = z.strictObject({
  id: z.string().min(1).describe('A Slab GraphQL ID.'),
  name: z.string().min(1).describe('The topic name.').optional(),
  description: z.unknown().describe('A JSON value returned by Slab.').optional(),
  parentId: z.string().min(1).describe('A Slab GraphQL ID.').optional(),
  memberEditable: z.enum(['ALL', 'POST', 'NONE']).describe('The Slab topic member editability mode.').optional(),
  privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
  bannerUrl: z.url().describe('The topic banner image URL.').optional(),
  inheritParent: z.boolean().describe('Whether to inherit parent topic owners and members.').optional(),
  propagatePrivacy: z.boolean().describe('Whether privacy changes should propagate to subtopics.').optional(),
}).describe('Input for updating a Slab topic.')

export const updateTopicOutput = z.strictObject({
  topic: z.looseObject({
    id: z.string().min(1).describe('A Slab GraphQL ID.'),
    name: z.string().describe('The topic name.'),
    description: z.unknown().describe('A JSON value returned by Slab.'),
    insertedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    updatedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.'),
    memberEditable: z.enum(['ALL', 'POST', 'NONE']).describe('The Slab topic member editability mode.'),
    inheritParent: z.boolean().describe('Whether the topic inherits members and owners from its parent.'),
    hierarchy: z.array(z.string().min(1).describe('A Slab GraphQL ID.')).describe('The topic hierarchy IDs.').nullable().optional(),
    parent: z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.').nullable().optional(),
    ancestors: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.')).describe('Topic ancestors from the Slab hierarchy.').optional(),
    children: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.')).describe('Child topics under this topic.').optional(),
    owners: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The user\'s display name.'),
      email: z.email().describe('The user\'s email address.').optional(),
    }).describe('A compact Slab user reference.')).describe('Topic owner users.').optional(),
    members: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The user\'s display name.'),
      email: z.email().describe('The user\'s email address.').optional(),
    }).describe('A compact Slab user reference.')).describe('Topic member users.').optional(),
  }).describe('A Slab topic.').optional(),
}).describe('A Slab topic result.')

export const deleteTopicInput = z.strictObject({
  id: z.string().min(1).describe('A Slab GraphQL ID.').optional(),
}).describe('Input containing one Slab ID.')

export const deleteTopicOutput = z.strictObject({
  topic: z.looseObject({
    id: z.string().min(1).describe('A Slab GraphQL ID.'),
    name: z.string().describe('The topic name.'),
    description: z.unknown().describe('A JSON value returned by Slab.'),
    insertedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    updatedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.'),
    memberEditable: z.enum(['ALL', 'POST', 'NONE']).describe('The Slab topic member editability mode.'),
    inheritParent: z.boolean().describe('Whether the topic inherits members and owners from its parent.'),
    hierarchy: z.array(z.string().min(1).describe('A Slab GraphQL ID.')).describe('The topic hierarchy IDs.').nullable().optional(),
    parent: z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.').nullable().optional(),
    ancestors: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.')).describe('Topic ancestors from the Slab hierarchy.').optional(),
    children: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.')).describe('Child topics under this topic.').optional(),
    owners: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The user\'s display name.'),
      email: z.email().describe('The user\'s email address.').optional(),
    }).describe('A compact Slab user reference.')).describe('Topic owner users.').optional(),
    members: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The user\'s display name.'),
      email: z.email().describe('The user\'s email address.').optional(),
    }).describe('A compact Slab user reference.')).describe('Topic member users.').optional(),
  }).describe('A Slab topic.').optional(),
}).describe('A Slab topic result.')

export const addTopicToPostInput = z.strictObject({
  postId: z.string().min(1).describe('A Slab GraphQL ID.').optional(),
  topicId: z.string().min(1).describe('A Slab GraphQL ID.').optional(),
}).describe('Input for changing a post-topic relationship.')

export const addTopicToPostOutput = z.strictObject({
  topic: z.looseObject({
    id: z.string().min(1).describe('A Slab GraphQL ID.'),
    name: z.string().describe('The topic name.'),
    description: z.unknown().describe('A JSON value returned by Slab.'),
    insertedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    updatedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.'),
    memberEditable: z.enum(['ALL', 'POST', 'NONE']).describe('The Slab topic member editability mode.'),
    inheritParent: z.boolean().describe('Whether the topic inherits members and owners from its parent.'),
    hierarchy: z.array(z.string().min(1).describe('A Slab GraphQL ID.')).describe('The topic hierarchy IDs.').nullable().optional(),
    parent: z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.').nullable().optional(),
    ancestors: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.')).describe('Topic ancestors from the Slab hierarchy.').optional(),
    children: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.')).describe('Child topics under this topic.').optional(),
    owners: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The user\'s display name.'),
      email: z.email().describe('The user\'s email address.').optional(),
    }).describe('A compact Slab user reference.')).describe('Topic owner users.').optional(),
    members: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The user\'s display name.'),
      email: z.email().describe('The user\'s email address.').optional(),
    }).describe('A compact Slab user reference.')).describe('Topic member users.').optional(),
  }).describe('A Slab topic.').optional(),
}).describe('A Slab topic result.')

export const removeTopicFromPostInput = z.strictObject({
  postId: z.string().min(1).describe('A Slab GraphQL ID.').optional(),
  topicId: z.string().min(1).describe('A Slab GraphQL ID.').optional(),
}).describe('Input for changing a post-topic relationship.')

export const removeTopicFromPostOutput = z.strictObject({
  topic: z.looseObject({
    id: z.string().min(1).describe('A Slab GraphQL ID.'),
    name: z.string().describe('The topic name.'),
    description: z.unknown().describe('A JSON value returned by Slab.'),
    insertedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    updatedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
    privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.'),
    memberEditable: z.enum(['ALL', 'POST', 'NONE']).describe('The Slab topic member editability mode.'),
    inheritParent: z.boolean().describe('Whether the topic inherits members and owners from its parent.'),
    hierarchy: z.array(z.string().min(1).describe('A Slab GraphQL ID.')).describe('The topic hierarchy IDs.').nullable().optional(),
    parent: z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.').nullable().optional(),
    ancestors: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.')).describe('Topic ancestors from the Slab hierarchy.').optional(),
    children: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
    }).describe('A compact Slab topic reference.')).describe('Child topics under this topic.').optional(),
    owners: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The user\'s display name.'),
      email: z.email().describe('The user\'s email address.').optional(),
    }).describe('A compact Slab user reference.')).describe('Topic owner users.').optional(),
    members: z.array(z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The user\'s display name.'),
      email: z.email().describe('The user\'s email address.').optional(),
    }).describe('A compact Slab user reference.')).describe('Topic member users.').optional(),
  }).describe('A Slab topic.').optional(),
}).describe('A Slab topic result.')

export const searchInput = z.strictObject({
  query: z.string().min(1).describe('The Slab search query.'),
  types: z.array(z.enum(['POST', 'COMMENT', 'TOPIC', 'USER']).describe('The Slab search result type to include.')).min(1).describe('Search result types to include.').optional(),
  first: z.int().describe('The number of results to return after the cursor.').optional(),
  after: z.string().min(1).describe('The cursor after which to return results.').optional(),
  last: z.int().describe('The number of results to return before the cursor.').optional(),
  before: z.string().min(1).describe('The cursor before which to return results.').optional(),
}).describe('Input for searching Slab content.')

export const searchOutput = z.strictObject({
  results: z.array(z.looseObject({
    type: z.enum(['POST', 'COMMENT', 'TOPIC', 'USER']).describe('The normalized search result type.').optional(),
    cursor: z.string().describe('The pagination cursor for this result.').optional(),
    title: z.string().describe('The highlighted or fallback result title.').optional(),
    content: z.unknown().describe('A JSON value returned by Slab.').nullable().optional(),
    highlight: z.unknown().describe('A JSON value returned by Slab.').nullable().optional(),
    post: z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      linkAccess: z.enum(['INTERNAL', 'INTERNAL_VIEW', 'PUBLIC', 'PUBLIC_EDIT', 'DISABLED']).describe('The Slab post link access mode.'),
      archivedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.').nullable().optional(),
      publishedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.').nullable().optional(),
      title: z.string().describe('The post title.'),
      insertedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
      content: z.unknown().describe('A JSON value returned by Slab.'),
      updatedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
      version: z.int().describe('The Slab post version.'),
      owner: z.looseObject({
        id: z.string().min(1).describe('A Slab GraphQL ID.'),
        name: z.string().describe('The user\'s display name.'),
        email: z.email().describe('The user\'s email address.').optional(),
      }).describe('A compact Slab user reference.'),
      topics: z.array(z.looseObject({
        id: z.string().min(1).describe('A Slab GraphQL ID.'),
        name: z.string().describe('The topic name.'),
        privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
      }).describe('A compact Slab topic reference.')).describe('Topics attached to the post.'),
    }).describe('A Slab post.').optional(),
    topic: z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The topic name.'),
      description: z.unknown().describe('A JSON value returned by Slab.'),
      insertedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
      updatedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
      privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.'),
      memberEditable: z.enum(['ALL', 'POST', 'NONE']).describe('The Slab topic member editability mode.'),
      inheritParent: z.boolean().describe('Whether the topic inherits members and owners from its parent.'),
      hierarchy: z.array(z.string().min(1).describe('A Slab GraphQL ID.')).describe('The topic hierarchy IDs.').nullable().optional(),
      parent: z.looseObject({
        id: z.string().min(1).describe('A Slab GraphQL ID.'),
        name: z.string().describe('The topic name.'),
        privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
      }).describe('A compact Slab topic reference.').nullable().optional(),
      ancestors: z.array(z.looseObject({
        id: z.string().min(1).describe('A Slab GraphQL ID.'),
        name: z.string().describe('The topic name.'),
        privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
      }).describe('A compact Slab topic reference.')).describe('Topic ancestors from the Slab hierarchy.').optional(),
      children: z.array(z.looseObject({
        id: z.string().min(1).describe('A Slab GraphQL ID.'),
        name: z.string().describe('The topic name.'),
        privacy: z.enum(['OPEN', 'PRIVATE', 'SECRET', 'PUBLIC']).describe('The Slab topic privacy mode.').optional(),
      }).describe('A compact Slab topic reference.')).describe('Child topics under this topic.').optional(),
      owners: z.array(z.looseObject({
        id: z.string().min(1).describe('A Slab GraphQL ID.'),
        name: z.string().describe('The user\'s display name.'),
        email: z.email().describe('The user\'s email address.').optional(),
      }).describe('A compact Slab user reference.')).describe('Topic owner users.').optional(),
      members: z.array(z.looseObject({
        id: z.string().min(1).describe('A Slab GraphQL ID.'),
        name: z.string().describe('The user\'s display name.'),
        email: z.email().describe('The user\'s email address.').optional(),
      }).describe('A compact Slab user reference.')).describe('Topic member users.').optional(),
    }).describe('A Slab topic.').optional(),
    user: z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      name: z.string().describe('The user\'s display name.'),
      title: z.string().describe('The user\'s title.'),
      email: z.email().describe('The user\'s email address.'),
      description: z.unknown().describe('A JSON value returned by Slab.'),
      type: z.string().describe('The Slab user type.'),
      deactivatedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.').nullable().optional(),
      insertedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
      updatedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
      avatar: z.looseObject({
        original: z.string().describe('The original image URL.').nullable().optional(),
        thumb: z.string().describe('The thumbnail image URL.').nullable().optional(),
        preset: z.string().describe('The preset image URL.').nullable().optional(),
      }).describe('A Slab image object.').nullable().optional(),
    }).describe('A Slab user.').optional(),
    comment: z.looseObject({
      id: z.string().min(1).describe('A Slab GraphQL ID.'),
      content: z.unknown().describe('A JSON value returned by Slab.'),
      insertedAt: z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp returned by Slab.'),
      author: z.looseObject({
        id: z.string().min(1).describe('A Slab GraphQL ID.'),
        name: z.string().describe('The user\'s display name.'),
        email: z.email().describe('The user\'s email address.').optional(),
      }).describe('A compact Slab user reference.'),
    }).describe('A Slab comment.').optional(),
  }).describe('A Slab search result.')).describe('Search results returned by Slab.').optional(),
  pageInfo: z.strictObject({
    hasPreviousPage: z.boolean().describe('Whether another page exists before this page.').optional(),
    hasNextPage: z.boolean().describe('Whether another page exists after this page.').optional(),
    startCursor: z.string().describe('The cursor for the first edge in this page.').nullable().optional(),
    endCursor: z.string().describe('The cursor for the last edge in this page.').nullable().optional(),
  }).describe('Slab cursor pagination metadata.').optional(),
}).describe('A page of Slab search results.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const slabActions = {
  get_organization: {
    description: 'Get the current Slab organization visible to the API token.',
    effect: 'read',
    inputSchema: getOrganizationInput,
    outputSchema: z.toJSONSchema(getOrganizationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_users: {
    description: 'List users in the current Slab organization.',
    effect: 'read',
    inputSchema: listUsersInput,
    outputSchema: z.toJSONSchema(listUsersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_user: {
    description: 'Get one Slab user by ID.',
    effect: 'read',
    inputSchema: getUserInput,
    outputSchema: z.toJSONSchema(getUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_post: {
    description: 'Get one Slab post by ID.',
    effect: 'read',
    inputSchema: getPostInput,
    outputSchema: z.toJSONSchema(getPostOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_posts: {
    description: 'Get multiple Slab posts by ID.',
    effect: 'read',
    inputSchema: getPostsInput,
    outputSchema: z.toJSONSchema(getPostsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_post: {
    description: 'Create a blank Slab post, optionally in a topic or from a template.',
    effect: 'write',
    inputSchema: createPostInput,
    outputSchema: z.toJSONSchema(createPostOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_post: {
    description: 'Update Slab post metadata such as owner, publication state, link access, or banner.',
    effect: 'write',
    inputSchema: updatePostInput,
    outputSchema: z.toJSONSchema(updatePostOutput, { io: 'output', unrepresentable: 'any' }),
  },
  sync_post: {
    description: 'Create or update a readonly Slab copy of external HTML or Markdown content.',
    effect: 'write',
    inputSchema: syncPostInput,
    outputSchema: z.toJSONSchema(syncPostOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_post: {
    description: 'Delete a Slab post by ID.',
    effect: 'destructive',
    inputSchema: deletePostInput,
    outputSchema: z.toJSONSchema(deletePostOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_topic: {
    description: 'Get one Slab topic by ID.',
    effect: 'read',
    inputSchema: getTopicInput,
    outputSchema: z.toJSONSchema(getTopicOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_topics: {
    description: 'Get multiple Slab topics by ID.',
    effect: 'read',
    inputSchema: getTopicsInput,
    outputSchema: z.toJSONSchema(getTopicsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_topic: {
    description: 'Create a Slab topic.',
    effect: 'write',
    inputSchema: createTopicInput,
    outputSchema: z.toJSONSchema(createTopicOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_topic: {
    description: 'Update a Slab topic.',
    effect: 'write',
    inputSchema: updateTopicInput,
    outputSchema: z.toJSONSchema(updateTopicOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_topic: {
    description: 'Delete a Slab topic by ID.',
    effect: 'destructive',
    inputSchema: deleteTopicInput,
    outputSchema: z.toJSONSchema(deleteTopicOutput, { io: 'output', unrepresentable: 'any' }),
  },
  add_topic_to_post: {
    description: 'Attach a Slab topic to a post.',
    effect: 'write',
    inputSchema: addTopicToPostInput,
    outputSchema: z.toJSONSchema(addTopicToPostOutput, { io: 'output', unrepresentable: 'any' }),
  },
  remove_topic_from_post: {
    description: 'Detach a Slab topic from a post.',
    effect: 'destructive',
    inputSchema: removeTopicFromPostInput,
    outputSchema: z.toJSONSchema(removeTopicFromPostOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search: {
    description: 'Search Slab posts, topics, users, and comments with cursor pagination.',
    effect: 'write',
    inputSchema: searchInput,
    outputSchema: z.toJSONSchema(searchOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
