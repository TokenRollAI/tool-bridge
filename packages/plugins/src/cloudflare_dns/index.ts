/**
 * Cloudflare DNS —— 从 open-connector 迁移的 provider(8 个 zone/DNS 记录 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * `create_dns_record` / `update_dns_record` 走**手写豁免**(见 `schema.handwritten.ts`):
 * 它们的 inputSchema 带 Zod 无法反推进 JSON Schema 的组合约束。
 *
 * credentialProbe 选 `list_zones`:read、无必填入参,且它要的 `zone.read` 是本 provider
 * **每个** action 都要的权限 —— 探针过了就说明凭证对这个 provider 有意义。
 * 没选 `list_accounts`(它更贴近上游 oauth2 validator 打的 `/accounts`):只授了 DNS 权限的
 * API token 拿不到 Account:Read,那种 token 用起来完全正常却会在挂载时被探针判死。
 */

import {
  createDnsRecord,
  deleteDnsRecord,
  getDnsRecord,
  getZone,
  listAccounts,
  listDnsRecords,
  listZones,
  updateDnsRecord,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { cloudflareDnsActions } from './schema'

export type { ProviderEnv as Env }

export function createCloudflareDnsPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Cloudflare DNS',
    actions: cloudflareDnsActions,
    credentialProbe: 'list_zones',
    handlers: {
      list_accounts: listAccounts,
      list_zones: listZones,
      get_zone: getZone,
      list_dns_records: listDnsRecords,
      get_dns_record: getDnsRecord,
      create_dns_record: createDnsRecord,
      update_dns_record: updateDnsRecord,
      delete_dns_record: deleteDnsRecord,
    },
  })
}

export default createCloudflareDnsPlugin()
