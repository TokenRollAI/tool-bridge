/**
 * CompanyCam —— 从 open-connector 迁移的 provider(api_key,15 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  archiveProject,
  createProject,
  createTag,
  deleteTag,
  getCompany,
  getCurrentUser,
  getProject,
  getTag,
  getUser,
  listProjects,
  listTags,
  listUsers,
  restoreProject,
  updateProject,
  updateTag,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { companycamActions } from './schema'

export type { ProviderEnv as Env }

export function createCompanycamPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'CompanyCam',
    actions: companycamActions,
    // 上游 credentialValidators 也是打 /company 验凭证:只读、无入参,直接沿用。
    credentialProbe: 'get_company',
    handlers: {
      get_company: getCompany,
      get_current_user: getCurrentUser,
      list_projects: listProjects,
      get_project: getProject,
      create_project: createProject,
      update_project: updateProject,
      archive_project: archiveProject,
      restore_project: restoreProject,
      list_users: listUsers,
      get_user: getUser,
      list_tags: listTags,
      get_tag: getTag,
      create_tag: createTag,
      update_tag: updateTag,
      delete_tag: deleteTag,
    },
  })
}

export default createCompanycamPlugin()
