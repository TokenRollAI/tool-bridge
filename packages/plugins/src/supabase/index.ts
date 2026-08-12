/**
 * Supabase(Management API)—— 从 open-connector 迁移的 provider(21 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 凭证是**单值**:Supabase 的 personal access token(`sbp_...`)或 OAuth access token,
 * 走 `Authorization: Bearer`。**注意它是账号级的** —— `projectRef` 只是路径参数,一个 token
 * 能操作该账号下的所有 project(见 api.ts 顶部)。上游 `definition.ts` 还声明了 OAuth2,
 * 那条路径要平台的 providerOAuth 支撑,补它时要去掉下面的 credentialProbe(SDK 侧互斥)。
 *
 * credentialProbe 选 `list_organizations`:上游 credentialValidators 打的正是 `/organizations`,
 * 且它 effect 为 read、零入参 —— 三个条件都满足。
 */

import {
  createProjectApiKey,
  deleteProjectApiKey,
  deleteProjectSecrets,
  generateTypescriptTypes,
  getEdgeFunction,
  getOrganization,
  getProject,
  getProjectApiKey,
  getProjectHealth,
  listAvailableRegions,
  listEdgeFunctions,
  listOrganizationMembers,
  listOrganizationProjects,
  listOrganizations,
  listProjectApiKeys,
  listProjects,
  listProjectSecrets,
  listStorageBuckets,
  runReadOnlyQuery,
  updateProjectApiKey,
  upsertProjectSecrets,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { supabaseActions } from './schema'

export type { ProviderEnv as Env }

export function createSupabasePlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Supabase (Management API)',
    actions: supabaseActions,
    credentialProbe: 'list_organizations',
    handlers: {
      list_organizations: listOrganizations,
      get_organization: getOrganization,
      list_organization_members: listOrganizationMembers,
      list_organization_projects: listOrganizationProjects,
      list_projects: listProjects,
      get_project: getProject,
      list_available_regions: listAvailableRegions,
      get_project_health: getProjectHealth,
      list_project_api_keys: listProjectApiKeys,
      get_project_api_key: getProjectApiKey,
      create_project_api_key: createProjectApiKey,
      update_project_api_key: updateProjectApiKey,
      delete_project_api_key: deleteProjectApiKey,
      list_project_secrets: listProjectSecrets,
      upsert_project_secrets: upsertProjectSecrets,
      delete_project_secrets: deleteProjectSecrets,
      generate_typescript_types: generateTypescriptTypes,
      run_read_only_query: runReadOnlyQuery,
      list_storage_buckets: listStorageBuckets,
      list_edge_functions: listEdgeFunctions,
      get_edge_function: getEdgeFunction,
    },
  })
}

export default createSupabasePlugin()
