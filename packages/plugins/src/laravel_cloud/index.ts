/**
 * Laravel Cloud —— 从 open-connector 迁移的 provider(api_key,8 个 action,全部只读)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  getApplication,
  getDeployment,
  getEnvironment,
  getOrganization,
  listApplications,
  listDeployments,
  listEnvironments,
  listRegions,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { laravelCloudActions } from './schema'

export type { ProviderEnv as Env }

export function createLaravelCloudPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Laravel Cloud',
    actions: laravelCloudActions,
    // 上游 credentialValidators 就是打 /meta/organization 试凭证,这里对应到同一个 action。
    credentialProbe: 'get_organization',
    handlers: {
      get_organization: getOrganization,
      list_regions: listRegions,
      list_applications: listApplications,
      get_application: getApplication,
      list_environments: listEnvironments,
      get_environment: getEnvironment,
      list_deployments: listDeployments,
      get_deployment: getDeployment,
    },
  })
}

export default createLaravelCloudPlugin()
