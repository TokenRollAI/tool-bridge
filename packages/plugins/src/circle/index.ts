/**
 * Circle —— 从 open-connector 迁移的 provider(api_key,8 个只读 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  getCommunity,
  getCommunityMember,
  getPost,
  getSpaceGroup,
  listCommunityMembers,
  listPosts,
  listSpaceGroups,
  listSpaceMembers,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { circleActions } from './schema'

export type { ProviderEnv as Env }

export function createCirclePlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Circle',
    actions: circleActions,
    // 上游 credentialValidators 也是打 /community 验凭证:只读、无入参,直接沿用。
    credentialProbe: 'get_community',
    handlers: {
      get_community: getCommunity,
      list_community_members: listCommunityMembers,
      get_community_member: getCommunityMember,
      list_posts: listPosts,
      get_post: getPost,
      list_space_groups: listSpaceGroups,
      get_space_group: getSpaceGroup,
      list_space_members: listSpaceMembers,
    },
  })
}

export default createCirclePlugin()
