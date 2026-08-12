/**
 * Front —— 从 open-connector 迁移的 provider(api_key,5 个 action:contacts + teammates)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  createContact,
  getContact,
  listContacts,
  listTeammates,
  updateContact,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { frontActions } from './schema'

export type { ProviderEnv as Env }

export function createFrontPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Front',
    actions: frontActions,
    // 上游 credentialValidators 也是打 /teammates 验凭证:只读、无必填入参。
    credentialProbe: 'list_teammates',
    handlers: {
      list_contacts: listContacts,
      get_contact: getContact,
      create_contact: createContact,
      update_contact: updateContact,
      list_teammates: listTeammates,
    },
  })
}

export default createFrontPlugin()
