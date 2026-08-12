/**
 * Jira(Data Center / Server)—— 从 open-connector 迁移的 provider(7 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 凭证是**两个字段**:baseUrl(实例根地址)与 personalAccessToken。字段名与上游
 * `definition.ts` 里 `custom_credential` 那份 auth 的 `fields` 逐字一致 —— 名字对不上就取不到值,
 * 而 `requireCredential` 会把它报成 internal(provider 自身的 bug)。
 *
 * 上游同一个 provider 还支持 Jira Cloud 的 OAuth2;那条路径要平台的 providerOAuth 支撑,
 * 不在本次迁移范围内(见 api.ts 顶部注释)。
 *
 * credentialProbe 选 `list_projects`:它 effect 为 read、无必填入参,且同时验到了三件事 ——
 * PAT 有效、baseUrl 指得对、这个 token 确实能读到项目。上游 credentialValidators 打的是
 * `/myself`,但那个端点没有对应的 action,不硬造一个只为当探针的工具。
 */

import {
  addComment,
  createIssue,
  getIssue,
  getProject,
  listIssueComments,
  listProjects,
  searchIssues,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { jiraActions } from './schema'

export type { ProviderEnv as Env }

export function createJiraPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Jira (Data Center / Server)',
    credentialFields: [
      {
        key: 'baseUrl',
        label: 'Instance URL',
        required: true,
        secret: false,
        description: 'Jira Data Center / Server 实例的根地址(https://jira.example.com,带部署上下文路径也可以),不要带 API 路径;必须是公网可达地址,私有网段会被出站策略拦下',
      },
      {
        key: 'personalAccessToken',
        label: 'Personal access token',
        required: true,
        secret: true,
        description: 'Jira Data Center / Server 的个人访问令牌,以 Bearer 发送',
      },
    ],
    credentialProbe: 'list_projects',
    actions: jiraActions,
    handlers: {
      list_projects: listProjects,
      get_project: getProject,
      search_issues: searchIssues,
      get_issue: getIssue,
      create_issue: createIssue,
      list_issue_comments: listIssueComments,
      add_comment: addComment,
    },
  })
}

export default createJiraPlugin()
