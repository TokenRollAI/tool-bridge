/**
 * Aimfox —— 从 open-connector 迁移的 provider(11 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  addProfileToCampaign,
  getCampaign,
  getCampaignMetrics,
  getLead,
  getTotalLeadsCount,
  listCampaigns,
  listInteractions,
  listRecentLeads,
  listWorkspaceLabels,
  removeProfileFromCampaign,
  searchLeads,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { aimfoxActions } from './schema'

export type { ProviderEnv as Env }

export function createAimfoxPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Aimfox',
    actions: aimfoxActions,
    // 上游的 credentialValidator 打的就是 /campaigns,只读且无必填入参。
    credentialProbe: 'list_campaigns',
    handlers: {
      list_campaigns: listCampaigns,
      get_campaign: getCampaign,
      get_campaign_metrics: getCampaignMetrics,
      add_profile_to_campaign: addProfileToCampaign,
      remove_profile_from_campaign: removeProfileFromCampaign,
      get_lead: getLead,
      search_leads: searchLeads,
      get_total_leads_count: getTotalLeadsCount,
      list_recent_leads: listRecentLeads,
      list_interactions: listInteractions,
      list_workspace_labels: listWorkspaceLabels,
    },
  })
}

export default createAimfoxPlugin()
