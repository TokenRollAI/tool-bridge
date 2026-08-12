/**
 * Slab 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/slab/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * Slab 只有一个 **GraphQL 端点**,17 个 action 全打 `POST /graphql`,区别只在 query 文本与
 * variables。三处上游行为决定了这里的形状:
 * - GraphQL 的错误在 **HTTP 200 上**回 `{errors:[...]}`,不看这个字段就会把失败当成功;
 *   `extensions.code` 里的 `UNAUTHENTICATED`/`FORBIDDEN` 比 HTTP 状态更准。
 * - 除此之外的 GraphQL 错误(字段不存在、参数非法、上游内部错)一律归 502 —— 无法从
 *   GraphQL 层面区分是调用方的错还是上游的错,上游选了保守的那一侧,这里保留。
 * - `search` 的结果是**联合类型**(post/topic/user/comment 四种 node),要按 `__typename`
 *   摊平成一张统一的结果表;未知 typename 视为上游变更,报错而非静默丢弃。
 *
 * 生成的 schema 里若干**本该必填**的字段是 optional(上游 `s.object` 只在有显式 optional
 * 字段时才产 required 列表,单必填字段的对象就漏了 required)。这个洞被等价地搬了过来,
 * 故 `requireText` 之类的检查必须留着,否则会打出 `id: undefined` 的 GraphQL 请求。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  addTopicToPostInput,
  createPostInput,
  createTopicInput,
  deletePostInput,
  deleteTopicInput,
  getOrganizationInput,
  getPostInput,
  getPostsInput,
  getTopicInput,
  getTopicsInput,
  getUserInput,
  listUsersInput,
  removeTopicFromPostInput,
  searchInput,
  syncPostInput,
  updatePostInput,
  updateTopicInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'slab'
const GRAPHQL_URL = 'https://api.slab.com/graphql'

type Json = Record<string, unknown>

/** GraphQL 选择集片段,与上游逐字一致 —— 改动这里等于改动出参形状。 */
const USER_FIELDS = `
  id
  name
  title
  email
  description
  type
  deactivatedAt
  insertedAt
  updatedAt
  avatar { original thumb preset }
`

const USER_SUMMARY_FIELDS = `
  id
  name
  email
`

const TOPIC_SUMMARY_FIELDS = `
  id
  name
  privacy
`

const TOPIC_FIELDS = `
  id
  name
  description
  insertedAt
  updatedAt
  privacy
  memberEditable
  inheritParent
  hierarchy
  parent { ${TOPIC_SUMMARY_FIELDS} }
  ancestors { ${TOPIC_SUMMARY_FIELDS} }
  children { ${TOPIC_SUMMARY_FIELDS} }
  owners { ${USER_SUMMARY_FIELDS} }
  members { ${USER_SUMMARY_FIELDS} }
`

const POST_FIELDS = `
  id
  linkAccess
  archivedAt
  publishedAt
  title
  insertedAt
  content
  updatedAt
  version
  owner { ${USER_SUMMARY_FIELDS} }
  topics { ${TOPIC_SUMMARY_FIELDS} }
`

/** 上游 `optionalString`:非字符串、或去空白后为空,一律当作"没给"。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 丢掉值为 undefined 的键(上游 `compactObject`):GraphQL 里 `null` 与"没传"语义不同。 */
function compact(input: Record<string, unknown>): Json {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

/**
 * schema 里被误标成 optional 的必填串,以及 `min(1)` 拦不住的纯空白串,都在拼进
 * variables 之前挡下 —— 否则会打出 `id: undefined` 或空 content 的 GraphQL 请求。
 */
function requireText(value: string | undefined, field: string): string {
  const result = text(value)
  if (result === undefined) throw new TBError('invalid_argument', `${field} is required`)
  return result
}

function requireIds(value: string[] | undefined, field: string): string[] {
  if (value === undefined || value.length === 0) {
    throw new TBError('invalid_argument', `${field} is required`)
  }
  return value
}

/** 契约说好是对象;不是就是上游出问题,不是调用方的错(502 → unavailable)。 */
function requireObject(value: unknown, label: string): Json {
  const object = record(value)
  if (object === undefined) throw upstreamError(502, `${label} was not an object`)
  return object
}

function requireObjectField(source: Json, key: string, label: string): Json {
  return requireObject(source[key], label)
}

function requireArrayField(source: Json, key: string, label: string): unknown[] {
  const value = source[key]
  if (!Array.isArray(value)) throw upstreamError(502, `${label} was not an array`)
  return value
}

/** Slab 的错误消息可能是字符串、`{message}`、`{error}`,或嵌一层 `errors` 数组。 */
function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') return payload
  if (Array.isArray(payload)) {
    const messages = payload
      .map(item => record(item)?.message)
      .filter((item): item is string => typeof item === 'string' && item.length > 0)
    return messages.length > 0 ? messages.join('; ') : undefined
  }
  const object = record(payload)
  if (object === undefined) return undefined
  if (typeof object.message === 'string') return object.message
  if (typeof object.error === 'string') return object.error
  return errorMessage(object.errors)
}

/** GraphQL 错误的稳定错误码在 `errors[0].extensions.code`,它比 HTTP 状态更准。 */
function graphqlErrorCode(errors: unknown): string | undefined {
  if (!Array.isArray(errors)) return undefined
  const extensions = record(record(errors[0])?.extensions)
  return typeof extensions?.code === 'string' ? extensions.code : undefined
}

interface GraphqlRequest {
  operationName: string
  query: string
  variables?: Json
}

/** 打一次 GraphQL,返回 `data` 对象。HTTP 层与 GraphQL 层的错误都在这里归一。 */
async function requestData(ctx: ProviderContext, request: GraphqlRequest): Promise<Json> {
  const response = await guardedFetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'authorization': `Bearer ${requireApiKey(ctx, SERVICE)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  const raw = await response.text().catch(() => '')
  let payload: unknown = null
  if (raw.trim() !== '') {
    try {
      payload = JSON.parse(raw)
    } catch {
      payload = raw
    }
  }

  if (!response.ok) {
    throw upstreamError(response.status, errorMessage(payload) ?? `slab request failed with ${response.status}`)
  }

  const body = record(payload)
  if (body === undefined) throw upstreamError(502, 'slab response was not a JSON object')

  if (body.errors !== undefined) {
    const message = errorMessage(body.errors) ?? 'slab GraphQL request failed'
    const code = graphqlErrorCode(body.errors)
    // 认证/授权失败靠 GraphQL 错误码识别 —— Slab 在这两种情况下仍回 HTTP 200。
    if (code === 'UNAUTHENTICATED' || code === 'FORBIDDEN') throw upstreamError(401, message)
    // 其余 GraphQL 错误无法判定责任方,与上游一致归 502(→ unavailable + retryable)。
    throw upstreamError(502, message)
  }
  if (body.data === undefined) throw upstreamError(502, 'slab response did not include data')

  return requireObject(body.data, 'Slab data')
}

export async function getOrganization(
  _input: z.infer<typeof getOrganizationInput>,
  ctx: ProviderContext,
): Promise<{ organization: Json }> {
  const data = await requestData(ctx, {
    operationName: 'GetOrganization',
    query: `
          query GetOrganization {
            organization {
              id
              name
              host
              insertedAt
              updatedAt
            }
          }
        `,
  })
  return { organization: requireObjectField(data, 'organization', 'Slab organization') }
}

export async function listUsers(
  input: z.infer<typeof listUsersInput>,
  ctx: ProviderContext,
): Promise<{ users: unknown[] }> {
  const data = await requestData(ctx, {
    operationName: 'ListUsers',
    query: `
          query ListUsers($includeDeactivated: Boolean) {
            organization {
              users(includeDeactivated: $includeDeactivated) {
                ${USER_FIELDS}
              }
            }
          }
        `,
    variables: compact({ includeDeactivated: input.includeDeactivated }),
  })
  const organization = requireObjectField(data, 'organization', 'Slab organization')
  return { users: requireArrayField(organization, 'users', 'Slab users') }
}

export async function getUser(
  input: z.infer<typeof getUserInput>,
  ctx: ProviderContext,
): Promise<{ user: Json }> {
  const data = await requestData(ctx, {
    operationName: 'GetUser',
    query: `
          query GetUser($id: ID!) {
            user(id: $id) {
              ${USER_FIELDS}
            }
          }
        `,
    variables: { id: requireText(input.id, 'id') },
  })
  return { user: requireObjectField(data, 'user', 'Slab user') }
}

export async function getPost(
  input: z.infer<typeof getPostInput>,
  ctx: ProviderContext,
): Promise<{ post: Json }> {
  const data = await requestData(ctx, {
    operationName: 'GetPost',
    query: `
          query GetPost($id: ID!) {
            post(id: $id) {
              ${POST_FIELDS}
            }
          }
        `,
    variables: { id: requireText(input.id, 'id') },
  })
  return { post: requireObjectField(data, 'post', 'Slab post') }
}

export async function getPosts(
  input: z.infer<typeof getPostsInput>,
  ctx: ProviderContext,
): Promise<{ posts: unknown[] }> {
  const data = await requestData(ctx, {
    operationName: 'GetPosts',
    query: `
          query GetPosts($ids: [ID!]!) {
            posts(ids: $ids) {
              ${POST_FIELDS}
            }
          }
        `,
    variables: { ids: requireIds(input.ids, 'ids') },
  })
  return { posts: requireArrayField(data, 'posts', 'Slab posts') }
}

export async function createPost(
  input: z.infer<typeof createPostInput>,
  ctx: ProviderContext,
): Promise<{ post: Json }> {
  const data = await requestData(ctx, {
    operationName: 'CreatePost',
    query: `
          mutation CreatePost($title: String, $topicId: ID, $templateId: ID) {
            createPost(title: $title, topicId: $topicId, templateId: $templateId) {
              ${POST_FIELDS}
            }
          }
        `,
    variables: compact({
      title: text(input.title),
      topicId: text(input.topicId),
      templateId: text(input.templateId),
    }),
  })
  return { post: requireObjectField(data, 'createPost', 'Slab post') }
}

export async function updatePost(
  input: z.infer<typeof updatePostInput>,
  ctx: ProviderContext,
): Promise<{ post: Json }> {
  const data = await requestData(ctx, {
    operationName: 'UpdatePost',
    query: `
          mutation UpdatePost(
            $id: ID!
            $ownerId: ID
            $archived: Boolean
            $published: Boolean
            $linkAccess: PostLinkAccess
            $bannerUrl: String
          ) {
            updatePost(
              id: $id
              ownerId: $ownerId
              archived: $archived
              published: $published
              linkAccess: $linkAccess
              bannerUrl: $bannerUrl
            ) {
              ${POST_FIELDS}
            }
          }
        `,
    variables: compact({
      id: requireText(input.id, 'id'),
      ownerId: text(input.ownerId),
      archived: input.archived,
      published: input.published,
      linkAccess: input.linkAccess,
      bannerUrl: text(input.bannerUrl),
    }),
  })
  return { post: requireObjectField(data, 'updatePost', 'Slab post') }
}

export async function syncPost(
  input: z.infer<typeof syncPostInput>,
  ctx: ProviderContext,
): Promise<{ post: Json }> {
  const data = await requestData(ctx, {
    operationName: 'SyncPost',
    query: `
          mutation SyncPost(
            $externalId: ID!
            $format: PostContentFormat!
            $content: String!
            $editUrl: String
            $readUrl: String
          ) {
            syncPost(
              externalId: $externalId
              format: $format
              content: $content
              editUrl: $editUrl
              readUrl: $readUrl
            ) {
              ${POST_FIELDS}
            }
          }
        `,
    variables: compact({
      // 三个必填串过一道 text():schema 只挡住长度 0,纯空白仍能通过,
      // 而 Slab 对空 content 报的错很含糊。
      externalId: requireText(input.externalId, 'externalId'),
      format: input.format,
      content: requireText(input.content, 'content'),
      editUrl: text(input.editUrl),
      readUrl: text(input.readUrl),
    }),
  })
  return { post: requireObjectField(data, 'syncPost', 'Slab post') }
}

export async function deletePost(
  input: z.infer<typeof deletePostInput>,
  ctx: ProviderContext,
): Promise<{ post: Json }> {
  const data = await requestData(ctx, {
    operationName: 'DeletePost',
    query: `
          mutation DeletePost($id: ID!) {
            deletePost(id: $id) {
              ${POST_FIELDS}
            }
          }
        `,
    variables: { id: requireText(input.id, 'id') },
  })
  return { post: requireObjectField(data, 'deletePost', 'Slab post') }
}

export async function getTopic(
  input: z.infer<typeof getTopicInput>,
  ctx: ProviderContext,
): Promise<{ topic: Json }> {
  const data = await requestData(ctx, {
    operationName: 'GetTopic',
    query: `
          query GetTopic($id: ID!) {
            topic(id: $id) {
              ${TOPIC_FIELDS}
            }
          }
        `,
    variables: { id: requireText(input.id, 'id') },
  })
  return { topic: requireObjectField(data, 'topic', 'Slab topic') }
}

export async function getTopics(
  input: z.infer<typeof getTopicsInput>,
  ctx: ProviderContext,
): Promise<{ topics: unknown[] }> {
  const data = await requestData(ctx, {
    operationName: 'GetTopics',
    query: `
          query GetTopics($ids: [ID!]!) {
            topics(ids: $ids) {
              ${TOPIC_FIELDS}
            }
          }
        `,
    variables: { ids: requireIds(input.ids, 'ids') },
  })
  return { topics: requireArrayField(data, 'topics', 'Slab topics') }
}

export async function createTopic(
  input: z.infer<typeof createTopicInput>,
  ctx: ProviderContext,
): Promise<{ topic: Json }> {
  const data = await requestData(ctx, {
    operationName: 'CreateTopic',
    query: `
          mutation CreateTopic(
            $name: String!
            $description: Json
            $parentId: ID
            $memberEditable: TopicMemberEditable
            $privacy: TopicPrivacy
            $inheritParent: Boolean
          ) {
            createTopic(
              name: $name
              description: $description
              parentId: $parentId
              memberEditable: $memberEditable
              privacy: $privacy
              inheritParent: $inheritParent
            ) {
              ${TOPIC_FIELDS}
            }
          }
        `,
    variables: compact({
      name: requireText(input.name, 'name'),
      // description 是 Slab 的 Json 标量(富文本节点树),原样转发不做解释。
      description: input.description,
      parentId: text(input.parentId),
      memberEditable: input.memberEditable,
      privacy: input.privacy,
      inheritParent: input.inheritParent,
    }),
  })
  return { topic: requireObjectField(data, 'createTopic', 'Slab topic') }
}

export async function updateTopic(
  input: z.infer<typeof updateTopicInput>,
  ctx: ProviderContext,
): Promise<{ topic: Json }> {
  const data = await requestData(ctx, {
    operationName: 'UpdateTopic',
    query: `
          mutation UpdateTopic(
            $id: ID!
            $name: String
            $description: Json
            $parentId: ID
            $memberEditable: TopicMemberEditable
            $privacy: TopicPrivacy
            $bannerUrl: String
            $inheritParent: Boolean
            $propagatePrivacy: Boolean
          ) {
            updateTopic(
              id: $id
              name: $name
              description: $description
              parentId: $parentId
              memberEditable: $memberEditable
              privacy: $privacy
              bannerUrl: $bannerUrl
              inheritParent: $inheritParent
              propagatePrivacy: $propagatePrivacy
            ) {
              ${TOPIC_FIELDS}
            }
          }
        `,
    variables: compact({
      id: requireText(input.id, 'id'),
      name: text(input.name),
      description: input.description,
      parentId: text(input.parentId),
      memberEditable: input.memberEditable,
      privacy: input.privacy,
      bannerUrl: text(input.bannerUrl),
      inheritParent: input.inheritParent,
      propagatePrivacy: input.propagatePrivacy,
    }),
  })
  return { topic: requireObjectField(data, 'updateTopic', 'Slab topic') }
}

export async function deleteTopic(
  input: z.infer<typeof deleteTopicInput>,
  ctx: ProviderContext,
): Promise<{ topic: Json }> {
  const data = await requestData(ctx, {
    operationName: 'DeleteTopic',
    query: `
          mutation DeleteTopic($id: ID!) {
            deleteTopic(id: $id) {
              ${TOPIC_FIELDS}
            }
          }
        `,
    variables: { id: requireText(input.id, 'id') },
  })
  return { topic: requireObjectField(data, 'deleteTopic', 'Slab topic') }
}

export async function addTopicToPost(
  input: z.infer<typeof addTopicToPostInput>,
  ctx: ProviderContext,
): Promise<{ topic: Json }> {
  const data = await requestData(ctx, {
    operationName: 'AddTopicToPost',
    query: `
          mutation AddTopicToPost($postId: ID!, $topicId: ID!) {
            addTopicToPost(postId: $postId, topicId: $topicId) {
              ${TOPIC_FIELDS}
            }
          }
        `,
    variables: {
      postId: requireText(input.postId, 'postId'),
      topicId: requireText(input.topicId, 'topicId'),
    },
  })
  return { topic: requireObjectField(data, 'addTopicToPost', 'Slab topic') }
}

export async function removeTopicFromPost(
  input: z.infer<typeof removeTopicFromPostInput>,
  ctx: ProviderContext,
): Promise<{ topic: Json }> {
  const data = await requestData(ctx, {
    operationName: 'RemoveTopicFromPost',
    query: `
          mutation RemoveTopicFromPost($postId: ID!, $topicId: ID!) {
            removeTopicFromPost(postId: $postId, topicId: $topicId) {
              ${TOPIC_FIELDS}
            }
          }
        `,
    variables: {
      postId: requireText(input.postId, 'postId'),
      topicId: requireText(input.topicId, 'topicId'),
    },
  })
  return { topic: requireObjectField(data, 'removeTopicFromPost', 'Slab topic') }
}

/**
 * search 的 node 是四选一的联合类型,按 `__typename` 摊平成同一张表:`type` + `title` +
 * `content` + 各自的实体对象。未知 typename 说明上游加了新的结果种类,报错而非静默丢弃 ——
 * 静默丢会让调用方看到一个"结果变少了"却查不出原因的分页。
 */
function normalizeSearchEdge(edge: Json): Json {
  const node = requireObjectField(edge, 'node', 'Slab search result node')
  const base = compact({ cursor: text(edge.cursor), highlight: node.highlight })

  switch (text(node.__typename)) {
    case 'PostSearchResult':
      return compact({
        ...base,
        type: 'POST',
        title: text(node.title),
        content: node.content,
        post: requireObjectField(node, 'post', 'Slab post search result'),
      })
    case 'TopicSearchResult':
      return compact({
        ...base,
        type: 'TOPIC',
        title: text(node.name),
        content: node.description,
        topic: requireObjectField(node, 'topic', 'Slab topic search result'),
      })
    case 'UserSearchResult':
      return compact({
        ...base,
        type: 'USER',
        title: text(node.name),
        content: node.description,
        user: requireObjectField(node, 'user', 'Slab user search result'),
      })
    case 'CommentSearchResult':
      return compact({
        ...base,
        type: 'COMMENT',
        content: node.content,
        comment: requireObjectField(node, 'comment', 'Slab comment search result'),
      })
    default:
      throw upstreamError(502, 'slab search returned an unknown result type')
  }
}

export async function search(
  input: z.infer<typeof searchInput>,
  ctx: ProviderContext,
): Promise<{ pageInfo: Json, results: Json[] }> {
  const data = await requestData(ctx, {
    operationName: 'Search',
    query: `
          query Search(
            $query: String!
            $types: [SearchType!]
            $first: Int
            $after: String
            $last: Int
            $before: String
          ) {
            search(
              query: $query
              types: $types
              first: $first
              after: $after
              last: $last
              before: $before
            ) {
              pageInfo {
                hasPreviousPage
                hasNextPage
                startCursor
                endCursor
              }
              edges {
                cursor
                node {
                  __typename
                  ... on PostSearchResult {
                    title
                    highlight
                    content
                    post { ${POST_FIELDS} }
                  }
                  ... on TopicSearchResult {
                    name
                    description
                    topic { ${TOPIC_FIELDS} }
                  }
                  ... on UserSearchResult {
                    name
                    title
                    description
                    user { ${USER_FIELDS} }
                  }
                  ... on CommentSearchResult {
                    content
                    comment {
                      id
                      content
                      insertedAt
                      author { ${USER_SUMMARY_FIELDS} }
                    }
                  }
                }
              }
            }
          }
        `,
    variables: compact({
      query: requireText(input.query, 'query'),
      types: input.types,
      first: input.first,
      after: text(input.after),
      last: input.last,
      before: text(input.before),
    }),
  })

  const connection = requireObjectField(data, 'search', 'Slab search result connection')
  const edges = requireArrayField(connection, 'edges', 'Slab search edges')
  return {
    pageInfo: requireObjectField(connection, 'pageInfo', 'Slab pageInfo'),
    results: edges.map(edge => normalizeSearchEdge(requireObject(edge, 'Slab search edge'))),
  }
}
