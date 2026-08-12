/**
 * V2EX —— 从 open-connector 迁移的 provider(13 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 凭证是单个 API key(V2EX 的 Personal Access Token),走 `Authorization: Bearer`。
 *
 * credentialProbe 选 `get_current_member`:它 effect 为 read、入参是空对象,且打的正是
 * 上游 `credentialValidators` 用的那个端点(`/member`)—— token 有效、作用域够读自己的
 * 资料,一次就验到了。
 */

import {
  boostTopic,
  createToken,
  deleteNotification,
  getCurrentMember,
  getCurrentToken,
  getNode,
  getTopic,
  listHotTopics,
  listLatestTopics,
  listNodeTopics,
  listNotifications,
  listTopicReplies,
  setTopicSticky,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { v2exActions } from './schema'

export type { ProviderEnv as Env }

export function createV2exPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'V2EX',
    credentialProbe: 'get_current_member',
    actions: v2exActions,
    handlers: {
      list_notifications: listNotifications,
      delete_notification: deleteNotification,
      list_hot_topics: listHotTopics,
      list_latest_topics: listLatestTopics,
      get_current_member: getCurrentMember,
      get_current_token: getCurrentToken,
      create_token: createToken,
      get_node: getNode,
      list_node_topics: listNodeTopics,
      get_topic: getTopic,
      list_topic_replies: listTopicReplies,
      set_topic_sticky: setTopicSticky,
      boost_topic: boostTopic,
    },
  })
}

export default createV2exPlugin()
