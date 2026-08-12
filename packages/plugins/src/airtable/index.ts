/**
 * Airtable —— 从 open-connector 迁移的 provider(api_key,14 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  createBase,
  createField,
  createRecords,
  createTable,
  deleteBase,
  deleteRecords,
  getBaseCollaborators,
  getBaseSchema,
  getRecord,
  listBases,
  listRecords,
  updateField,
  updateRecords,
  updateTable,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { airtableActions } from './schema'

export type { ProviderEnv as Env }

export function createAirtablePlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Airtable',
    actions: airtableActions,
    // 上游 credentialValidators 也打 /v0/meta/bases —— 只读、无必填入参,
    // 正好当挂载时的凭证探针。
    credentialProbe: 'list_bases',
    handlers: {
      list_bases: listBases,
      get_base_collaborators: getBaseCollaborators,
      get_base_schema: getBaseSchema,
      create_base: createBase,
      delete_base: deleteBase,
      create_table: createTable,
      update_table: updateTable,
      create_field: createField,
      update_field: updateField,
      list_records: listRecords,
      get_record: getRecord,
      create_records: createRecords,
      update_records: updateRecords,
      delete_records: deleteRecords,
    },
  })
}

export default createAirtablePlugin()
