/**
 * NextDNS —— 从 open-connector 迁移的 provider(api_key,7 个只读 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  getAnalyticsDevices,
  getAnalyticsDomains,
  getAnalyticsReasons,
  getAnalyticsStatus,
  getLogs,
  getProfile,
  listProfiles,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { nextDnsActions } from './schema'

export type { ProviderEnv as Env }

export function createNextDnsPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'NextDNS',
    actions: nextDnsActions,
    // 与上游 credentialValidators 打的是同一个端点(/profiles):只读、无必填入参。
    credentialProbe: 'list_profiles',
    handlers: {
      list_profiles: listProfiles,
      get_profile: getProfile,
      get_logs: getLogs,
      get_analytics_domains: getAnalyticsDomains,
      get_analytics_devices: getAnalyticsDevices,
      get_analytics_status: getAnalyticsStatus,
      get_analytics_reasons: getAnalyticsReasons,
    },
  })
}

export default createNextDnsPlugin()
