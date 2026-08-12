/**
 * Vercel —— 从 open-connector 迁移的 provider(23 个 action:账户/团队、项目、部署、
 * 环境变量、域名、webhook)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * credentialProbe 选 `get_auth_user`:上游 `credentialValidators` 打的正是 `/v2/user`,
 * 而它 effect 为 read、零入参,三个条件都满足 —— 配错的 access token 在挂载时就被拒。
 */

import {
  addProjectDomain,
  createProject,
  createProjectEnv,
  createWebhook,
  deleteProjectEnv,
  getAuthUser,
  getDeployment,
  getDeploymentEvents,
  getDomainConfig,
  getProject,
  getProjectDomain,
  getRuntimeLogs,
  getTeam,
  getWebhook,
  listDeployments,
  listProjectDomains,
  listProjectEnvs,
  listProjects,
  listTeams,
  listWebhooks,
  updateProject,
  updateProjectEnv,
  verifyProjectDomain,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { vercelActions } from './schema'

export type { ProviderEnv as Env }

export function createVercelPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Vercel',
    actions: vercelActions,
    credentialProbe: 'get_auth_user',
    handlers: {
      get_auth_user: getAuthUser,
      list_teams: listTeams,
      get_team: getTeam,
      list_projects: listProjects,
      get_project: getProject,
      create_project: createProject,
      update_project: updateProject,
      list_deployments: listDeployments,
      get_deployment: getDeployment,
      get_deployment_events: getDeploymentEvents,
      get_runtime_logs: getRuntimeLogs,
      list_project_envs: listProjectEnvs,
      create_project_env: createProjectEnv,
      update_project_env: updateProjectEnv,
      delete_project_env: deleteProjectEnv,
      list_project_domains: listProjectDomains,
      get_project_domain: getProjectDomain,
      add_project_domain: addProjectDomain,
      verify_project_domain: verifyProjectDomain,
      get_domain_config: getDomainConfig,
      list_webhooks: listWebhooks,
      get_webhook: getWebhook,
      create_webhook: createWebhook,
    },
  })
}

export default createVercelPlugin()
