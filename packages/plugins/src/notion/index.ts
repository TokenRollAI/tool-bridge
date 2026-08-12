/**
 * Notion(公开 API)—— 从 open-connector 迁移的 provider(25 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明(`create_page` / `move_page` 的 parent 是
 * 三分支联合,走同目录 `schema.handwritten.ts`,已在 `handwritten.json` 登记),`api.ts` 是
 * 人工改写的业务逻辑,本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 凭证是**单值**:Notion 的 internal integration secret(`secret_...`)或 OAuth access token,
 * 走 `Authorization: Bearer`,另带必需的 `Notion-Version` 头(见 api.ts)。上游 `definition.ts`
 * 还声明了 OAuth2,那条路径要平台的 providerOAuth 支撑;两者拿到的都是 Bearer token。
 *
 * **不声明 credentialProbe。** 上游 credentialValidators 打的是 `/users/me`,但本 provider 没有
 * 对应的 action;唯一"read + 零必填入参"的候选是 `list_users`,而 Notion 的 integration 默认
 * **不带**读取用户信息的 capability —— 拿它当探针会让一个完全可用的 token 在挂载时被 403 拒掉。
 * 宁可不探,也不能把正常配置判成配错。(`search` 对任何 integration 都可用,但生成的 schema 里
 * 它的 effect 是 write,而探针必须是 read。)
 */

import {
  appendBlock,
  appendBlockChildren,
  createDatabase,
  createDataSource,
  createPage,
  deleteBlock,
  getPage,
  listBlockChildren,
  listDataSourceTemplates,
  listUsers,
  movePage,
  queryDataSource,
  retrieveBlock,
  retrieveDatabase,
  retrieveDataSource,
  retrievePage,
  retrievePageMarkdown,
  retrievePageProperty,
  retrieveUser,
  search,
  updateBlock,
  updateDatabase,
  updateDataSource,
  updatePage,
  updatePageMarkdown,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { notionActions } from './schema'

export type { ProviderEnv as Env }

export function createNotionPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Notion',
    actions: notionActions,
    handlers: {
      search,
      get_page: getPage,
      create_page: createPage,
      update_page: updatePage,
      move_page: movePage,
      append_block: appendBlock,
      retrieve_page: retrievePage,
      retrieve_page_markdown: retrievePageMarkdown,
      update_page_markdown: updatePageMarkdown,
      retrieve_page_property: retrievePageProperty,
      list_users: listUsers,
      retrieve_user: retrieveUser,
      retrieve_block: retrieveBlock,
      list_block_children: listBlockChildren,
      append_block_children: appendBlockChildren,
      update_block: updateBlock,
      delete_block: deleteBlock,
      create_database: createDatabase,
      retrieve_database: retrieveDatabase,
      update_database: updateDatabase,
      create_data_source: createDataSource,
      retrieve_data_source: retrieveDataSource,
      update_data_source: updateDataSource,
      query_data_source: queryDataSource,
      list_data_source_templates: listDataSourceTemplates,
    },
  })
}

export default createNotionPlugin()
