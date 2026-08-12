/**
 * Fathom Analytics —— 从 open-connector 迁移的 provider(15 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  createEvent,
  createMilestone,
  createSite,
  getAccount,
  getCurrentVisitors,
  getEvent,
  getMilestone,
  getSite,
  listEvents,
  listMilestones,
  listSites,
  runAggregation,
  updateEvent,
  updateMilestone,
  updateSite,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { fathomActions } from './schema'

export type { ProviderEnv as Env }

export function createFathomPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Fathom Analytics',
    actions: fathomActions,
    handlers: {
      get_account: getAccount,
      list_sites: listSites,
      get_site: getSite,
      create_site: createSite,
      update_site: updateSite,
      list_events: listEvents,
      get_event: getEvent,
      create_event: createEvent,
      update_event: updateEvent,
      list_milestones: listMilestones,
      get_milestone: getMilestone,
      create_milestone: createMilestone,
      update_milestone: updateMilestone,
      run_aggregation: runAggregation,
      get_current_visitors: getCurrentVisitors,
    },
  })
}

export default createFathomPlugin()
