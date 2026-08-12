/**
 * Render —— 从 open-connector 迁移的 provider(api_key,10 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  getCurrentUser,
  getService,
  listDeploys,
  listServices,
  listWorkspaces,
  restartService,
  resumeService,
  rollbackDeploy,
  suspendService,
  triggerDeploy,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { renderActions } from './schema'

export type { ProviderEnv as Env }

export function createRenderPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Render',
    actions: renderActions,
    // 上游的 credentialValidators 就打 /users;get_current_user 是它的同一个调用。
    credentialProbe: 'get_current_user',
    handlers: {
      get_current_user: getCurrentUser,
      list_workspaces: listWorkspaces,
      list_services: listServices,
      get_service: getService,
      list_deploys: listDeploys,
      trigger_deploy: triggerDeploy,
      rollback_deploy: rollbackDeploy,
      restart_service: restartService,
      suspend_service: suspendService,
      resume_service: resumeService,
    },
  })
}

export default createRenderPlugin()
