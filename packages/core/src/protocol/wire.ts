/**
 * 固定控制面的宿主中立 wire 契约。
 *
 * 这些 schema 同时服务三处：app 的出入站门禁、SDK client 的响应校验，以及
 * OpenAPI 3.1 artifact。响应 schema 使用 Zod 默认的 unknown-key stripping，确保
 * 客户端只得到白名单字段；请求 schema 使用 strictObject，防止拼错字段被静默接受。
 */
import { z } from 'zod'
import type {
  FeedbackView as CoreFeedbackView,
  FeedbackVote as CoreFeedbackVote,
} from '../feedback/store'
import type { Presence as CorePresence, PresenceState as CorePresenceState } from '../device/presence'
import type { HelpJson as CoreHelpJson } from '../htbp/model'
import type { ToolSpec as CoreToolSpec } from '../tool/types'
import type { TreeJson as CoreTreeJson } from '../htbp/tree'
import {
  type Action,
  ACTIONS,
  NODE_KINDS,
  type NodeInput,
  type NodeKind,
  type Page,
  type TreeNode,
} from '../types'
export {
  tbErrorBodySchema,
  tbErrorCodeSchema,
  type WireTBErrorBody,
  type WireTBErrorCode,
} from './errorWire'

export const actionSchema: z.ZodType<Action> = z.enum(ACTIONS)
export const nodeKindSchema: z.ZodType<NodeKind> = z.enum(NODE_KINDS)

export type WireAction = Action
export type WireNodeKind = NodeKind

const nodeInputConfigSchema = z.record(z.string(), z.unknown()).optional().describe(
  'kind-specific config, e.g. mcp: { url, auth?, authRef? } / http: { endpoint, tools } / context: { provider, bucket, … } / remote: { baseUrl, skRef }; credentials go by authRef/skRef name, never inline',
)
const nodeInputVirtualizeSchema = z.strictObject({
  prefix: z.string().optional(),
  rename: z.record(z.string(), z.string()).optional(),
  hide: z.array(z.string()).optional(),
  describe: z.record(z.string(), z.string()).optional(),
}).optional().describe(
  'optional tool virtualization: { prefix?, rename?: {from:to}, hide?: [name], describe?: {name:text} }',
)

/** `~register` 与 system/registry write 共用的固定 NodeInput wire。 */
export const nodeInputSchema = z.strictObject({
  path: z.string().min(1).describe('tree path to mount at, e.g. "docs/context7"'),
  kind: nodeKindSchema.describe('node kind; determines the config shape'),
  description: z.string().min(1).describe('one-line description shown in parent ~help'),
  config: nodeInputConfigSchema,
  virtualize: nodeInputVirtualizeSchema,
})
export type WireNodeInput = NodeInput

export const presenceStateSchema = z.enum(['online', 'stale', 'offline'])
export const presenceSchema = z.object({
  lastSeenAt: z.string().optional(),
  state: presenceStateSchema,
})

export type WirePresenceState = CorePresenceState
export type WirePresence = CorePresence

export const helpFeedbackItemSchema = z.object({
  id: z.string(),
  score: z.number(),
  title: z.string(),
})

export const helpChildSchema = z.object({
  description: z.string(),
  kind: nodeKindSchema,
  path: z.string(),
})

export const helpCommandSchema = z.object({
  confirm: z.boolean().optional(),
  effect: z.string().optional(),
  h: z.string().optional(),
  inputSchema: z.unknown().optional(),
  method: z.literal('POST'),
  name: z.string(),
  outputSchema: z.unknown().optional(),
  path: z.string(),
  returns: z.string().optional(),
  scope: actionSchema,
})

export const helpJsonSchema: z.ZodType<CoreHelpJson> = z.object({
  children: z.array(helpChildSchema).optional(),
  cmds: z.array(helpCommandSchema),
  feedback: z.array(helpFeedbackItemSchema).optional(),
  hint: z.string().optional(),
  htbp: z.string(),
  node: z.object({
    description: z.string(),
    kind: nodeKindSchema,
    path: z.string(),
  }),
  note: z.string().optional(),
})

export type WireHelpCommand = CoreHelpJson['cmds'][number]
export type WireHelpJson = CoreHelpJson

export const treeJsonSchema: z.ZodType<CoreTreeJson> = z.lazy(() => z.object({
  children: z.array(treeJsonSchema).optional(),
  description: z.string(),
  kind: nodeKindSchema,
  path: z.string(),
  presence: presenceSchema.optional(),
  truncated: z.boolean().optional(),
}))

export type WireTreeJson = CoreTreeJson

export const toolSpecSchema: z.ZodType<CoreToolSpec> = z.object({
  confirm: z.boolean().optional(),
  description: z.string().optional(),
  effect: z.string().optional(),
  inputSchema: z.unknown().optional(),
  name: z.string(),
  outputSchema: z.unknown().optional(),
})

export const toolSearchItemSchema = z.object({
  path: z.string(),
  tool: toolSpecSchema,
})

export function pageSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    cursor: z.string().optional(),
    items: z.array(itemSchema),
  })
}

export const toolSearchPageSchema = pageSchema(toolSearchItemSchema)

export const toolSearchRequestSchema = z.strictObject({
  opts: z.strictObject({
    cursor: z.string().optional(),
    limit: z.number().int().optional(),
    mode: z.enum(['keyword', 'semantic']).optional(),
  }).optional(),
  query: z.string().trim().min(1),
})

export type WirePage<T> = Page<T>
export type WireToolSpec = CoreToolSpec
export interface WireToolSearchItem {
  path: string
  tool: WireToolSpec
}
export type WireToolSearchPage = WirePage<WireToolSearchItem>
export interface WireToolSearchRequest {
  opts?: {
    cursor?: string
    limit?: number
    mode?: 'keyword' | 'semantic'
  }
  query: string
}

/**
 * 管理面 system/registry 的存储态投影。config/virtualize 的具体写入联合仍由
 * core NodeInput 权威校验；固定 wire 只对白名单顶层字段与 discriminator 做门禁。
 */
export const registryNodeSchema = z.object({
  config: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().optional(),
  description: z.string(),
  kind: nodeKindSchema,
  lastSeenAt: z.string().optional(),
  online: z.boolean().optional(),
  path: z.string(),
  registeredBy: z.string().optional(),
  updatedAt: z.string().optional(),
  virtualize: z.record(z.string(), z.unknown()).optional(),
})

// 静态检查 schema 没漏掉 TreeNode 的 wire 字段；运行时仍只输出上述白名单。
const _registryNodeCompatibility: z.ZodType<Pick<
  TreeNode,
  | 'config'
  | 'createdAt'
  | 'description'
  | 'kind'
  | 'lastSeenAt'
  | 'online'
  | 'path'
  | 'registeredBy'
  | 'updatedAt'
  | 'virtualize'
>> = registryNodeSchema as never
void _registryNodeCompatibility

export interface WireRegistryNode {
  config?: Record<string, unknown>
  createdAt?: string
  description: string
  kind: WireNodeKind
  lastSeenAt?: string
  online?: boolean
  path: string
  registeredBy?: string
  updatedAt?: string
  virtualize?: Record<string, unknown>
}

// TreeNode 新增字段时必须显式决定是否进入固定 wire；不能靠手写 Pick 静默遗漏。
const _registryNodeKeysExhaustive:
[Exclude<keyof TreeNode, keyof WireRegistryNode>] extends [never] ? true : never = true
void _registryNodeKeysExhaustive

const feedbackViewShape = {
  at: z.string(),
  by: z.string(),
  down: z.number().int().nonnegative(),
  id: z.string(),
  score: z.number().int(),
  title: z.string(),
  up: z.number().int().nonnegative(),
}
export const feedbackViewSchema = z.object(feedbackViewShape)
const _feedbackViewCompatibility: z.ZodType<CoreFeedbackView> = feedbackViewSchema
void _feedbackViewCompatibility

/** GET detail 比 list/vote 多返回所属 path 与必填 detail。 */
export const feedbackDetailSchema = z.object({
  ...feedbackViewShape,
  detail: z.string(),
  path: z.string(),
})

export const feedbackListSchema = z.object({ items: z.array(feedbackViewSchema) })
export const feedbackSubmitRequestSchema = z.strictObject({
  detail: z.string(),
  title: z.string(),
})
export const feedbackSubmitResponseSchema = z.object({
  at: z.string().optional(),
  id: z.string(),
  path: z.string(),
  title: z.string(),
})
export const feedbackVoteRequestSchema = z.strictObject({
  vote: z.enum(['up', 'down', 'clear']),
})
export const feedbackRemoveResponseSchema = z.object({ ok: z.literal(true) })

export type WireFeedbackView = CoreFeedbackView
export type WireFeedbackDetail = CoreFeedbackView & { detail: string, path: string }
export interface WireFeedbackList { items: WireFeedbackView[] }
export interface WireFeedbackSubmitRequest { detail: string, title: string }
export interface WireFeedbackSubmitResponse { at?: string, id: string, path: string, title: string }
export type WireFeedbackVote = CoreFeedbackVote

export const oauthAuthorizeRequestSchema = z.strictObject({
  redirectUri: z.string().optional(),
})
export const oauthAuthorizeResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('authorized') }),
  z.object({ authorizationUrl: z.url(), status: z.literal('redirect') }),
])

export interface WireOAuthAuthorizeRequest { redirectUri?: string }
export type WireOAuthAuthorizeResponse
  = | { status: 'authorized' }
    | { authorizationUrl: string, status: 'redirect' }

export const healthResponseSchema = z.object({
  catalog: z.object({
    count: z.number().int().nonnegative(),
    digest: z.string(),
  }).optional(),
  healthy: z.boolean(),
  version: z.string(),
})
export const livenessResponseSchema = z.object({ live: z.boolean() })
export const readinessResponseSchema = z.object({
  checks: z.record(z.string(), z.object({
    detail: z.string().optional(),
    ok: z.boolean(),
  })),
  ready: z.boolean(),
})

export interface WireHealthResponse {
  catalog?: { count: number, digest: string }
  healthy: boolean
  version: string
}
export interface WireLivenessResponse { live: boolean }
export interface WireReadinessResponse {
  checks: Record<string, { detail?: string, ok: boolean }>
  ready: boolean
}
