/**
 * ChatBotKit 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const fetchUsageInput = z.strictObject({}).describe('No additional input.')

export const fetchUsageOutput = z.looseObject({}).describe('ChatBotKit usage statistics.')

export const listBotsInput = z.strictObject({
  take: z.int().min(1).describe('The maximum number of items to retrieve.').optional(),
  cursor: z.string().min(1).describe('The cursor for fetching the next page of results.').optional(),
  order: z.enum(['asc', 'desc']).describe('The sort order to use when paginating results.').optional(),
  meta: z.record(z.string(), z.string().describe('The metadata field value.')).describe('String metadata filters encoded into the query string.').optional(),
}).describe('ChatBotKit pagination and metadata filters.')

export const listBotsOutput = z.strictObject({
  items: z.array(z.looseObject({}).describe('ChatBotKit resource object.')).describe('Bot items returned by ChatBotKit.'),
  cursor: z.string().min(1).describe('The cursor for fetching the next page of results.').optional(),
}).describe('Bot items returned by ChatBotKit.')

export const fetchBotInput = z.strictObject({
  botId: z.string().min(1).describe('The unique identifier of the resource.'),
})

export const fetchBotOutput = z.looseObject({}).describe('ChatBotKit resource object.')

export const createBotInput = z.looseObject({}).describe('Bot fields accepted by ChatBotKit.')

export const createBotOutput = z.strictObject({
  id: z.string().min(1).describe('The unique identifier of the resource.'),
}).describe('ChatBotKit identifier response.')

export const updateBotInput = z.looseObject({
  botId: z.string().min(1).describe('The unique identifier of the resource.').optional(),
}).describe('Bot update fields accepted by ChatBotKit.')

export const updateBotOutput = z.strictObject({
  id: z.string().min(1).describe('The unique identifier of the resource.'),
}).describe('ChatBotKit identifier response.')

export const listConversationsInput = z.strictObject({
  take: z.int().min(1).describe('The maximum number of items to retrieve.').optional(),
  cursor: z.string().min(1).describe('The cursor for fetching the next page of results.').optional(),
  order: z.enum(['asc', 'desc']).describe('The sort order to use when paginating results.').optional(),
  meta: z.record(z.string(), z.string().describe('The metadata field value.')).describe('String metadata filters encoded into the query string.').optional(),
}).describe('ChatBotKit pagination and metadata filters.')

export const listConversationsOutput = z.strictObject({
  items: z.array(z.looseObject({}).describe('ChatBotKit resource object.')).describe('Conversation items returned by ChatBotKit.'),
  cursor: z.string().min(1).describe('The cursor for fetching the next page of results.').optional(),
}).describe('Conversation items returned by ChatBotKit.')

export const fetchConversationInput = z.strictObject({
  conversationId: z.string().min(1).describe('The unique identifier of the resource.'),
})

export const fetchConversationOutput = z.looseObject({}).describe('ChatBotKit resource object.')

export const createConversationInput = z.looseObject({}).describe('Conversation fields accepted by ChatBotKit.')

export const createConversationOutput = z.looseObject({}).describe('Created conversation response.')

export const listConversationMessagesInput = z.strictObject({
  conversationId: z.string().min(1).describe('The unique identifier of the resource.'),
  take: z.int().min(1).describe('The maximum number of items to retrieve.').optional(),
  cursor: z.string().min(1).describe('The cursor for fetching the next page of results.').optional(),
  order: z.enum(['asc', 'desc']).describe('The sort order to use when paginating results.').optional(),
  meta: z.record(z.string(), z.string().describe('The metadata field value.')).describe('String metadata filters encoded into the query string.').optional(),
}).describe('Conversation message list input.')

export const listConversationMessagesOutput = z.strictObject({
  items: z.array(z.looseObject({}).describe('ChatBotKit resource object.')).describe('Conversation message items returned by ChatBotKit.'),
  cursor: z.string().min(1).describe('The cursor for fetching the next page of results.').optional(),
}).describe('Conversation message items returned by ChatBotKit.')

export const createConversationMessageInput = z.looseObject({
  conversationId: z.string().min(1).describe('The unique identifier of the resource.').optional(),
}).describe('Conversation message creation input.')

export const createConversationMessageOutput = z.looseObject({}).describe('Created conversation message response.')

export const completeConversationInput = z.looseObject({
  conversationId: z.string().min(1).describe('The unique identifier of the resource.').optional(),
}).describe('Conversation completion input.')

export const completeConversationOutput = z.looseObject({}).describe('Conversation completion response.')

export const listDatasetsInput = z.strictObject({
  take: z.int().min(1).describe('The maximum number of items to retrieve.').optional(),
  cursor: z.string().min(1).describe('The cursor for fetching the next page of results.').optional(),
  order: z.enum(['asc', 'desc']).describe('The sort order to use when paginating results.').optional(),
  meta: z.record(z.string(), z.string().describe('The metadata field value.')).describe('String metadata filters encoded into the query string.').optional(),
}).describe('ChatBotKit pagination and metadata filters.')

export const listDatasetsOutput = z.strictObject({
  items: z.array(z.looseObject({}).describe('ChatBotKit resource object.')).describe('Dataset items returned by ChatBotKit.'),
  cursor: z.string().min(1).describe('The cursor for fetching the next page of results.').optional(),
}).describe('Dataset items returned by ChatBotKit.')

export const fetchDatasetInput = z.strictObject({
  datasetId: z.string().min(1).describe('The unique identifier of the resource.'),
})

export const fetchDatasetOutput = z.looseObject({}).describe('ChatBotKit resource object.')

export const createDatasetInput = z.looseObject({}).describe('Dataset fields accepted by ChatBotKit.')

export const createDatasetOutput = z.strictObject({
  id: z.string().min(1).describe('The unique identifier of the resource.'),
}).describe('ChatBotKit identifier response.')

export const updateDatasetInput = z.looseObject({
  datasetId: z.string().min(1).describe('The unique identifier of the resource.').optional(),
}).describe('Dataset update fields accepted by ChatBotKit.')

export const updateDatasetOutput = z.strictObject({
  id: z.string().min(1).describe('The unique identifier of the resource.'),
}).describe('ChatBotKit identifier response.')

export const listDatasetRecordsInput = z.strictObject({
  datasetId: z.string().min(1).describe('The unique identifier of the resource.'),
  take: z.int().min(1).describe('The maximum number of items to retrieve.').optional(),
  cursor: z.string().min(1).describe('The cursor for fetching the next page of results.').optional(),
  order: z.enum(['asc', 'desc']).describe('The sort order to use when paginating results.').optional(),
  meta: z.record(z.string(), z.string().describe('The metadata field value.')).describe('String metadata filters encoded into the query string.').optional(),
}).describe('Dataset record list input.')

export const listDatasetRecordsOutput = z.strictObject({
  items: z.array(z.looseObject({}).describe('ChatBotKit resource object.')).describe('Dataset records returned by ChatBotKit.'),
  cursor: z.string().min(1).describe('The cursor for fetching the next page of results.').optional(),
}).describe('Dataset records returned by ChatBotKit.')

export const createDatasetRecordInput = z.looseObject({
  datasetId: z.string().min(1).describe('The unique identifier of the resource.').optional(),
}).describe('Dataset record creation input.')

export const createDatasetRecordOutput = z.strictObject({
  id: z.string().min(1).describe('The unique identifier of the resource.'),
}).describe('ChatBotKit identifier response.')

export const searchDatasetInput = z.looseObject({
  datasetId: z.string().min(1).describe('The unique identifier of the resource.').optional(),
}).describe('Dataset search input.')

export const searchDatasetOutput = z.strictObject({
  items: z.array(z.looseObject({}).describe('ChatBotKit resource object.')).describe('Matching records.').optional(),
})

export const listFilesInput = z.strictObject({
  take: z.int().min(1).describe('The maximum number of items to retrieve.').optional(),
  cursor: z.string().min(1).describe('The cursor for fetching the next page of results.').optional(),
  order: z.enum(['asc', 'desc']).describe('The sort order to use when paginating results.').optional(),
  meta: z.record(z.string(), z.string().describe('The metadata field value.')).describe('String metadata filters encoded into the query string.').optional(),
}).describe('ChatBotKit pagination and metadata filters.')

export const listFilesOutput = z.strictObject({
  items: z.array(z.looseObject({}).describe('ChatBotKit resource object.')).describe('File items returned by ChatBotKit.'),
  cursor: z.string().min(1).describe('The cursor for fetching the next page of results.').optional(),
}).describe('File items returned by ChatBotKit.')

export const fetchFileInput = z.strictObject({
  fileId: z.string().min(1).describe('The unique identifier of the resource.'),
})

export const fetchFileOutput = z.looseObject({}).describe('ChatBotKit resource object.')

export const createFileInput = z.looseObject({}).describe('File fields accepted by ChatBotKit.')

export const createFileOutput = z.strictObject({
  id: z.string().min(1).describe('The unique identifier of the resource.'),
}).describe('ChatBotKit identifier response.')

export const uploadFileInput = z.looseObject({
  fileId: z.string().min(1).describe('The unique identifier of the resource.').optional(),
}).describe('File upload input.')

export const uploadFileOutput = z.looseObject({}).describe('File upload response.')

export const downloadFileInput = z.strictObject({
  fileId: z.string().min(1).describe('The unique identifier of the resource.'),
})

export const downloadFileOutput = z.looseObject({}).describe('File download response.')

export const syncFileInput = z.strictObject({
  fileId: z.string().min(1).describe('The unique identifier of the resource.'),
})

export const syncFileOutput = z.strictObject({
  id: z.string().min(1).describe('The unique identifier of the resource.'),
}).describe('ChatBotKit identifier response.')

export const listDatasetFilesInput = z.strictObject({
  datasetId: z.string().min(1).describe('The unique identifier of the resource.'),
  take: z.int().min(1).describe('The maximum number of items to retrieve.').optional(),
  cursor: z.string().min(1).describe('The cursor for fetching the next page of results.').optional(),
  order: z.enum(['asc', 'desc']).describe('The sort order to use when paginating results.').optional(),
  meta: z.record(z.string(), z.string().describe('The metadata field value.')).describe('String metadata filters encoded into the query string.').optional(),
}).describe('Dataset file list input.')

export const listDatasetFilesOutput = z.strictObject({
  items: z.array(z.looseObject({}).describe('ChatBotKit resource object.')).describe('Files attached to the dataset.'),
  cursor: z.string().min(1).describe('The cursor for fetching the next page of results.').optional(),
}).describe('Files attached to the dataset.')

export const attachDatasetFileInput = z.strictObject({
  datasetId: z.string().min(1).describe('The unique identifier of the resource.'),
  fileId: z.string().min(1).describe('The unique identifier of the resource.'),
  type: z.literal('source').describe('The attachment type.'),
})

export const attachDatasetFileOutput = z.strictObject({
  id: z.string().min(1).describe('The unique identifier of the resource.'),
}).describe('ChatBotKit identifier response.')

export const detachDatasetFileInput = z.strictObject({
  datasetId: z.string().min(1).describe('The unique identifier of the resource.'),
  fileId: z.string().min(1).describe('The unique identifier of the resource.'),
  deleteRecords: z.boolean().describe('Whether associated records should also be deleted.').optional(),
}).describe('Dataset file detach input.')

export const detachDatasetFileOutput = z.strictObject({
  id: z.string().min(1).describe('The unique identifier of the resource.'),
}).describe('ChatBotKit identifier response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const chatbotkitActions = {
  fetch_usage: {
    description: 'Fetch account-wide ChatBotKit usage statistics.',
    effect: 'read',
    inputSchema: fetchUsageInput,
    outputSchema: z.toJSONSchema(fetchUsageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_bots: {
    description: 'List ChatBotKit bots with optional pagination and metadata filtering.',
    effect: 'read',
    inputSchema: listBotsInput,
    outputSchema: z.toJSONSchema(listBotsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  fetch_bot: {
    description: 'Fetch a single ChatBotKit bot by ID.',
    effect: 'read',
    inputSchema: fetchBotInput,
    outputSchema: z.toJSONSchema(fetchBotOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_bot: {
    description: 'Create a new ChatBotKit bot.',
    effect: 'write',
    inputSchema: createBotInput,
    outputSchema: z.toJSONSchema(createBotOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_bot: {
    description: 'Update an existing ChatBotKit bot.',
    effect: 'write',
    inputSchema: updateBotInput,
    outputSchema: z.toJSONSchema(updateBotOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_conversations: {
    description: 'List ChatBotKit conversations with optional pagination and metadata filtering.',
    effect: 'read',
    inputSchema: listConversationsInput,
    outputSchema: z.toJSONSchema(listConversationsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  fetch_conversation: {
    description: 'Fetch a single ChatBotKit conversation by ID.',
    effect: 'read',
    inputSchema: fetchConversationInput,
    outputSchema: z.toJSONSchema(fetchConversationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_conversation: {
    description: 'Create a new ChatBotKit conversation.',
    effect: 'write',
    inputSchema: createConversationInput,
    outputSchema: z.toJSONSchema(createConversationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_conversation_messages: {
    description: 'List messages inside a ChatBotKit conversation.',
    effect: 'read',
    inputSchema: listConversationMessagesInput,
    outputSchema: z.toJSONSchema(listConversationMessagesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_conversation_message: {
    description: 'Append a message to an existing ChatBotKit conversation.',
    effect: 'write',
    inputSchema: createConversationMessageInput,
    outputSchema: z.toJSONSchema(createConversationMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  complete_conversation: {
    description: 'Send a message to a ChatBotKit conversation and receive the next assistant reply.',
    effect: 'write',
    inputSchema: completeConversationInput,
    outputSchema: z.toJSONSchema(completeConversationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_datasets: {
    description: 'List ChatBotKit datasets with optional pagination and metadata filtering.',
    effect: 'read',
    inputSchema: listDatasetsInput,
    outputSchema: z.toJSONSchema(listDatasetsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  fetch_dataset: {
    description: 'Fetch a single ChatBotKit dataset by ID.',
    effect: 'read',
    inputSchema: fetchDatasetInput,
    outputSchema: z.toJSONSchema(fetchDatasetOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_dataset: {
    description: 'Create a new ChatBotKit dataset for knowledge retrieval.',
    effect: 'write',
    inputSchema: createDatasetInput,
    outputSchema: z.toJSONSchema(createDatasetOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_dataset: {
    description: 'Update an existing ChatBotKit dataset.',
    effect: 'write',
    inputSchema: updateDatasetInput,
    outputSchema: z.toJSONSchema(updateDatasetOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_dataset_records: {
    description: 'List records inside a ChatBotKit dataset.',
    effect: 'read',
    inputSchema: listDatasetRecordsInput,
    outputSchema: z.toJSONSchema(listDatasetRecordsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_dataset_record: {
    description: 'Create a new record inside a ChatBotKit dataset.',
    effect: 'write',
    inputSchema: createDatasetRecordInput,
    outputSchema: z.toJSONSchema(createDatasetRecordOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_dataset: {
    description: 'Run semantic search against a ChatBotKit dataset.',
    effect: 'read',
    inputSchema: searchDatasetInput,
    outputSchema: z.toJSONSchema(searchDatasetOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_files: {
    description: 'List ChatBotKit files with optional pagination and metadata filtering.',
    effect: 'read',
    inputSchema: listFilesInput,
    outputSchema: z.toJSONSchema(listFilesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  fetch_file: {
    description: 'Fetch a single ChatBotKit file by ID.',
    effect: 'read',
    inputSchema: fetchFileInput,
    outputSchema: z.toJSONSchema(fetchFileOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_file: {
    description: 'Create a new ChatBotKit file resource.',
    effect: 'write',
    inputSchema: createFileInput,
    outputSchema: z.toJSONSchema(createFileOutput, { io: 'output', unrepresentable: 'any' }),
  },
  upload_file: {
    description: 'Upload content to an existing ChatBotKit file using official JSON upload modes.',
    effect: 'write',
    inputSchema: uploadFileInput,
    outputSchema: z.toJSONSchema(uploadFileOutput, { io: 'output', unrepresentable: 'any' }),
  },
  download_file: {
    description: 'Fetch the download URL for an existing ChatBotKit file.',
    effect: 'read',
    inputSchema: downloadFileInput,
    outputSchema: z.toJSONSchema(downloadFileOutput, { io: 'output', unrepresentable: 'any' }),
  },
  sync_file: {
    description: 'Trigger synchronization for an existing ChatBotKit file.',
    effect: 'write',
    inputSchema: syncFileInput,
    outputSchema: z.toJSONSchema(syncFileOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_dataset_files: {
    description: 'List files attached to a ChatBotKit dataset.',
    effect: 'read',
    inputSchema: listDatasetFilesInput,
    outputSchema: z.toJSONSchema(listDatasetFilesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  attach_dataset_file: {
    description: 'Attach an existing ChatBotKit file to a dataset.',
    effect: 'write',
    inputSchema: attachDatasetFileInput,
    outputSchema: z.toJSONSchema(attachDatasetFileOutput, { io: 'output', unrepresentable: 'any' }),
  },
  detach_dataset_file: {
    description: 'Detach a ChatBotKit file from a dataset.',
    effect: 'write',
    inputSchema: detachDatasetFileInput,
    outputSchema: z.toJSONSchema(detachDatasetFileOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
