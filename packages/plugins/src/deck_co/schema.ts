/**
 * Deck.co 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const testApiKeyInput = z.strictObject({}).describe('No input is required to test a Deck.co API key.')

export const testApiKeyOutput = z.strictObject({
  status: z.string().describe('Readiness status returned by Deck.co.').optional(),
  environment: z.string().describe('Deck.co API environment for the key.').optional(),
  request_id: z.string().describe('Unique identifier for the Deck.co API request.').optional(),
}).describe('Deck.co API key test response.')

export const listAgentsInput = z.strictObject({
  limit: z.int().min(1).max(100).describe('Maximum number of items to return. Deck.co allows 1 to 100.').optional(),
  cursor: z.string().min(1).describe('Opaque cursor string returned by a previous Deck.co page.').optional(),
}).describe('Cursor pagination parameters for Deck.co list endpoints.')

export const listAgentsOutput = z.strictObject({
  agents: z.array(z.looseObject({
    id: z.string().describe('Unique identifier for the agent, prefixed with agt_.'),
    object: z.string().describe('Resource type returned by Deck.co.'),
    name: z.string().describe('Display name for the agent.'),
    description: z.string().describe('Description of the agent purpose.').nullable(),
    tasks: z.array(z.looseObject({
      id: z.string().describe('Unique identifier for the task, prefixed with task_.'),
      object: z.string().describe('Resource type returned by Deck.co.'),
      name: z.string().describe('Display name for the task.'),
      status: z.string().describe('Current task status, such as learning, test, or live.'),
    }).describe('A Deck.co task summary object.')).describe('Tasks associated with the agent.'),
    created_at: z.iso.datetime({ offset: true }).describe('ISO 8601 timestamp returned by Deck.co.'),
    updated_at: z.iso.datetime({ offset: true }).describe('ISO 8601 timestamp returned by Deck.co.'),
  }).describe('A Deck.co agent object.')).describe('Agents returned for the requested page.').optional(),
  hasMore: z.boolean().describe('Whether Deck.co has more agents beyond this page.').optional(),
  nextCursor: z.string().describe('Cursor to pass into the next request, when available.').nullable().optional(),
  requestId: z.string().describe('Unique identifier for the Deck.co API request.').nullable().optional(),
}).describe('Paginated Deck.co agents response.')

export const getAgentInput = z.strictObject({
  agent_id: z.string().min(1).describe('Unique identifier for the agent, prefixed with agt_.').optional(),
}).describe('Input parameters for retrieving a Deck.co agent.')

export const getAgentOutput = z.strictObject({
  agent: z.looseObject({
    id: z.string().describe('Unique identifier for the agent, prefixed with agt_.'),
    object: z.string().describe('Resource type returned by Deck.co.'),
    name: z.string().describe('Display name for the agent.'),
    description: z.string().describe('Description of the agent purpose.').nullable(),
    tasks: z.array(z.looseObject({
      id: z.string().describe('Unique identifier for the task, prefixed with task_.'),
      object: z.string().describe('Resource type returned by Deck.co.'),
      name: z.string().describe('Display name for the task.'),
      status: z.string().describe('Current task status, such as learning, test, or live.'),
    }).describe('A Deck.co task summary object.')).describe('Tasks associated with the agent.'),
    created_at: z.iso.datetime({ offset: true }).describe('ISO 8601 timestamp returned by Deck.co.'),
    updated_at: z.iso.datetime({ offset: true }).describe('ISO 8601 timestamp returned by Deck.co.'),
  }).describe('A Deck.co agent object.').optional(),
}).describe('Deck.co agent response.')

export const listSourcesInput = z.strictObject({
  limit: z.int().min(1).max(100).describe('Maximum number of items to return. Deck.co allows 1 to 100.').optional(),
  cursor: z.string().min(1).describe('Opaque cursor string returned by a previous Deck.co page.').optional(),
}).describe('Cursor pagination parameters for Deck.co list endpoints.')

export const listSourcesOutput = z.strictObject({
  sources: z.array(z.looseObject({
    id: z.string().describe('Unique identifier for the source, prefixed with src_.'),
    object: z.string().describe('Resource type returned by Deck.co.'),
    name: z.string().describe('Display name for the source.').nullable(),
    type: z.string().describe('The source type. Deck.co currently supports website sources.'),
    website: z.looseObject({
      url: z.string().describe('The website or service URL. Deck.co may normalize this value after create or update.'),
    }).describe('Website configuration for a Deck.co source.'),
    created_at: z.iso.datetime({ offset: true }).describe('ISO 8601 timestamp returned by Deck.co.'),
    updated_at: z.iso.datetime({ offset: true }).describe('ISO 8601 timestamp returned by Deck.co.'),
  }).describe('A Deck.co source object.')).describe('Sources returned for the requested page.').optional(),
  hasMore: z.boolean().describe('Whether Deck.co has more sources beyond this page.').optional(),
  nextCursor: z.string().describe('Cursor to pass into the next request, when available.').nullable().optional(),
  requestId: z.string().describe('Unique identifier for the Deck.co API request.').nullable().optional(),
}).describe('Paginated Deck.co sources response.')

export const getSourceInput = z.strictObject({
  source_id: z.string().min(1).describe('Unique identifier for the source, prefixed with src_.').optional(),
}).describe('Input parameters for retrieving a Deck.co source.')

export const getSourceOutput = z.strictObject({
  source: z.looseObject({
    id: z.string().describe('Unique identifier for the source, prefixed with src_.'),
    object: z.string().describe('Resource type returned by Deck.co.'),
    name: z.string().describe('Display name for the source.').nullable(),
    type: z.string().describe('The source type. Deck.co currently supports website sources.'),
    website: z.looseObject({
      url: z.string().describe('The website or service URL. Deck.co may normalize this value after create or update.'),
    }).describe('Website configuration for a Deck.co source.'),
    created_at: z.iso.datetime({ offset: true }).describe('ISO 8601 timestamp returned by Deck.co.'),
    updated_at: z.iso.datetime({ offset: true }).describe('ISO 8601 timestamp returned by Deck.co.'),
  }).describe('A Deck.co source object.').optional(),
}).describe('Deck.co source response.')

export const createSourceInput = z.strictObject({
  website_url: z.url().describe('The website or service URL to register as a Deck.co source.'),
  name: z.string().min(1).describe('Display name for the source.').optional(),
  idempotencyKey: z.string().min(1).max(256).describe('An optional Idempotency-Key header value for safe retries.').optional(),
}).describe('Input parameters for creating a Deck.co website source.')

export const createSourceOutput = z.strictObject({
  source: z.looseObject({
    id: z.string().describe('Unique identifier for the source, prefixed with src_.'),
    object: z.string().describe('Resource type returned by Deck.co.'),
    name: z.string().describe('Display name for the source.').nullable(),
    type: z.string().describe('The source type. Deck.co currently supports website sources.'),
    website: z.looseObject({
      url: z.string().describe('The website or service URL. Deck.co may normalize this value after create or update.'),
    }).describe('Website configuration for a Deck.co source.'),
    created_at: z.iso.datetime({ offset: true }).describe('ISO 8601 timestamp returned by Deck.co.'),
    updated_at: z.iso.datetime({ offset: true }).describe('ISO 8601 timestamp returned by Deck.co.'),
  }).describe('A Deck.co source object.').optional(),
}).describe('Deck.co source response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const deckCoActions = {
  test_api_key: {
    description: 'Verify that a Deck.co secret key can authenticate with the v2 API.',
    effect: 'write',
    inputSchema: testApiKeyInput,
    outputSchema: z.toJSONSchema(testApiKeyOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_agents: {
    description: 'List Deck.co agents with cursor pagination.',
    effect: 'read',
    inputSchema: listAgentsInput,
    outputSchema: z.toJSONSchema(listAgentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_agent: {
    description: 'Retrieve a Deck.co agent by ID, including its task summaries.',
    effect: 'read',
    inputSchema: getAgentInput,
    outputSchema: z.toJSONSchema(getAgentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_sources: {
    description: 'List Deck.co sources with cursor pagination.',
    effect: 'read',
    inputSchema: listSourcesInput,
    outputSchema: z.toJSONSchema(listSourcesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_source: {
    description: 'Retrieve a Deck.co source by ID.',
    effect: 'read',
    inputSchema: getSourceInput,
    outputSchema: z.toJSONSchema(getSourceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_source: {
    description: 'Create a Deck.co website source from a URL and optional display name.',
    effect: 'write',
    inputSchema: createSourceInput,
    outputSchema: z.toJSONSchema(createSourceOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
