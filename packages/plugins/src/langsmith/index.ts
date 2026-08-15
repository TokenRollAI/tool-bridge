/**
 * LangSmith —— 从 open-connector 迁移的 provider(api_key,10 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 没有声明 `credentialFields`:凭证就是一个 API key,上游 `extraFields` 里的 `region` 与
 * `workspaceId` 都是非密钥配置,落在挂载的 `providerConfig`(见 `api.ts` 顶部注释)。
 */

import {
  createDataset,
  createExample,
  createProject,
  getDataset,
  getExample,
  getProject,
  listDatasets,
  listExamples,
  listProjects,
  listWorkspaces,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { langsmithActions } from './schema'

export type { ProviderEnv as Env }

export function createLangsmithPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'LangSmith',
    actions: langsmithActions,
    // 上游 credentialValidators 就是打 /api/v1/workspaces 试凭证,这里对应到同一个 action:
    // effect 是 read、入参全可选,满足探针的三个条件。
    credentialProbe: 'list_workspaces',
    // 两者均非必配:region 缺省走 us,workspaceId 缺省用凭证的默认 workspace。
    mountConfigFields: [
      {
        key: 'region',
        label: '区域',
        description: 'us、eu、apac 或 aws_us 之一;留空用 us',
      },
      {
        key: 'workspaceId',
        label: 'Workspace ID',
        description: '限定到某个 workspace;留空用凭证的默认 workspace',
      },
    ],
    handlers: {
      list_workspaces: listWorkspaces,
      list_projects: listProjects,
      get_project: getProject,
      create_project: createProject,
      list_datasets: listDatasets,
      get_dataset: getDataset,
      create_dataset: createDataset,
      list_examples: listExamples,
      get_example: getExample,
      create_example: createExample,
    },
  })
}

export default createLangsmithPlugin()
