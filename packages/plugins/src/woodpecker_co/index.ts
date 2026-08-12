/**
 * Woodpecker.co —— 从 open-connector 迁移的 provider(api_key,7 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  getCampaign,
  getCampaignStatistics,
  getMailbox,
  listCampaigns,
  listMailboxes,
  listProspects,
  listUsers,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { woodpeckerCoActions } from './schema'

export type { ProviderEnv as Env }

export function createWoodpeckerCoPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Woodpecker.co',
    actions: woodpeckerCoActions,
    // 上游 credentialValidators 就是打 /v2/users 试凭证,这里对应到同一个 action。
    credentialProbe: 'list_users',
    handlers: {
      list_users: listUsers,
      list_campaigns: listCampaigns,
      get_campaign: getCampaign,
      get_campaign_statistics: getCampaignStatistics,
      list_prospects: listProspects,
      list_mailboxes: listMailboxes,
      get_mailbox: getMailbox,
    },
  })
}

export default createWoodpeckerCoPlugin()
