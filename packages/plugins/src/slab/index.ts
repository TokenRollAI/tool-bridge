/**
 * Slab —— 从 open-connector 迁移的 provider(api_key,17 个 action,全部走同一个 GraphQL 端点)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  addTopicToPost,
  createPost,
  createTopic,
  deletePost,
  deleteTopic,
  getOrganization,
  getPost,
  getPosts,
  getTopic,
  getTopics,
  getUser,
  listUsers,
  removeTopicFromPost,
  search,
  syncPost,
  updatePost,
  updateTopic,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { slabActions } from './schema'

export type { ProviderEnv as Env }

export function createSlabPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Slab',
    actions: slabActions,
    // 上游的 credentialValidators 打的就是 organization 查询,对应 get_organization。
    credentialProbe: 'get_organization',
    handlers: {
      get_organization: getOrganization,
      list_users: listUsers,
      get_user: getUser,
      get_post: getPost,
      get_posts: getPosts,
      create_post: createPost,
      update_post: updatePost,
      sync_post: syncPost,
      delete_post: deletePost,
      get_topic: getTopic,
      get_topics: getTopics,
      create_topic: createTopic,
      update_topic: updateTopic,
      delete_topic: deleteTopic,
      add_topic_to_post: addTopicToPost,
      remove_topic_from_post: removeTopicFromPost,
      search,
    },
  })
}

export default createSlabPlugin()
