/**
 * Mem0 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const addMemoriesInput = z.strictObject({
  memory: z.string().min(1).describe('A single memory string to write directly.').optional(),
  messages: z.array(z.strictObject({
    role: z.string().min(1).describe('The message role, such as user or assistant.').optional(),
    content: z.string().min(1).describe('The text content of the message.').optional(),
  }).describe('A single message used to create or update memory.')).min(1).describe('The list of messages used to generate memory.').optional(),
  user_id: z.string().min(1).describe('The associated user identifier.').optional(),
  agent_id: z.string().min(1).describe('The associated agent identifier.').optional(),
  app_id: z.string().min(1).describe('The associated application identifier.').optional(),
  run_id: z.string().min(1).describe('The associated run identifier.').optional(),
  org_id: z.string().min(1).describe('An optional organization identifier.').optional(),
  project_id: z.string().min(1).describe('An optional project identifier.').optional(),
  metadata: z.looseObject({}).describe('An arbitrary JSON object returned by Mem0.').optional(),
  custom_categories: z.record(z.string(), z.string().describe('A category description.')).describe('A map of custom category names to their descriptions.').optional(),
  enable_graph: z.boolean().describe('Whether graph memory extraction should be enabled for this request.').optional(),
  infer: z.boolean().describe('Whether Mem0 should infer structured memory from the messages.').optional(),
  async_mode: z.boolean().describe('Whether the write should be processed asynchronously.').optional(),
  output_format: z.enum(['v1.0', 'v1.1']).describe('The response wrapper format version.').optional(),
  version: z.enum(['v1', 'v2']).describe('The memory extraction engine version.').optional(),
  custom_instructions: z.string().min(1).describe('Additional instructions used to guide memory extraction.').optional(),
  immutable: z.boolean().describe('Whether the created memory should be treated as immutable.').optional(),
  timestamp: z.int().describe('The Unix timestamp associated with the memory input.').optional(),
  expiration_date: z.string().min(1).describe('The expiration date to attach to the created memory.').optional(),
  includes: z.string().min(1).describe('A string list of keywords that should be prioritized.').optional(),
  excludes: z.string().min(1).describe('A string list of keywords that should be excluded.').optional(),
}).describe('The input payload for adding memories to Mem0.')

export const addMemoriesOutput = z.union([z.array(z.union([z.strictObject({
  event_id: z.string().describe('The asynchronous event identifier.').optional(),
  status: z.string().describe('The asynchronous processing status.').optional(),
  message: z.string().describe('A status message for asynchronous processing.').optional(),
}).describe('An asynchronous add_memories result item.'), z.looseObject({
  id: z.string().describe('The identifier of the created or updated memory.').optional(),
  event: z.string().describe('The event type associated with this result.').optional(),
  memory: z.string().describe('The generated memory text returned by Mem0.').optional(),
  structured_attributes: z.looseObject({}).describe('The structured attributes extracted for the generated memory.').optional(),
}).describe('A processed add_memories result item with top-level memory fields.'), z.looseObject({
  id: z.string().describe('The identifier of the created or updated memory.').optional(),
  event: z.string().describe('The event type associated with this result.').optional(),
  data: z.looseObject({
    memory: z.string().describe('The generated memory text returned by Mem0.').optional(),
    structured_attributes: z.looseObject({}).describe('The structured attributes extracted for the generated memory.').optional(),
  }).describe('The nested memory payload returned by Mem0.').optional(),
}).describe('A processed add_memories result item with nested data.')]).describe('A single result item returned by add_memories.')).describe('The list of memory creation results.'), z.strictObject({
  results: z.array(z.union([z.strictObject({
    event_id: z.string().describe('The asynchronous event identifier.').optional(),
    status: z.string().describe('The asynchronous processing status.').optional(),
    message: z.string().describe('A status message for asynchronous processing.').optional(),
  }).describe('An asynchronous add_memories result item.'), z.looseObject({
    id: z.string().describe('The identifier of the created or updated memory.').optional(),
    event: z.string().describe('The event type associated with this result.').optional(),
    memory: z.string().describe('The generated memory text returned by Mem0.').optional(),
    structured_attributes: z.looseObject({}).describe('The structured attributes extracted for the generated memory.').optional(),
  }).describe('A processed add_memories result item with top-level memory fields.'), z.looseObject({
    id: z.string().describe('The identifier of the created or updated memory.').optional(),
    event: z.string().describe('The event type associated with this result.').optional(),
    data: z.looseObject({
      memory: z.string().describe('The generated memory text returned by Mem0.').optional(),
      structured_attributes: z.looseObject({}).describe('The structured attributes extracted for the generated memory.').optional(),
    }).describe('The nested memory payload returned by Mem0.').optional(),
  }).describe('A processed add_memories result item with nested data.')]).describe('A single result item returned by add_memories.')).describe('The list of memory creation results.').optional(),
}).describe('A memory creation response wrapped in the v1.1 format.')]).describe('The response payload for mem0.add_memories.')

export const getMemoriesInput = z.strictObject({
  filters: z.looseObject({}).describe('The advanced filter object supported by the Mem0 v2 memories API.'),
  page: z.int().min(1).describe('The page number to request, starting from 1.').optional(),
  page_size: z.int().min(1).max(100).describe('The maximum number of results per page, up to 100.').optional(),
  org_id: z.string().min(1).describe('An optional organization identifier.').optional(),
  project_id: z.string().min(1).describe('An optional project identifier.').optional(),
}).describe('The input payload for listing memories with advanced filters.')

export const getMemoriesOutput = z.array(z.looseObject({
  id: z.string().describe('The unique identifier of the memory.').optional(),
  memory: z.string().describe('The memory text content.').optional(),
  text: z.string().describe('The updated memory text returned by some write operations.').optional(),
  hash: z.string().describe('The content hash of the memory.').optional(),
  user_id: z.string().describe('The associated user identifier.').optional(),
  agent_id: z.string().describe('The associated agent identifier.').optional(),
  app_id: z.string().describe('The associated application identifier.').optional(),
  run_id: z.string().describe('The associated run identifier.').optional(),
  metadata: z.looseObject({}).describe('An arbitrary JSON object returned by Mem0.').optional(),
  categories: z.array(z.string().describe('One category.')).describe('The categories assigned to the memory.').optional(),
  created_at: z.string().describe('The timestamp when the memory was created.').optional(),
  updated_at: z.string().describe('The timestamp when the memory was last updated.').optional(),
  expiration_date: z.string().describe('The expiration date of the memory.').optional(),
  score: z.number().describe('The relevance score returned by search results.').optional(),
  input: z.array(z.strictObject({
    role: z.string().min(1).describe('The message role, such as user or assistant.').optional(),
    content: z.string().min(1).describe('The text content of the message.').optional(),
  }).describe('A single message used to create or update memory.')).describe('The input messages used to generate the memory.').optional(),
  structured_attributes: z.looseObject({}).describe('Structured attributes extracted from the memory.').optional(),
}).describe('A Mem0 memory object.')).describe('The list of Mem0 memories matching the advanced filters.')

export const searchMemoriesInput = z.strictObject({
  query: z.string().min(1).describe('The natural-language query used for semantic search.'),
  filters: z.looseObject({}).describe('An optional advanced filter object.').optional(),
  top_k: z.int().min(1).max(100).describe('The maximum number of results to return.').optional(),
  rerank: z.boolean().describe('Whether Mem0 should rerank the initial search results.').optional(),
  threshold: z.number().describe('The semantic similarity threshold.').optional(),
  fields: z.array(z.string().min(1)).min(1).describe('The list of fields to return.').optional(),
  keyword_search: z.boolean().describe('Whether Mem0 should perform keyword search instead of semantic search.').optional(),
  filter_memories: z.boolean().describe('Whether Mem0 should strictly apply the provided filters.').optional(),
  org_id: z.string().min(1).describe('An optional organization identifier.').optional(),
  project_id: z.string().min(1).describe('An optional project identifier.').optional(),
}).describe('The input payload for searching memories in Mem0.')

export const searchMemoriesOutput = z.array(z.looseObject({
  id: z.string().describe('The unique identifier of the memory.').optional(),
  memory: z.string().describe('The memory text content.').optional(),
  text: z.string().describe('The updated memory text returned by some write operations.').optional(),
  hash: z.string().describe('The content hash of the memory.').optional(),
  user_id: z.string().describe('The associated user identifier.').optional(),
  agent_id: z.string().describe('The associated agent identifier.').optional(),
  app_id: z.string().describe('The associated application identifier.').optional(),
  run_id: z.string().describe('The associated run identifier.').optional(),
  metadata: z.looseObject({}).describe('An arbitrary JSON object returned by Mem0.').optional(),
  categories: z.array(z.string().describe('One category.')).describe('The categories assigned to the memory.').optional(),
  created_at: z.string().describe('The timestamp when the memory was created.').optional(),
  updated_at: z.string().describe('The timestamp when the memory was last updated.').optional(),
  expiration_date: z.string().describe('The expiration date of the memory.').optional(),
  score: z.number().describe('The relevance score returned by search results.').optional(),
  input: z.array(z.strictObject({
    role: z.string().min(1).describe('The message role, such as user or assistant.').optional(),
    content: z.string().min(1).describe('The text content of the message.').optional(),
  }).describe('A single message used to create or update memory.')).describe('The input messages used to generate the memory.').optional(),
  structured_attributes: z.looseObject({}).describe('Structured attributes extracted from the memory.').optional(),
}).describe('A Mem0 memory object.')).describe('The list of memories returned by semantic search.')

export const getMemoryInput = z.strictObject({
  memory_id: z.string().min(1).describe('The unique identifier of the target memory.').optional(),
}).describe('The input payload for retrieving a single Mem0 memory.')

export const getMemoryOutput = z.looseObject({
  id: z.string().describe('The unique identifier of the memory.').optional(),
  memory: z.string().describe('The memory text content.').optional(),
  text: z.string().describe('The updated memory text returned by some write operations.').optional(),
  hash: z.string().describe('The content hash of the memory.').optional(),
  user_id: z.string().describe('The associated user identifier.').optional(),
  agent_id: z.string().describe('The associated agent identifier.').optional(),
  app_id: z.string().describe('The associated application identifier.').optional(),
  run_id: z.string().describe('The associated run identifier.').optional(),
  metadata: z.looseObject({}).describe('An arbitrary JSON object returned by Mem0.').optional(),
  categories: z.array(z.string().describe('One category.')).describe('The categories assigned to the memory.').optional(),
  created_at: z.string().describe('The timestamp when the memory was created.').optional(),
  updated_at: z.string().describe('The timestamp when the memory was last updated.').optional(),
  expiration_date: z.string().describe('The expiration date of the memory.').optional(),
  score: z.number().describe('The relevance score returned by search results.').optional(),
  input: z.array(z.strictObject({
    role: z.string().min(1).describe('The message role, such as user or assistant.').optional(),
    content: z.string().min(1).describe('The text content of the message.').optional(),
  }).describe('A single message used to create or update memory.')).describe('The input messages used to generate the memory.').optional(),
  structured_attributes: z.looseObject({}).describe('Structured attributes extracted from the memory.').optional(),
}).describe('A Mem0 memory object.')

export const updateMemoryInput = z.strictObject({
  memory_id: z.string().min(1).describe('The unique identifier of the target memory.'),
  text: z.string().min(1).describe('The new memory text to store.').optional(),
  metadata: z.looseObject({}).describe('An arbitrary JSON object returned by Mem0.').optional(),
}).describe('The input payload for updating a Mem0 memory.')

export const updateMemoryOutput = z.looseObject({
  id: z.string().describe('The unique identifier of the memory.').optional(),
  memory: z.string().describe('The memory text content.').optional(),
  text: z.string().describe('The updated memory text returned by some write operations.').optional(),
  hash: z.string().describe('The content hash of the memory.').optional(),
  user_id: z.string().describe('The associated user identifier.').optional(),
  agent_id: z.string().describe('The associated agent identifier.').optional(),
  app_id: z.string().describe('The associated application identifier.').optional(),
  run_id: z.string().describe('The associated run identifier.').optional(),
  metadata: z.looseObject({}).describe('An arbitrary JSON object returned by Mem0.').optional(),
  categories: z.array(z.string().describe('One category.')).describe('The categories assigned to the memory.').optional(),
  created_at: z.string().describe('The timestamp when the memory was created.').optional(),
  updated_at: z.string().describe('The timestamp when the memory was last updated.').optional(),
  expiration_date: z.string().describe('The expiration date of the memory.').optional(),
  score: z.number().describe('The relevance score returned by search results.').optional(),
  input: z.array(z.strictObject({
    role: z.string().min(1).describe('The message role, such as user or assistant.').optional(),
    content: z.string().min(1).describe('The text content of the message.').optional(),
  }).describe('A single message used to create or update memory.')).describe('The input messages used to generate the memory.').optional(),
  structured_attributes: z.looseObject({}).describe('Structured attributes extracted from the memory.').optional(),
}).describe('A Mem0 memory object.')

export const deleteMemoryInput = z.strictObject({
  memory_id: z.string().min(1).describe('The unique identifier of the target memory.').optional(),
}).describe('The input payload for deleting a Mem0 memory.')

export const deleteMemoryOutput = z.strictObject({
  memory_id: z.string().describe('The identifier of the deleted memory.').optional(),
  deleted: z.boolean().describe('Whether the memory was deleted successfully.').optional(),
  message: z.string().describe('A deletion status message.').optional(),
}).describe('The explicit acknowledgment object returned after deleting a Mem0 memory.')

export const getMemoryHistoryInput = z.strictObject({
  memory_id: z.string().min(1).describe('The unique identifier of the target memory.').optional(),
}).describe('The input payload for retrieving Mem0 memory history.')

export const getMemoryHistoryOutput = z.array(z.looseObject({
  id: z.string().describe('The unique identifier of the history entry.').optional(),
  memory_id: z.string().describe('The identifier of the related memory.').optional(),
  event: z.string().describe('The history event type.').optional(),
  old_memory: z.string().describe('A string value returned by Mem0, or null.').nullable().optional(),
  new_memory: z.string().describe('A string value returned by Mem0, or null.').nullable().optional(),
  input: z.array(z.strictObject({
    role: z.string().min(1).describe('The message role, such as user or assistant.').optional(),
    content: z.string().min(1).describe('The text content of the message.').optional(),
  }).describe('A single message used to create or update memory.')).describe('The input messages that triggered the change.').optional(),
  metadata: z.looseObject({}).describe('An arbitrary JSON object returned by Mem0.').optional(),
  created_at: z.string().describe('The timestamp when the history entry was created.').optional(),
  updated_at: z.string().describe('The timestamp when the history entry was last updated.').optional(),
  user_id: z.string().describe('The associated user identifier.').optional(),
}).describe('A Mem0 memory history record.')).describe('The history entries for the requested memory.')

export const getEventsInput = z.strictObject({
  event_type: z.string().min(1).describe('Filter events by event type.').optional(),
  start_date: z.string().min(1).describe('The start date filter, typically in YYYY-MM-DD format.').optional(),
  end_date: z.string().min(1).describe('The end date filter, typically in YYYY-MM-DD format.').optional(),
  page: z.int().min(1).describe('The page number to request, starting from 1.').optional(),
  page_size: z.int().min(1).max(100).describe('The maximum number of results per page, up to 100.').optional(),
}).describe('The input payload for listing Mem0 events.')

export const getEventsOutput = z.strictObject({
  count: z.number().describe('The total number of events matching the current query.'),
  next: z.string().describe('A string value returned by Mem0, or null.').nullable().optional(),
  previous: z.string().describe('A string value returned by Mem0, or null.').nullable().optional(),
  results: z.array(z.looseObject({
    id: z.string().describe('The unique identifier of the event.').optional(),
    event_type: z.string().describe('The event type.').optional(),
    status: z.string().describe('The processing status of the event.').optional(),
    payload: z.looseObject({}).describe('The raw request payload captured for the event.').optional(),
    results: z.array(z.unknown().describe('One event processing result.')).describe('The list of event processing results.').optional(),
    metadata: z.looseObject({}).describe('An arbitrary JSON object returned by Mem0.').optional(),
    latency: z.number().describe('The event processing latency in milliseconds.').nullable().optional(),
    graph_status: z.unknown().describe('The graph-memory processing status.').optional(),
    created_at: z.string().describe('The timestamp when the event was created.').optional(),
    updated_at: z.string().describe('The timestamp when the event was last updated.').optional(),
    started_at: z.string().describe('A string value returned by Mem0, or null.').nullable().optional(),
    completed_at: z.string().describe('A string value returned by Mem0, or null.').nullable().optional(),
  }).describe('A Mem0 event object.')).describe('The list of event records.'),
}).describe('A paginated Mem0 event response.')

export const getEventInput = z.strictObject({
  event_id: z.string().min(1).describe('The unique identifier of the target event.').optional(),
}).describe('The input payload for retrieving a single Mem0 event.')

export const getEventOutput = z.looseObject({
  id: z.string().describe('The unique identifier of the event.').optional(),
  event_type: z.string().describe('The event type.').optional(),
  status: z.string().describe('The processing status of the event.').optional(),
  payload: z.looseObject({}).describe('The raw request payload captured for the event.').optional(),
  results: z.array(z.unknown().describe('One event processing result.')).describe('The list of event processing results.').optional(),
  metadata: z.looseObject({}).describe('An arbitrary JSON object returned by Mem0.').optional(),
  latency: z.number().describe('The event processing latency in milliseconds.').nullable().optional(),
  graph_status: z.unknown().describe('The graph-memory processing status.').optional(),
  created_at: z.string().describe('The timestamp when the event was created.').optional(),
  updated_at: z.string().describe('The timestamp when the event was last updated.').optional(),
  started_at: z.string().describe('A string value returned by Mem0, or null.').nullable().optional(),
  completed_at: z.string().describe('A string value returned by Mem0, or null.').nullable().optional(),
}).describe('A Mem0 event object.')

export const getUsersInput = z.strictObject({
  org_id: z.string().min(1).describe('An optional organization identifier.').optional(),
  project_id: z.string().min(1).describe('An optional project identifier.').optional(),
}).describe('The input payload for listing Mem0 user entities.')

export const getUsersOutput = z.strictObject({
  entity_type: z.string().describe('The entity type returned by the current query.').optional(),
  count: z.number().describe('The total number of user entities.'),
  next: z.string().describe('A string value returned by Mem0, or null.').nullable().optional(),
  previous: z.string().describe('A string value returned by Mem0, or null.').nullable().optional(),
  results: z.array(z.looseObject({
    id: z.string().describe('The unique identifier of the user entity.').optional(),
    name: z.string().describe('The display name of the user entity.').optional(),
    type: z.string().describe('The entity type.').optional(),
    owner: z.string().describe('The owner of the entity.').optional(),
    metadata: z.looseObject({}).describe('An arbitrary JSON object returned by Mem0.').optional(),
    created_at: z.string().describe('The timestamp when the user entity was created.').optional(),
    updated_at: z.string().describe('The timestamp when the user entity was last updated.').optional(),
  }).describe('A Mem0 user entity.')).describe('The list of user entities.'),
}).describe('A paginated Mem0 user entity response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const mem0Actions = {
  add_memories: {
    description: 'Add new memories to Mem0 from messages or direct memory text.',
    effect: 'write',
    inputSchema: addMemoriesInput,
    outputSchema: z.toJSONSchema(addMemoriesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_memories: {
    description: 'List memories from Mem0 with v2 advanced filters.',
    effect: 'read',
    inputSchema: getMemoriesInput,
    outputSchema: z.toJSONSchema(getMemoriesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_memories: {
    description: 'Search memories in Mem0 with semantic query and optional filters.',
    effect: 'read',
    inputSchema: searchMemoriesInput,
    outputSchema: z.toJSONSchema(searchMemoriesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_memory: {
    description: 'Get a single memory from Mem0 by memory ID.',
    effect: 'read',
    inputSchema: getMemoryInput,
    outputSchema: z.toJSONSchema(getMemoryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_memory: {
    description: 'Update text or metadata of a Mem0 memory by memory ID.',
    effect: 'write',
    inputSchema: updateMemoryInput,
    outputSchema: z.toJSONSchema(updateMemoryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_memory: {
    description: 'Delete a Mem0 memory by memory ID.',
    effect: 'destructive',
    inputSchema: deleteMemoryInput,
    outputSchema: z.toJSONSchema(deleteMemoryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_memory_history: {
    description: 'Get the change history of a Mem0 memory by memory ID.',
    effect: 'read',
    inputSchema: getMemoryHistoryInput,
    outputSchema: z.toJSONSchema(getMemoryHistoryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_events: {
    description: 'List Mem0 events for the current API key.',
    effect: 'read',
    inputSchema: getEventsInput,
    outputSchema: z.toJSONSchema(getEventsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_event: {
    description: 'Get a single Mem0 event by event ID.',
    effect: 'read',
    inputSchema: getEventInput,
    outputSchema: z.toJSONSchema(getEventOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_users: {
    description: 'List user entities from Mem0, optionally scoped by org and project.',
    effect: 'read',
    inputSchema: getUsersInput,
    outputSchema: z.toJSONSchema(getUsersOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
