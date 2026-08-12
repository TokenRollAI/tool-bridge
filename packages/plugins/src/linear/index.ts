/**
 * Linear —— 从 open-connector 迁移的 provider(api_key,34 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * **只迁 api_key 一路**:上游 `definition.ts` 声明了 `oauth2` 与 `api_key` 两种 auth,
 * 两者在 Authorization 头上的形状不同(OAuth token 要 `Bearer ` 前缀,personal API key
 * 不要)。这里不声明 `oauth`,凭证按裸头处理 —— 见 `api.ts` 顶部。
 * (顺带:声明了 `oauth` 就不能再声明 `credentialProbe`,SDK 当场炸。)
 */

import {
  createAttachment,
  createCommentReaction,
  createLinearComment,
  createLinearIssue,
  createLinearIssueRelation,
  createLinearLabel,
  createLinearProject,
  createProjectMilestone,
  createProjectUpdate,
  deleteLinearIssue,
  getAllLinearTeams,
  getAttachment,
  getCurrentUser,
  getCyclesByTeamId,
  getIssueDefaults,
  getLinearIssue,
  getLinearProject,
  listIssueDrafts,
  listIssuesByTeamId,
  listLinearCycles,
  listLinearIssues,
  listLinearLabels,
  listLinearProjects,
  listLinearStates,
  listLinearTeams,
  listLinearUsers,
  removeIssueLabel,
  removeReaction,
  runMutation,
  runQuery,
  searchIssues,
  updateIssue,
  updateLinearComment,
  updateLinearProject,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { linearActions } from './schema'

export type { ProviderEnv as Env }

export function createLinearPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Linear',
    actions: linearActions,
    // 上游两个 credentialValidators(apiKey 与 oauth2)都打 `viewer` 查询 —— 只读、
    // 入参 schema 是空对象,正好当挂载时的凭证探针。
    credentialProbe: 'get_current_user',
    handlers: {
      create_attachment: createAttachment,
      create_comment_reaction: createCommentReaction,
      create_linear_comment: createLinearComment,
      create_linear_issue: createLinearIssue,
      create_linear_issue_relation: createLinearIssueRelation,
      create_linear_label: createLinearLabel,
      create_linear_project: createLinearProject,
      create_project_milestone: createProjectMilestone,
      create_project_update: createProjectUpdate,
      delete_linear_issue: deleteLinearIssue,
      get_all_linear_teams: getAllLinearTeams,
      get_attachment: getAttachment,
      get_current_user: getCurrentUser,
      get_cycles_by_team_id: getCyclesByTeamId,
      get_issue_defaults: getIssueDefaults,
      get_linear_issue: getLinearIssue,
      get_linear_project: getLinearProject,
      list_issue_drafts: listIssueDrafts,
      list_issues_by_team_id: listIssuesByTeamId,
      list_linear_cycles: listLinearCycles,
      list_linear_issues: listLinearIssues,
      list_linear_labels: listLinearLabels,
      list_linear_projects: listLinearProjects,
      list_linear_states: listLinearStates,
      list_linear_teams: listLinearTeams,
      list_linear_users: listLinearUsers,
      remove_issue_label: removeIssueLabel,
      remove_reaction: removeReaction,
      run_mutation: runMutation,
      run_query: runQuery,
      search_issues: searchIssues,
      update_issue: updateIssue,
      update_linear_comment: updateLinearComment,
      update_linear_project: updateLinearProject,
    },
  })
}

export default createLinearPlugin()
