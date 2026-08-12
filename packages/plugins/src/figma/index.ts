/**
 * Figma —— 从 open-connector 迁移的 provider(26 个文件/评论/库/dev resource action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * `update_dev_resources` 走**手写豁免**(见 `schema.handwritten.ts`):它的 inputSchema 在
 * 数组元素上带 Zod 无法反推进 JSON Schema 的组合约束。
 *
 * credentialProbe 选 `get_current_user`:read、零入参,打的正是上游 credentialValidators
 * 用来验凭证的 `/v1/me`。
 */

import {
  createDevResources,
  deleteComment,
  deleteCommentReaction,
  deleteDevResource,
  getComponent,
  getComponentSet,
  getCurrentUser,
  getDevResources,
  getFile,
  getFileMetadata,
  getFileNodes,
  getImageFills,
  getProjectMetadata,
  getStyle,
  listCommentReactions,
  listComments,
  listFileComponents,
  listFileComponentSets,
  listFileStyles,
  listFileVersions,
  listProjectFiles,
  listTeamProjects,
  postComment,
  postCommentReaction,
  renderImages,
  updateDevResources,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { figmaActions } from './schema'

export type { ProviderEnv as Env }

export function createFigmaPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Figma',
    actions: figmaActions,
    credentialProbe: 'get_current_user',
    handlers: {
      get_current_user: getCurrentUser,
      get_file_metadata: getFileMetadata,
      get_file: getFile,
      get_file_nodes: getFileNodes,
      render_images: renderImages,
      get_image_fills: getImageFills,
      list_file_versions: listFileVersions,
      list_comments: listComments,
      post_comment: postComment,
      delete_comment: deleteComment,
      list_comment_reactions: listCommentReactions,
      post_comment_reaction: postCommentReaction,
      delete_comment_reaction: deleteCommentReaction,
      list_team_projects: listTeamProjects,
      get_project_metadata: getProjectMetadata,
      list_project_files: listProjectFiles,
      list_file_components: listFileComponents,
      list_file_component_sets: listFileComponentSets,
      list_file_styles: listFileStyles,
      get_component: getComponent,
      get_component_set: getComponentSet,
      get_style: getStyle,
      get_dev_resources: getDevResources,
      create_dev_resources: createDevResources,
      update_dev_resources: updateDevResources,
      delete_dev_resource: deleteDevResource,
    },
  })
}

export default createFigmaPlugin()
