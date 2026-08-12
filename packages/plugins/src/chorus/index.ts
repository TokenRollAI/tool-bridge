/**
 * Chorus —— 从 open-connector 迁移的 provider(api_key,6 个 action,全部只读)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  getConversation,
  getCurrentUser,
  getTeam,
  listEngagements,
  listScorecards,
  listTeams,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { chorusActions } from './schema'

export type { ProviderEnv as Env }

export function createChorusPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Chorus',
    actions: chorusActions,
    // 上游的 credentialValidators 打的就是 /api/v1/users/me,对应 get_current_user。
    credentialProbe: 'get_current_user',
    handlers: {
      get_current_user: getCurrentUser,
      list_teams: listTeams,
      get_team: getTeam,
      list_engagements: listEngagements,
      get_conversation: getConversation,
      list_scorecards: listScorecards,
    },
  })
}

export default createChorusPlugin()
