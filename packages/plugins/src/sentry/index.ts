/**
 * Sentry —— 从 open-connector 迁移的 provider(**平台托管的 provider 型 OAuth2**,19 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * `oauth` 声明的四个值照抄上游 `definition.ts` 的 `auth[0]`:
 * - 两个端点**末尾都有斜杠**,Sentry 对无斜杠的形式会 301(授权跳转跟着重定向会丢参数)。
 * - `scopes` 是上游 `scopes.ts` 的全量五项;少一项就有 action 在运行期 403,而那时用户已经
 *   授权完了 —— 要重走一遍授权流程才能补。
 * - `scopeSeparator` 与 `clientAuth` 不写:缺省值(空格、`client_secret_post`)正是上游的
 *   `tokenEndpointAuthMethod: 'client_secret_post'`。
 *
 * client_id / client_secret **不在这里**:它们是每个部署自己去 sentry.io 注册应用拿到的,
 * 走 authRef 指向的多字段 secret(`clientId` + `clientSecret`),与其他上游凭证同一通道。
 *
 * **没有** `credentialProbe`,也**没有** `credentialFields` —— 声明了 `oauth` 再声明这两个
 * SDK 当场炸。探针尤其不能有:挂载时手上只有 client 凭证、还没有 access token,拿 client
 * 凭证去调探针等于把 clientSecret 送进插件。
 */

import {
  getAlert,
  getIssue,
  getIssueEvent,
  getOrganizationIntegration,
  getOrganizationIntegrationConfig,
  getOrganizationRelease,
  getProject,
  getReleaseHealthStats,
  getReplay,
  getSentryApp,
  listAlerts,
  listIssueEvents,
  listOrganizationIntegrations,
  listOrganizationIssues,
  listOrganizationProjects,
  listOrganizationReleases,
  listOrganizationReplays,
  listOrganizationSentryApps,
  updateIssue,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { sentryActions } from './schema'

export type { ProviderEnv as Env }

export function createSentryPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Sentry',
    actions: sentryActions,
    oauth: {
      authorizationUrl: 'https://sentry.io/oauth/authorize/',
      tokenUrl: 'https://sentry.io/oauth/token/',
      scopes: ['org:read', 'project:read', 'project:releases', 'event:read', 'event:write'],
    },
    handlers: {
      list_organization_integrations: listOrganizationIntegrations,
      get_organization_integration: getOrganizationIntegration,
      get_organization_integration_config: getOrganizationIntegrationConfig,
      list_organization_sentry_apps: listOrganizationSentryApps,
      get_sentry_app: getSentryApp,
      list_organization_projects: listOrganizationProjects,
      get_project: getProject,
      list_organization_issues: listOrganizationIssues,
      get_issue: getIssue,
      get_issue_event: getIssueEvent,
      list_issue_events: listIssueEvents,
      update_issue: updateIssue,
      list_organization_releases: listOrganizationReleases,
      get_organization_release: getOrganizationRelease,
      get_release_health_stats: getReleaseHealthStats,
      list_organization_replays: listOrganizationReplays,
      get_replay: getReplay,
      list_alerts: listAlerts,
      get_alert: getAlert,
    },
  })
}

export default createSentryPlugin()
