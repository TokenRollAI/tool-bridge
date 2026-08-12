/**
 * CustomGPT.ai 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listAgentsInput = z.strictObject({
  page: z.int().min(1).describe('Page number to retrieve. Page numbering starts at 1.').optional(),
  duration: z.int().describe('The duration filter for agents when supported by CustomGPT.').optional(),
  order: z.enum(['asc', 'desc']).describe('Sort direction for CustomGPT list results.').optional(),
  orderBy: z.enum(['id', 'created_at']).describe('CustomGPT field used to sort list results.').optional(),
  width: z.string().min(1).describe('Embed-code width to request from CustomGPT.').optional(),
  height: z.string().min(1).describe('Embed-code height to request from CustomGPT.').optional(),
  name: z.string().min(1).describe('Agent name filter.').optional(),
}).describe('Input parameters for listing CustomGPT agents.')

export const listAgentsOutput = z.strictObject({
  agents: z.array(z.looseObject({}).describe('A CustomGPT object returned by the upstream API, preserving provider-defined fields.')).describe('CustomGPT agents returned for this page.').optional(),
  pagination: z.strictObject({
    currentPage: z.int().describe('The current response page number.').nullable().optional(),
    lastPage: z.int().describe('The last available page number.').nullable().optional(),
    perPage: z.int().describe('The number of items returned per page.').nullable().optional(),
    total: z.int().describe('The total number of items reported by CustomGPT.').nullable().optional(),
    nextPageUrl: z.string().describe('The upstream URL for the next page when available.').nullable().optional(),
    previousPageUrl: z.string().describe('The upstream URL for the previous page when available.').nullable().optional(),
  }).describe('Normalized pagination metadata from CustomGPT list responses.').optional(),
  raw: z.looseObject({}).describe('A CustomGPT object returned by the upstream API, preserving provider-defined fields.').optional(),
}).describe('A page of CustomGPT agents.')

export const getAgentInput = z.strictObject({
  projectId: z.int().min(1).describe('The unique CustomGPT agent identifier used in project path parameters.'),
  width: z.string().min(1).describe('Embed-code width to request from CustomGPT.').optional(),
  height: z.string().min(1).describe('Embed-code height to request from CustomGPT.').optional(),
}).describe('Input parameters for retrieving a CustomGPT agent.')

export const getAgentOutput = z.strictObject({
  agent: z.looseObject({}).describe('A CustomGPT object returned by the upstream API, preserving provider-defined fields.').optional(),
  raw: z.looseObject({}).describe('A CustomGPT object returned by the upstream API, preserving provider-defined fields.').optional(),
}).describe('CustomGPT agent details.')

export const listConversationsInput = z.strictObject({
  projectId: z.int().min(1).describe('The unique CustomGPT agent identifier used in project path parameters.'),
  page: z.int().min(1).describe('Page number to retrieve. Page numbering starts at 1.').optional(),
  order: z.enum(['asc', 'desc']).describe('Sort direction for CustomGPT list results.').optional(),
  orderBy: z.enum(['id', 'created_at']).describe('CustomGPT field used to sort list results.').optional(),
  userFilter: z.enum(['all', 'anonymous', 'team_member', 'me']).describe('Conversation user-type filter.').optional(),
  name: z.string().min(1).describe('Conversation name filter.').optional(),
  lastUpdatedAfter: z.iso.datetime({ offset: true }).describe('Return conversations updated after this timestamp.').optional(),
}).describe('Input parameters for listing CustomGPT conversations.')

export const listConversationsOutput = z.strictObject({
  conversations: z.array(z.looseObject({}).describe('A CustomGPT object returned by the upstream API, preserving provider-defined fields.')).describe('CustomGPT conversations returned for this page.').optional(),
  pagination: z.strictObject({
    currentPage: z.int().describe('The current response page number.').nullable().optional(),
    lastPage: z.int().describe('The last available page number.').nullable().optional(),
    perPage: z.int().describe('The number of items returned per page.').nullable().optional(),
    total: z.int().describe('The total number of items reported by CustomGPT.').nullable().optional(),
    nextPageUrl: z.string().describe('The upstream URL for the next page when available.').nullable().optional(),
    previousPageUrl: z.string().describe('The upstream URL for the previous page when available.').nullable().optional(),
  }).describe('Normalized pagination metadata from CustomGPT list responses.').optional(),
  raw: z.looseObject({}).describe('A CustomGPT object returned by the upstream API, preserving provider-defined fields.').optional(),
}).describe('A page of CustomGPT conversations.')

export const createConversationInput = z.strictObject({
  projectId: z.int().min(1).describe('The unique CustomGPT agent identifier used in project path parameters.'),
  name: z.string().min(1).max(255).describe('Optional conversation name.').optional(),
}).describe('Input parameters for creating a CustomGPT conversation.')

export const createConversationOutput = z.strictObject({
  conversation: z.looseObject({}).describe('A CustomGPT object returned by the upstream API, preserving provider-defined fields.').optional(),
  sessionId: z.string().describe('The session ID used for follow-up conversation messages.').nullable().optional(),
  raw: z.looseObject({}).describe('A CustomGPT object returned by the upstream API, preserving provider-defined fields.').optional(),
}).describe('A CustomGPT conversation creation result.')

export const sendMessageInput = z.strictObject({
  projectId: z.int().min(1).describe('The unique CustomGPT agent identifier used in project path parameters.'),
  sessionId: z.string().min(1).describe('The CustomGPT conversation session ID.'),
  prompt: z.string().min(1).describe('Prompt text to send to the CustomGPT agent.'),
  lang: z.string().min(2).describe('ISO 639-1 language code for the response language.').optional(),
  externalId: z.string().min(1).max(128).describe('External prompt history identifier.').optional(),
  customPersona: z.string().min(1).describe('Request-only persona override.').optional(),
  chatbotModel: z.string().min(1).describe('CustomGPT chatbot model identifier.').optional(),
  responseSource: z.enum(['default', 'own_content', 'openai_content']).describe('Knowledge source mode for the response.').optional(),
  customContext: z.string().min(1).describe('Custom context supplied with this prompt.').optional(),
  agentCapability: z.enum(['fastest-responses', 'optimal-choice', 'advanced-reasoning', 'complex-tasks']).describe('CustomGPT agent capability preset.').optional(),
  labels: z.array(z.string().min(1).max(100).describe('A CustomGPT source label ID or name.')).min(1).max(50).describe('Source label IDs or names to search as one CustomGPT OR label group.').optional(),
  labelsExclusive: z.boolean().describe('Whether CustomGPT should search only pages with provided labels.').optional(),
  actionOverrides: z.looseObject({}).describe('Per-request action override object JSON-encoded into multipart form data.').optional(),
}).describe('Input parameters for sending a CustomGPT conversation message.')

export const sendMessageOutput = z.strictObject({
  message: z.looseObject({}).describe('A CustomGPT object returned by the upstream API, preserving provider-defined fields.').optional(),
  messageId: z.int().describe('The CustomGPT prompt history identifier.').nullable().optional(),
  response: z.string().describe('The agent response text when CustomGPT returned one.').nullable().optional(),
  citations: z.unknown().describe('Citation payload returned by CustomGPT for the message.').optional(),
  raw: z.looseObject({}).describe('A CustomGPT object returned by the upstream API, preserving provider-defined fields.').optional(),
}).describe('A CustomGPT non-streaming message response.')

export const listMessagesInput = z.strictObject({
  projectId: z.int().min(1).describe('The unique CustomGPT agent identifier used in project path parameters.'),
  sessionId: z.string().min(1).describe('The CustomGPT conversation session ID.'),
  page: z.int().min(1).describe('Page number to retrieve. Page numbering starts at 1.').optional(),
  order: z.enum(['asc', 'desc']).describe('Sort direction for CustomGPT list results.').optional(),
  includeInsights: z.boolean().describe('Whether CustomGPT should include customer intelligence data.').optional(),
}).describe('Input parameters for listing CustomGPT conversation messages.')

export const listMessagesOutput = z.strictObject({
  messages: z.array(z.looseObject({}).describe('A CustomGPT object returned by the upstream API, preserving provider-defined fields.')).describe('CustomGPT messages returned for this page.').optional(),
  pagination: z.strictObject({
    currentPage: z.int().describe('The current response page number.').nullable().optional(),
    lastPage: z.int().describe('The last available page number.').nullable().optional(),
    perPage: z.int().describe('The number of items returned per page.').nullable().optional(),
    total: z.int().describe('The total number of items reported by CustomGPT.').nullable().optional(),
    nextPageUrl: z.string().describe('The upstream URL for the next page when available.').nullable().optional(),
    previousPageUrl: z.string().describe('The upstream URL for the previous page when available.').nullable().optional(),
  }).describe('Normalized pagination metadata from CustomGPT list responses.').optional(),
  raw: z.looseObject({}).describe('A CustomGPT object returned by the upstream API, preserving provider-defined fields.').optional(),
}).describe('A page of CustomGPT conversation messages.')

export const listDocumentsInput = z.strictObject({
  projectId: z.int().min(1).describe('The unique CustomGPT agent identifier used in project path parameters.'),
  page: z.int().min(1).describe('Page number to retrieve. Page numbering starts at 1.').optional(),
  limit: z.int().min(1).describe('Maximum number of documents to return.').optional(),
  order: z.enum(['asc', 'desc']).describe('Sort direction for CustomGPT list results.').optional(),
  search: z.string().min(1).describe('Case-insensitive search term for document URL or filename.').optional(),
  crawlStatus: z.enum(['all', 'ok', 'failed', 'n/a', 'queued', 'limited']).describe('Crawl status filter for documents.').optional(),
  indexStatus: z.enum(['all', 'ok', 'failed', 'n/a', 'queued', 'limited']).describe('Index status filter for documents.').optional(),
}).describe('Input parameters for listing CustomGPT indexed documents.')

export const listDocumentsOutput = z.strictObject({
  project: z.looseObject({}).describe('The CustomGPT agent object returned with the document page.').nullable().optional(),
  documents: z.array(z.looseObject({}).describe('A CustomGPT object returned by the upstream API, preserving provider-defined fields.')).describe('Indexed documents returned for this page.').optional(),
  pagination: z.strictObject({
    currentPage: z.int().describe('The current response page number.').nullable().optional(),
    lastPage: z.int().describe('The last available page number.').nullable().optional(),
    perPage: z.int().describe('The number of items returned per page.').nullable().optional(),
    total: z.int().describe('The total number of items reported by CustomGPT.').nullable().optional(),
    nextPageUrl: z.string().describe('The upstream URL for the next page when available.').nullable().optional(),
    previousPageUrl: z.string().describe('The upstream URL for the previous page when available.').nullable().optional(),
  }).describe('Normalized pagination metadata from CustomGPT list responses.').optional(),
  raw: z.looseObject({}).describe('A CustomGPT object returned by the upstream API, preserving provider-defined fields.').optional(),
}).describe('A page of indexed CustomGPT documents.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const customgptActions = {
  list_agents: {
    description: 'List CustomGPT agents in the authenticated account with optional pagination.',
    effect: 'read',
    inputSchema: listAgentsInput,
    outputSchema: z.toJSONSchema(listAgentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_agent: {
    description: 'Get details and current status for a CustomGPT agent.',
    effect: 'read',
    inputSchema: getAgentInput,
    outputSchema: z.toJSONSchema(getAgentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_conversations: {
    description: 'List conversations for a CustomGPT agent.',
    effect: 'read',
    inputSchema: listConversationsInput,
    outputSchema: z.toJSONSchema(listConversationsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_conversation: {
    description: 'Create a CustomGPT conversation for an agent and return its session ID.',
    effect: 'write',
    inputSchema: createConversationInput,
    outputSchema: z.toJSONSchema(createConversationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_message: {
    description: 'Send a non-streaming text prompt to a CustomGPT conversation and return the agent response.',
    effect: 'write',
    inputSchema: sendMessageInput,
    outputSchema: z.toJSONSchema(sendMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_messages: {
    description: 'List messages in a CustomGPT conversation.',
    effect: 'read',
    inputSchema: listMessagesInput,
    outputSchema: z.toJSONSchema(listMessagesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_documents: {
    description: 'List indexed documents in a CustomGPT agent knowledge base.',
    effect: 'read',
    inputSchema: listDocumentsInput,
    outputSchema: z.toJSONSchema(listDocumentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
