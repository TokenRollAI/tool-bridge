/**
 * HTBP 线上形状(与 core 的 HelpJson/TreeJson/TBError 对齐)。
 * Dashboard 是纯 API 客户端,不 import core——形状按网关契约手抄,字段不多不少。
 */

export type NodeKind
  = | 'directory'
    | 'builtin'
    | 'mcp'
    | 'http'
    | 'remote'
    | 'context'
    | 'skillhub'
    | 'device'
    | 'tool'

export type Action = 'read' | 'write' | 'call' | 'register' | 'admin'

export const ACTIONS: readonly Action[] = ['read', 'write', 'call', 'register', 'admin']

export interface Scope {
  actions: Action[]
  /** 默认 allow;deny 优先于一切 allow。 */
  effect?: 'allow' | 'deny'
  /** 树路径 glob:"**" | "docs/**"。 */
  pattern: string
}

export interface TBErrorBody {
  code:
    | 'not_found'
    | 'permission_denied'
    | 'invalid_argument'
    | 'conflict'
    | 'unavailable'
    | 'rate_limited'
    | 'internal'
  message: string
  retryable: boolean
}

export interface HelpCmd {
  confirm?: boolean
  effect?: string
  h?: string
  inputSchema?: Record<string, unknown>
  method: 'POST'
  name: string
  path: string
  returns?: string
  scope: Action
}

export interface HelpJson {
  children?: Array<{ description: string, kind: NodeKind, path: string }>
  cmds: HelpCmd[]
  /** Agent feedback 默认区块(头部条目,只含 id/title/score)。 */
  feedback?: Array<{ id: string, score: number, title: string }>
  htbp: string
  node: { description: string, kind: NodeKind, path: string }
  /** 管理员补充说明(system/annotation,网关 ~help 注入)。 */
  note?: string
}

/** ~feedback 端点的条目视图(list 不含 detail;get 含)。 */
export interface FeedbackView {
  at: string
  by: string
  detail?: string
  down: number
  id: string
  score: number
  title: string
  up: number
}

export interface TreeJson {
  children?: TreeJson[]
  description: string
  kind: NodeKind
  online?: boolean
  path: string
  truncated?: boolean
}

/** system/registry 返回的节点(builtin/registry.ts 的 Node 面)。 */
export interface RegistryNode {
  config?: Record<string, unknown>
  createdAt?: string
  description: string
  kind: NodeKind
  online?: boolean
  path: string
  registeredBy?: string
  updatedAt?: string
  virtualize?: Record<string, unknown>
}

/** system/sk 返回的 SecretKey(无 hash)。 */
export interface SecretKeyInfo {
  createdAt?: string
  description?: string
  disabled?: boolean
  expiresAt?: string
  id: string
  owner: string
  registerPaths?: string[]
  scopes: Scope[]
}

export interface Page<T> {
  cursor?: string
  items: T[]
}

/** system/federation list 的一行:remote 联邦 host 白名单合并视图。 */
export interface FederationHost {
  host: string
  removable: boolean
  source: 'env' | 'store'
  updatedAt?: string
}

/** system/plugin 的 manifest(plugin/manifest.ts 契约手抄)。 */
export type PluginKind = 'tool-provider' | 'context-provider'

export interface PluginManifest {
  auth: { kind: 'platform-token' } | { kind: 'bearer', secretRef: string }
  enabled: boolean
  /** https:// 或 `binding:<name>`。 */
  endpoint: string
  /** 如 "/healthz";必须以 '/' 开头。 */
  healthPath: string
  id: string
  /** "tool-provider/v1" | "context-provider/v1";前缀必须与 kind 一致。 */
  interfaceVersion: string
  kind: PluginKind
}

/** write/update 返回:pluginToken 仅该次响应出现一次(auth=platform-token 时)。 */
export interface PluginRegistration extends PluginManifest {
  pluginToken?: string
}

/** system/plugin health cmd 返回(按需探活)。 */
export interface PluginHealth {
  checkedAt: string
  healthy: boolean
  id: string
}

/** context 条目元数据(ContextEntryMeta)。 */
export interface ContextEntryMeta {
  contentType: string
  metadata: Record<string, string>
  size?: number
  updatedAt: string
  /** node://<namespace-path>/<entry-path>。 */
  uri: string
  version: string
}

/** context 条目(含内容;大对象 content = { $ref })。 */
export interface ContextEntry extends ContextEntryMeta {
  content: string | unknown
}

/** skillhub 目录条目摘要(List/Search 返回的 SkillSummary)。 */
export interface SkillSummary {
  description: string
  id: string
  name: string
  updatedAt?: string
  version?: string
}

/** skillhub 技能内文件(Get{id,file} 返回;大对象 content = { $ref })。 */
export interface SkillFile {
  content?: string | { $ref: string }
  contentType: string
  path: string
  size?: number
  version: string
}

/** skillhub 技能详情(Get{id} 返回:SKILL.md 正文 + 文件清单)。 */
export interface SkillDetail extends SkillSummary {
  /** SKILL.md 正文(YAML frontmatter + Markdown)。 */
  content: string
  files: SkillFile[]
}
