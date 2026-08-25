/** OpenAPI 3.1 artifact，组件 schema 直接由固定控制面的 Zod 真源生成。 */
import { z } from 'zod'
import {
  feedbackDetailSchema,
  feedbackListSchema,
  feedbackRemoveResponseSchema,
  feedbackSubmitRequestSchema,
  feedbackSubmitResponseSchema,
  feedbackViewSchema,
  feedbackVoteRequestSchema,
  healthResponseSchema,
  helpJsonSchema,
  livenessResponseSchema,
  nodeInputSchema,
  oauthAuthorizeRequestSchema,
  oauthAuthorizeResponseSchema,
  readinessResponseSchema,
  registryNodeSchema,
  tbErrorBodySchema,
  toolSearchPageSchema,
  toolSearchRequestSchema,
  treeJsonSchema,
} from './wire'

type JsonObject = Record<string, unknown>

const schemaRegistry = z.registry<{ id: string }>()
const schemas = {
  Error: tbErrorBodySchema,
  FeedbackDetail: feedbackDetailSchema,
  FeedbackList: feedbackListSchema,
  FeedbackRemoveResponse: feedbackRemoveResponseSchema,
  FeedbackSubmitRequest: feedbackSubmitRequestSchema,
  FeedbackSubmitResponse: feedbackSubmitResponseSchema,
  FeedbackView: feedbackViewSchema,
  FeedbackVoteRequest: feedbackVoteRequestSchema,
  Health: healthResponseSchema,
  Help: helpJsonSchema,
  Liveness: livenessResponseSchema,
  NodeInput: nodeInputSchema,
  OAuthAuthorizeRequest: oauthAuthorizeRequestSchema,
  OAuthAuthorizeResponse: oauthAuthorizeResponseSchema,
  Readiness: readinessResponseSchema,
  RegistryNode: registryNodeSchema,
  SearchRequest: toolSearchRequestSchema,
  SearchResponse: toolSearchPageSchema,
  Tree: treeJsonSchema,
} as const

for (const [id, schema] of Object.entries(schemas)) schemaRegistry.add(schema, { id })

/**
 * Zod registry 的跨 schema `$ref` 使用 registry id；嵌入 OpenAPI components 时把它
 * 改写成标准 component ref，并移除每个 component 重复的 `$schema` 声明。
 */
function asOpenApiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(asOpenApiSchema)
  if (value === null || typeof value !== 'object') return value
  const out: JsonObject = {}
  for (const [key, entry] of Object.entries(value)) {
    if (key === '$schema') continue
    if (key === '$ref' && typeof entry === 'string' && !entry.startsWith('#/')) {
      out[key] = `#/components/schemas/${entry}`
    } else {
      out[key] = asOpenApiSchema(entry)
    }
  }
  return out
}

const generated = z.toJSONSchema(schemaRegistry) as { schemas: Record<string, unknown> }
const componentSchemas = Object.fromEntries(
  Object.entries(generated.schemas).map(([name, schema]) => [name, asOpenApiSchema(schema)]),
)

const jsonContent = (schema: string): JsonObject => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
})
const jsonResponse = (description: string, schema: string): JsonObject => ({
  description,
  content: jsonContent(schema),
})
const errorResponses: JsonObject = {
  400: jsonResponse('Invalid request', 'Error'),
  401: jsonResponse('Unauthenticated', 'Error'),
  403: jsonResponse('Permission denied', 'Error'),
  404: jsonResponse('Not found or not visible', 'Error'),
  409: jsonResponse('Conflict', 'Error'),
  429: jsonResponse('Rate limited', 'Error'),
  500: jsonResponse('Internal error', 'Error'),
  503: jsonResponse('Unavailable', 'Error'),
}
const bearerSecurity = [{ bearerAuth: [] }]
const pathParameter = {
  in: 'path',
  name: 'path',
  required: true,
  description: 'Slash-delimited Tool Bridge tree path; each segment is URL encoded.',
  schema: { type: 'string' },
}

/**
 * 固定控制面的可发布 OpenAPI 3.1 artifact。动态 HTBP invoke 只记录 transport 形态：
 * commandPath 是完整路径，body 是裸 arguments，响应按 Accept 协商，不能由静态生成器
 * 为每个运行时工具穷举。
 */
export const fixedControlPlaneOpenApi = {
  openapi: '3.1.0',
  info: {
    title: 'Tool Bridge fixed control plane',
    version: '1.0.0',
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer' },
    },
    schemas: componentSchemas,
  },
  paths: {
    '/healthz': {
      get: {
        operationId: 'getHealth',
        security: [],
        responses: { 200: jsonResponse('Deployment health', 'Health') },
      },
    },
    '/livez': {
      get: {
        operationId: 'getLiveness',
        security: [],
        responses: { 200: jsonResponse('Process liveness', 'Liveness') },
      },
    },
    '/readyz': {
      get: {
        operationId: 'getReadiness',
        security: [],
        responses: {
          200: jsonResponse('Ready', 'Readiness'),
          503: jsonResponse('Not ready', 'Readiness'),
        },
      },
    },
    '/~help': {
      get: {
        operationId: 'getRootHelp',
        security: bearerSecurity,
        parameters: [{
          in: 'query',
          name: 'schemas',
          schema: { type: 'string', enum: ['1'] },
        }],
        responses: { 200: jsonResponse('Root HTBP help', 'Help'), ...errorResponses },
      },
    },
    '/{path}/~help': {
      get: {
        'operationId': 'getHelp',
        'security': bearerSecurity,
        'parameters': [pathParameter, {
          in: 'query',
          name: 'schemas',
          schema: { type: 'string', enum: ['1'] },
        }],
        'responses': { 200: jsonResponse('HTBP help', 'Help'), ...errorResponses },
        'x-tool-bridge-greedy-path': true,
      },
    },
    '/~tree': {
      get: {
        operationId: 'getRootTree',
        security: bearerSecurity,
        parameters: [{ in: 'query', name: 'depth', schema: { type: 'integer', minimum: 1, maximum: 8 } }],
        responses: { 200: jsonResponse('Root tree', 'Tree'), ...errorResponses },
      },
    },
    '/{path}/~tree': {
      get: {
        'operationId': 'getTree',
        'security': bearerSecurity,
        'parameters': [pathParameter, {
          in: 'query',
          name: 'depth',
          schema: { type: 'integer', minimum: 1, maximum: 8 },
        }],
        'responses': { 200: jsonResponse('Subtree', 'Tree'), ...errorResponses },
        'x-tool-bridge-greedy-path': true,
      },
    },
    '/~search': {
      post: {
        operationId: 'searchTools',
        security: bearerSecurity,
        requestBody: { required: true, content: jsonContent('SearchRequest') },
        responses: { 200: jsonResponse('Visible tool page', 'SearchResponse'), ...errorResponses },
      },
    },
    '/{path}/~authorize': {
      post: {
        'operationId': 'startOAuthAuthorization',
        'security': bearerSecurity,
        'parameters': [pathParameter],
        'requestBody': { required: false, content: jsonContent('OAuthAuthorizeRequest') },
        'responses': {
          200: jsonResponse('Authorization status or redirect', 'OAuthAuthorizeResponse'),
          ...errorResponses,
        },
        'x-tool-bridge-greedy-path': true,
      },
    },
    '/{path}/~register': {
      post: {
        'operationId': 'registerNode',
        'security': bearerSecurity,
        'parameters': [pathParameter],
        'requestBody': { required: true, content: jsonContent('NodeInput') },
        'responses': {
          200: jsonResponse('Registered node', 'RegistryNode'),
          ...errorResponses,
        },
        'x-tool-bridge-greedy-path': true,
      },
    },
    '/{path}/~feedback': {
      get: {
        'operationId': 'listFeedback',
        'security': bearerSecurity,
        'parameters': [pathParameter, {
          in: 'query',
          name: 'hidden',
          schema: { type: 'string', enum: ['1'] },
        }],
        'responses': { 200: jsonResponse('Feedback list', 'FeedbackList'), ...errorResponses },
        'x-tool-bridge-greedy-path': true,
      },
      post: {
        'operationId': 'submitFeedback',
        'security': bearerSecurity,
        'parameters': [pathParameter],
        'requestBody': { required: true, content: jsonContent('FeedbackSubmitRequest') },
        'responses': {
          200: jsonResponse('Submitted feedback', 'FeedbackSubmitResponse'),
          ...errorResponses,
        },
        'x-tool-bridge-greedy-path': true,
      },
    },
    '/{path}/~feedback/{id}': {
      get: {
        'operationId': 'getFeedback',
        'security': bearerSecurity,
        'parameters': [pathParameter, { in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        'responses': { 200: jsonResponse('Feedback detail', 'FeedbackDetail'), ...errorResponses },
        'x-tool-bridge-greedy-path': true,
      },
      post: {
        'operationId': 'voteFeedback',
        'security': bearerSecurity,
        'parameters': [pathParameter, { in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        'requestBody': { required: true, content: jsonContent('FeedbackVoteRequest') },
        'responses': { 200: jsonResponse('Updated feedback', 'FeedbackView'), ...errorResponses },
        'x-tool-bridge-greedy-path': true,
      },
      delete: {
        'operationId': 'removeFeedback',
        'security': bearerSecurity,
        'parameters': [pathParameter, { in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        'responses': {
          200: jsonResponse('Feedback removed', 'FeedbackRemoveResponse'),
          ...errorResponses,
        },
        'x-tool-bridge-greedy-path': true,
      },
    },
    '/{commandPath}': {
      post: {
        'operationId': 'invoke',
        'security': bearerSecurity,
        'parameters': [{
          in: 'path',
          name: 'commandPath',
          required: true,
          schema: { type: 'string' },
          description: 'Complete HTBP command path, including the command/tool leaf.',
        }],
        'requestBody': {
          required: true,
          description: 'Raw command arguments; there is no {tool, arguments} envelope.',
          content: { 'application/json': { schema: {} } },
        },
        'responses': {
          200: {
            description: 'Raw JSON or Markdown according to Accept.',
            content: {
              'application/json': { schema: {} },
              'text/markdown': { schema: { type: 'string' } },
            },
          },
          ...errorResponses,
        },
        'x-tool-bridge-greedy-path': true,
      },
    },
  },
} as const

export type FixedControlPlaneOpenApi = typeof fixedControlPlaneOpenApi
