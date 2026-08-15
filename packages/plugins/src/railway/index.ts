/**
 * Railway —— 从 open-connector 迁移的 provider(9 个 backboard GraphQL action)。
 *
 * `credentialProbe: 'list_projects'` 满足三个条件:已注册、effect 是 read、入参是空对象。
 * 上游的 credentialValidator 打的是 `me` / `workspace` 查询,那两个不是 action;
 * `list_projects` 打的是同一套令牌鉴权,配错的 key 在挂载时就会被拒。
 *
 * workspace 令牌需要的 `workspaceId` 走挂载的 `providerConfig`(非敏感的 workspace 归属),
 * 不进 secret —— 见上游 definition.ts 里它 `secret: false` 的声明。
 */

import {
  deployService,
  getDeployment,
  getDeploymentLogs,
  getProject,
  getServiceInstance,
  listDeployments,
  listProjects,
  rollbackDeployment,
  upsertVariable,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { railwayActions } from './schema'

export type { ProviderEnv as Env }

export function createRailwayPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Railway',
    credentialProbe: 'list_projects',
    actions: railwayActions,
    // workspaceId 非必配:决定 list_projects 用哪条 query,留空用账户默认。
    mountConfigFields: [{
      key: 'workspaceId',
      label: 'Workspace ID',
      description: '限定 list_projects 的工作区;留空用账户默认',
    }],
    handlers: {
      list_projects: listProjects,
      get_project: getProject,
      get_service_instance: getServiceInstance,
      list_deployments: listDeployments,
      get_deployment: getDeployment,
      get_deployment_logs: getDeploymentLogs,
      deploy_service: deployService,
      upsert_variable: upsertVariable,
      rollback_deployment: rollbackDeployment,
    },
  })
}

export default createRailwayPlugin()
