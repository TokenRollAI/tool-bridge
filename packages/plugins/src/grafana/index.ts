/**
 * Grafana —— 从 open-connector 迁移的 provider(api_key,19 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 实例地址走 `providerConfig.baseUrl`(**必配**,非 secret,见 `api.ts` 顶部注释);
 * service account token 走 authRef → `ctx.upstreamAuth`。
 *
 * credentialProbe 选 `search_dashboards`:上游 credentialValidators 打的 `/api/org` 没有对应
 * action,而 `search_dashboards` 同样只读、无必填入参,且一次验到两件事 —— token 有效、
 * baseUrl 指得对。没选 `list_data_sources`(它要 `datasources:read`,Viewer 角色的服务账号会
 * 403,那会把一个好凭证误判成配错)、也没选 `list_folders`(它走 App Platform API,老版本
 * Grafana 上根本没有那组端点,同样会误判)。
 */

import {
  createDashboard,
  createDataSource,
  createFolder,
  deleteDashboard,
  deleteDataSource,
  deleteFolder,
  getAlertRule,
  getDashboard,
  getDataSource,
  getFolder,
  listAlertInstances,
  listAlertRules,
  listContactPoints,
  listDataSources,
  listFolders,
  searchDashboards,
  updateDashboard,
  updateDataSource,
  updateFolder,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { grafanaActions } from './schema'

export type { ProviderEnv as Env }

export function createGrafanaPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Grafana',
    actions: grafanaActions,
    credentialProbe: 'search_dashboards',
    mountConfigFields: [{
      key: 'baseUrl',
      label: '实例地址',
      description: 'Grafana 实例根地址(Cloud 或自建),如 https://x.grafana.net',
      required: true,
    }],
    handlers: {
      list_folders: listFolders,
      get_folder: getFolder,
      create_folder: createFolder,
      update_folder: updateFolder,
      delete_folder: deleteFolder,
      search_dashboards: searchDashboards,
      get_dashboard: getDashboard,
      create_dashboard: createDashboard,
      update_dashboard: updateDashboard,
      delete_dashboard: deleteDashboard,
      list_data_sources: listDataSources,
      get_data_source: getDataSource,
      create_data_source: createDataSource,
      update_data_source: updateDataSource,
      delete_data_source: deleteDataSource,
      list_alert_rules: listAlertRules,
      get_alert_rule: getAlertRule,
      list_alert_instances: listAlertInstances,
      list_contact_points: listContactPoints,
    },
  })
}

export default createGrafanaPlugin()
