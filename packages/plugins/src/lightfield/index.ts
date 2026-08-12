/**
 * Lightfield —— 从 open-connector 迁移的 provider(10 个只读 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  getAccount,
  getApiKeyMetadata,
  getContact,
  getCustomObjectRecord,
  getOpportunity,
  listAccounts,
  listContacts,
  listCustomObjectRecords,
  listObjectDefinitions,
  listOpportunities,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { lightfieldActions } from './schema'

export type { ProviderEnv as Env }

export function createLightfieldPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Lightfield',
    actions: lightfieldActions,
    handlers: {
      get_api_key_metadata: getApiKeyMetadata,
      list_object_definitions: listObjectDefinitions,
      list_custom_object_records: listCustomObjectRecords,
      get_custom_object_record: getCustomObjectRecord,
      list_accounts: listAccounts,
      get_account: getAccount,
      list_contacts: listContacts,
      get_contact: getContact,
      list_opportunities: listOpportunities,
      get_opportunity: getOpportunity,
    },
  })
}

export default createLightfieldPlugin()
