/**
 * lemlist —— 从 open-connector 迁移的 provider(api_key,4 个 action,全部只读)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { getCampaign, getTeam, listCampaignLeads, listCampaigns } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { lemlistActions } from './schema'

export type { ProviderEnv as Env }

export function createLemlistPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'lemlist',
    actions: lemlistActions,
    // 上游 credentialValidators 就是打 /team 试凭证,这里对应到同一个 action。
    credentialProbe: 'get_team',
    handlers: {
      get_team: getTeam,
      list_campaigns: listCampaigns,
      get_campaign: getCampaign,
      list_campaign_leads: listCampaignLeads,
    },
  })
}

export default createLemlistPlugin()
