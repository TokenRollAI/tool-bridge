/**
 * SaaS Custom Domains —— 从 open-connector 迁移的 provider(api_key,11 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  createCustomDomain,
  createUpstream,
  deleteCustomDomain,
  deleteUpstream,
  getCustomDomain,
  getUpstream,
  listAccounts,
  listCustomDomains,
  listUpstreams,
  purgeCustomDomainHttpCache,
  verifyCustomDomainDnsRecords,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { saasCustomDomainsActions } from './schema'

export type { ProviderEnv as Env }

export function createSaasCustomDomainsPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'SaaS Custom Domains',
    actions: saasCustomDomainsActions,
    // 上游 credentialValidators 就是打 /accounts,与 list_accounts 是同一个调用。
    credentialProbe: 'list_accounts',
    handlers: {
      list_accounts: listAccounts,
      list_upstreams: listUpstreams,
      create_upstream: createUpstream,
      get_upstream: getUpstream,
      delete_upstream: deleteUpstream,
      list_custom_domains: listCustomDomains,
      create_custom_domain: createCustomDomain,
      get_custom_domain: getCustomDomain,
      delete_custom_domain: deleteCustomDomain,
      verify_custom_domain_dns_records: verifyCustomDomainDnsRecords,
      purge_custom_domain_http_cache: purgeCustomDomainHttpCache,
    },
  })
}

export default createSaasCustomDomainsPlugin()
