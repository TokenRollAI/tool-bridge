/**
 * Todoist(API v1)—— 从 open-connector 迁移的 provider(19 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 凭证是**单值**:Todoist 的 OAuth access token 或个人 API token,走 `Authorization: Bearer`。
 * 上游 `definition.ts` 还声明了 OAuth2 授权码流,那条路径要平台的 providerOAuth 支撑;两者
 * 拿到的都是 Bearer token,补 OAuth 时 handler 一行都不用改(但要去掉下面的 credentialProbe ——
 * SDK 侧 oauth 与 credentialProbe/credentialFields 互斥)。
 *
 * credentialProbe 选 `get_current_user`:上游 credentialValidators 打的正是 `/user`,
 * 且它 effect 为 read、零入参 —— 三个条件都满足。
 */

import {
  closeTask,
  createComment,
  createProject,
  createSection,
  createTask,
  getComment,
  getCurrentUser,
  getProject,
  getSection,
  getTask,
  listComments,
  listLabels,
  listProjects,
  listSections,
  listTasks,
  updateComment,
  updateProject,
  updateSection,
  updateTask,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { todoistActions } from './schema'

export type { ProviderEnv as Env }

export function createTodoistPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Todoist',
    actions: todoistActions,
    credentialProbe: 'get_current_user',
    handlers: {
      get_current_user: getCurrentUser,
      list_projects: listProjects,
      get_project: getProject,
      create_project: createProject,
      update_project: updateProject,
      list_sections: listSections,
      get_section: getSection,
      create_section: createSection,
      update_section: updateSection,
      list_tasks: listTasks,
      get_task: getTask,
      create_task: createTask,
      update_task: updateTask,
      close_task: closeTask,
      list_comments: listComments,
      get_comment: getComment,
      create_comment: createComment,
      update_comment: updateComment,
      list_labels: listLabels,
    },
  })
}

export default createTodoistPlugin()
