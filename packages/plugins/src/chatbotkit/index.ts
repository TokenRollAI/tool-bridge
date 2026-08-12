/**
 * ChatBotKit —— 从 open-connector 迁移的 provider(api_key,27 个 action:
 * bots / conversations / datasets / files)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  attachDatasetFile,
  completeConversation,
  createBot,
  createConversation,
  createConversationMessage,
  createDataset,
  createDatasetRecord,
  createFile,
  detachDatasetFile,
  downloadFile,
  fetchBot,
  fetchConversation,
  fetchDataset,
  fetchFile,
  fetchUsage,
  listBots,
  listConversationMessages,
  listConversations,
  listDatasetFiles,
  listDatasetRecords,
  listDatasets,
  listFiles,
  searchDataset,
  syncFile,
  updateBot,
  updateDataset,
  uploadFile,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { chatbotkitActions } from './schema'

export type { ProviderEnv as Env }

export function createChatbotkitPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'ChatBotKit',
    actions: chatbotkitActions,
    // 上游 credentialValidator 打的是 /team/list,那个端点没被迁成 action;
    // fetch_usage 同样只读、无入参,拿来当探针等价且更便宜。
    credentialProbe: 'fetch_usage',
    handlers: {
      fetch_usage: fetchUsage,
      list_bots: listBots,
      fetch_bot: fetchBot,
      create_bot: createBot,
      update_bot: updateBot,
      list_conversations: listConversations,
      fetch_conversation: fetchConversation,
      create_conversation: createConversation,
      list_conversation_messages: listConversationMessages,
      create_conversation_message: createConversationMessage,
      complete_conversation: completeConversation,
      list_datasets: listDatasets,
      fetch_dataset: fetchDataset,
      create_dataset: createDataset,
      update_dataset: updateDataset,
      list_dataset_records: listDatasetRecords,
      create_dataset_record: createDatasetRecord,
      search_dataset: searchDataset,
      list_files: listFiles,
      fetch_file: fetchFile,
      create_file: createFile,
      upload_file: uploadFile,
      download_file: downloadFile,
      sync_file: syncFile,
      list_dataset_files: listDatasetFiles,
      attach_dataset_file: attachDatasetFile,
      detach_dataset_file: detachDatasetFile,
    },
  })
}

export default createChatbotkitPlugin()
