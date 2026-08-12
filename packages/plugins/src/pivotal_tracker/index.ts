/**
 * Pivotal Tracker —— 从 open-connector 迁移的 provider(api_key,9 个 action:项目、故事、评论)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  createStory,
  createStoryComment,
  getCurrentUser,
  getProject,
  getStory,
  listProjects,
  listProjectStories,
  listStoryComments,
  updateStoryState,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { pivotalTrackerActions } from './schema'

export type { ProviderEnv as Env }

export function createPivotalTrackerPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Pivotal Tracker',
    actions: pivotalTrackerActions,
    // 上游 credentialValidator 也是打 /me 试凭证:只读、无入参、最便宜的一次调用。
    credentialProbe: 'get_current_user',
    handlers: {
      get_current_user: getCurrentUser,
      list_projects: listProjects,
      get_project: getProject,
      list_project_stories: listProjectStories,
      get_story: getStory,
      create_story: createStory,
      update_story_state: updateStoryState,
      list_story_comments: listStoryComments,
      create_story_comment: createStoryComment,
    },
  })
}

export default createPivotalTrackerPlugin()
