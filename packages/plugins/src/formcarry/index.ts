/**
 * Formcarry —— 从 open-connector 迁移的 provider(api_key,3 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 不设 credentialProbe:上游的 credentialValidators 打的是 `/api/auth`,而这个 provider
 * 根本没有对应的 action;唯一的 read action(list_submissions)要必填 form_id。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { createForm, deleteForm, listSubmissions } from './api'
import { formcarryActions } from './schema'

export type { ProviderEnv as Env }

export function createFormcarryPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Formcarry',
    actions: formcarryActions,
    handlers: {
      create_form: createForm,
      delete_form: deleteForm,
      list_submissions: listSubmissions,
    },
  })
}

export default createFormcarryPlugin()
