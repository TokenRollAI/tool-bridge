/**
 * Feathery —— 从 open-connector 迁移的 provider(api_key,13 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  createHiddenField,
  createOrFetchUser,
  createOrUpdateFormSubmissions,
  deleteHiddenField,
  deleteUser,
  editHiddenField,
  getAccountInfo,
  getFormSchema,
  getUserData,
  getUserSession,
  listForms,
  listHiddenFields,
  listUsers,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { featheryActions } from './schema'

export type { ProviderEnv as Env }

export function createFeatheryPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Feathery',
    actions: featheryActions,
    // 上游的 credentialValidators 就打 /api/account/;get_account_info 是它的同一个调用。
    credentialProbe: 'get_account_info',
    handlers: {
      get_account_info: getAccountInfo,
      list_forms: listForms,
      get_form_schema: getFormSchema,
      create_or_update_form_submissions: createOrUpdateFormSubmissions,
      list_hidden_fields: listHiddenFields,
      create_hidden_field: createHiddenField,
      edit_hidden_field: editHiddenField,
      delete_hidden_field: deleteHiddenField,
      list_users: listUsers,
      get_user_data: getUserData,
      get_user_session: getUserSession,
      create_or_fetch_user: createOrFetchUser,
      delete_user: deleteUser,
    },
  })
}

export default createFeatheryPlugin()
