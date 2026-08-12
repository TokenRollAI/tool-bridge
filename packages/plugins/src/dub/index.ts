/**
 * Dub —— 从 open-connector 迁移的 provider(api_key,15 个 action:links / tags / folders / analytics)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  countLinks,
  createFolder,
  createLink,
  createTag,
  deleteFolder,
  deleteLink,
  deleteTag,
  listFolders,
  listLinks,
  listTags,
  retrieveAnalytics,
  retrieveLink,
  updateFolder,
  updateLink,
  updateTag,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { dubActions } from './schema'

export type { ProviderEnv as Env }

export function createDubPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Dub',
    actions: dubActions,
    // 上游 credentialValidators 也是打 /links/count 试凭证:只读、无必填入参,最便宜。
    credentialProbe: 'count_links',
    handlers: {
      create_link: createLink,
      list_links: listLinks,
      retrieve_link: retrieveLink,
      update_link: updateLink,
      delete_link: deleteLink,
      count_links: countLinks,
      list_tags: listTags,
      create_tag: createTag,
      update_tag: updateTag,
      delete_tag: deleteTag,
      list_folders: listFolders,
      create_folder: createFolder,
      update_folder: updateFolder,
      delete_folder: deleteFolder,
      retrieve_analytics: retrieveAnalytics,
    },
  })
}

export default createDubPlugin()
