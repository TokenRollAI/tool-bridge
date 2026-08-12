/**
 * Accredible Certificates —— 从 open-connector 迁移的 provider(api_key,8 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  createCredential,
  deleteCredential,
  getCredential,
  getGroup,
  listCredentials,
  listGroups,
  searchCredentials,
  searchGroups,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { accredibleCertificatesActions } from './schema'

export type { ProviderEnv as Env }

export function createAccredibleCertificatesPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Accredible Certificates',
    actions: accredibleCertificatesActions,
    // 上游 credentialValidators 打的是 /v1/issuer/details,但那个端点没有对应的 action。
    // list_groups 只读、无必填入参,是最便宜的替代。
    credentialProbe: 'list_groups',
    handlers: {
      list_groups: listGroups,
      get_group: getGroup,
      search_groups: searchGroups,
      list_credentials: listCredentials,
      get_credential: getCredential,
      search_credentials: searchCredentials,
      create_credential: createCredential,
      delete_credential: deleteCredential,
    },
  })
}

export default createAccredibleCertificatesPlugin()
