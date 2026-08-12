/**
 * Shodan —— 从 open-connector 迁移的 provider(api_key,7 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  countSearchResults,
  getApiInfo,
  getDomainInfo,
  getHost,
  resolveHostnames,
  reverseDnsLookup,
  searchHosts,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { shodanActions } from './schema'

export type { ProviderEnv as Env }

export function createShodanPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Shodan',
    actions: shodanActions,
    // 上游 credentialValidators 打的就是 /api-info;它只读、无入参,且不消耗 query credits。
    credentialProbe: 'get_api_info',
    handlers: {
      get_api_info: getApiInfo,
      search_hosts: searchHosts,
      count_search_results: countSearchResults,
      get_host: getHost,
      get_domain_info: getDomainInfo,
      resolve_hostnames: resolveHostnames,
      reverse_dns_lookup: reverseDnsLookup,
    },
  })
}

export default createShodanPlugin()
