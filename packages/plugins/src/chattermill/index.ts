/**
 * Chattermill —— 从 open-connector 迁移的 provider(api_key,22 个 action:
 * projects / responses,以及 6 个资源族的 list+get)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  createResponse,
  deleteResponse,
  getAttribute,
  getCategory,
  getDataSource,
  getDataType,
  getMetric,
  getProject,
  getResponse,
  getTag,
  getTheme,
  listAttributes,
  listCategories,
  listCustomSegments,
  listDataSources,
  listDataTypes,
  listProjects,
  listResponses,
  listTags,
  listThemes,
  searchResponses,
  updateResponse,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { chattermillActions } from './schema'

export type { ProviderEnv as Env }

export function createChattermillPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Chattermill',
    actions: chattermillActions,
    // 上游 credentialValidator 也是打 /projects 试凭证:只读、无入参、最便宜。
    credentialProbe: 'list_projects',
    handlers: {
      list_projects: listProjects,
      get_project: getProject,
      list_responses: listResponses,
      get_response: getResponse,
      create_response: createResponse,
      update_response: updateResponse,
      delete_response: deleteResponse,
      search_responses: searchResponses,
      list_data_sources: listDataSources,
      get_data_source: getDataSource,
      list_data_types: listDataTypes,
      get_data_type: getDataType,
      list_custom_segments: listCustomSegments,
      get_metric: getMetric,
      list_themes: listThemes,
      get_theme: getTheme,
      list_categories: listCategories,
      get_category: getCategory,
      list_attributes: listAttributes,
      get_attribute: getAttribute,
      list_tags: listTags,
      get_tag: getTag,
    },
  })
}

export default createChattermillPlugin()
