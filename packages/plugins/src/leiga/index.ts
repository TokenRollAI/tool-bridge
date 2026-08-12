/**
 * Leiga —— 从 open-connector 迁移的 provider(api_key,6 个只读 action:projects + issues)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  getIssueByNumber,
  getIssueSchema,
  getProject,
  getProjectByKey,
  listIssues,
  listProjects,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { leigaActions } from './schema'

export type { ProviderEnv as Env }

export function createLeigaPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Leiga',
    actions: leigaActions,
    // 上游 credentialValidators 也是打 /project/list 试凭证:只读、无必填入参。
    credentialProbe: 'list_projects',
    handlers: {
      list_projects: listProjects,
      get_project: getProject,
      get_project_by_key: getProjectByKey,
      list_issues: listIssues,
      get_issue_by_number: getIssueByNumber,
      get_issue_schema: getIssueSchema,
    },
  })
}

export default createLeigaPlugin()
