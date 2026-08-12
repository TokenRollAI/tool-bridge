/**
 * Templated —— 从 open-connector 迁移的 provider(api_key,7 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  createRender,
  deleteRender,
  getAccount,
  getRender,
  getTemplate,
  listRenders,
  listTemplates,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { templatedActions } from './schema'

export type { ProviderEnv as Env }

export function createTemplatedPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Templated',
    actions: templatedActions,
    // 上游 credentialValidators 就是打 /account 试凭证,这里对应到同一个 action。
    credentialProbe: 'get_account',
    handlers: {
      get_account: getAccount,
      list_templates: listTemplates,
      get_template: getTemplate,
      create_render: createRender,
      list_renders: listRenders,
      get_render: getRender,
      delete_render: deleteRender,
    },
  })
}

export default createTemplatedPlugin()
