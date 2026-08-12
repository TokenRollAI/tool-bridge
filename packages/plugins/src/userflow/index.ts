/**
 * Userflow —— 从 open-connector 迁移的 provider(api_key,8 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  deleteGroup,
  deleteUser,
  getGroup,
  getUser,
  listUsers,
  trackEvent,
  upsertGroup,
  upsertUser,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { userflowActions } from './schema'

export type { ProviderEnv as Env }

export function createUserflowPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Userflow',
    actions: userflowActions,
    // 上游 credentialValidators 打的就是 /users?limit=1;list_users 是这里唯一只读且
    // 无必填入参的 action。
    credentialProbe: 'list_users',
    handlers: {
      list_users: listUsers,
      get_user: getUser,
      upsert_user: upsertUser,
      delete_user: deleteUser,
      upsert_group: upsertGroup,
      get_group: getGroup,
      delete_group: deleteGroup,
      track_event: trackEvent,
    },
  })
}

export default createUserflowPlugin()
