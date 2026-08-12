/**
 * CircleCI —— 从 open-connector 迁移的 provider(api_key,11 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  getCurrentUser,
  getJobArtifacts,
  getJobDetails,
  getPipeline,
  getProject,
  getWorkflowSummary,
  listInsightsSummary,
  listPipelinesForProject,
  listProjectEnvVars,
  listWorkflowsByPipeline,
  triggerPipeline,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { circleciActions } from './schema'

export type { ProviderEnv as Env }

export function createCircleciPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'CircleCI',
    actions: circleciActions,
    // 上游的 credentialValidators 打的就是 /me;它只读、零入参,是天然的探针。
    credentialProbe: 'get_current_user',
    handlers: {
      get_current_user: getCurrentUser,
      get_project: getProject,
      list_pipelines_for_project: listPipelinesForProject,
      get_pipeline: getPipeline,
      list_workflows_by_pipeline: listWorkflowsByPipeline,
      get_workflow_summary: getWorkflowSummary,
      get_job_details: getJobDetails,
      get_job_artifacts: getJobArtifacts,
      list_insights_summary: listInsightsSummary,
      trigger_pipeline: triggerPipeline,
      list_project_env_vars: listProjectEnvVars,
    },
  })
}

export default createCircleciPlugin()
