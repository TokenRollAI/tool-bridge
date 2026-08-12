/**
 * Clerk —— 从 open-connector 迁移的 provider(api_key,11 个 action,全部围绕 Users API)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  banUser,
  countUsers,
  createUser,
  deleteUser,
  getUser,
  listUsers,
  lockUser,
  unbanUser,
  unlockUser,
  updateUser,
  updateUserMetadata,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { clerkActions } from './schema'

export type { ProviderEnv as Env }

export function createClerkPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Clerk',
    actions: clerkActions,
    // count_users 是只读、无必填入参的最便宜调用,适合当挂载时的凭证探针。
    credentialProbe: 'count_users',
    handlers: {
      list_users: listUsers,
      count_users: countUsers,
      get_user: getUser,
      create_user: createUser,
      update_user: updateUser,
      update_user_metadata: updateUserMetadata,
      delete_user: deleteUser,
      ban_user: banUser,
      unban_user: unbanUser,
      lock_user: lockUser,
      unlock_user: unlockUser,
    },
  })
}

export default createClerkPlugin()
