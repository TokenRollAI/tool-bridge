/**
 * Rocketlane —— 从 open-connector 迁移的 provider(api_key,6 个 action,全部只读)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { getProject, getTask, getUser, listProjects, listTasks, listUsers } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { rocketlaneActions } from './schema'

export type { ProviderEnv as Env }

export function createRocketlanePlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Rocketlane',
    actions: rocketlaneActions,
    // 上游 credentialValidators 打的就是 /1.0/users —— 只读、无必填入参。
    credentialProbe: 'list_users',
    handlers: {
      list_projects: listProjects,
      get_project: getProject,
      list_tasks: listTasks,
      get_task: getTask,
      list_users: listUsers,
      get_user: getUser,
    },
  })
}

export default createRocketlanePlugin()
