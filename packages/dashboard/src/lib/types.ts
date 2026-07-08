/**
 * HTBP 线上形状(与 core 的 HelpJson/TreeJson/TBError 对齐)。
 * Dashboard 是纯 API 客户端,不 import core——形状按网关契约手抄,字段不多不少。
 */

export type NodeKind =
  | 'directory'
  | 'builtin'
  | 'mcp'
  | 'http'
  | 'remote'
  | 'context'
  | 'device'
  | 'tool'

export type Action = 'read' | 'write' | 'call' | 'register' | 'admin'

export const ACTIONS: readonly Action[] = ['read', 'write', 'call', 'register', 'admin']

export interface Scope {
  /** 树路径 glob:"**" | "docs/**"。 */
  pattern: string
  actions: Action[]
  /** 默认 allow;deny 优先于一切 allow。 */
  effect?: 'allow' | 'deny'
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
  name: string
  method: 'POST'
  path: string
  h?: string
  inputSchema?: Record<string, unknown>
  returns?: string
  scope: Action
  effect?: string
  confirm?: boolean
}

export interface HelpJson {
  htbp: string
  node: { path: string; kind: NodeKind; description: string }
  cmds: HelpCmd[]
  children?: Array<{ path: string; kind: NodeKind; description: string }>
}

export interface TreeJson {
  path: string
  kind: NodeKind
  description: string
  online?: boolean
  truncated?: boolean
  children?: TreeJson[]
}

/** system/registry 返回的节点(builtin/registry.ts 的 Node 面)。 */
export interface RegistryNode {
  path: string
  kind: NodeKind
  description: string
  config?: Record<string, unknown>
  virtualize?: Record<string, unknown>
  owner?: string
  online?: boolean
  createdAt?: string
  updatedAt?: string
}

/** system/sk 返回的 SecretKey(无 hash)。 */
export interface SecretKeyInfo {
  id: string
  owner: string
  description?: string
  scopes: Scope[]
  registerPaths?: string[]
  disabled?: boolean
  expiresAt?: string
  createdAt?: string
}

export interface Page<T> {
  items: T[]
  cursor?: string
}

/** system/federation list 的一行:remote 联邦 host 白名单合并视图。 */
export interface FederationHost {
  host: string
  source: 'env' | 'store'
  removable: boolean
  updatedAt?: string
}

/** system/plugin 的 manifest(plugin/manifest.ts 契约手抄)。 */
export type PluginKind = 'tool-provider' | 'context-provider'

export interface PluginManifest {
  id: string
  kind: PluginKind
  /** "tool-provider/v1" | "context-provider/v1";前缀必须与 kind 一致。 */
  interfaceVersion: string
  /** https:// 或 `binding:<name>`。 */
  endpoint: string
  auth: { kind: 'platform-token' } | { kind: 'bearer'; secretRef: string }
  /** 如 "/healthz";必须以 '/' 开头。 */
  healthPath: string
  enabled: boolean
}

/** write/update 返回:pluginToken 仅该次响应出现一次(auth=platform-token 时)。 */
export interface PluginRegistration extends PluginManifest {
  pluginToken?: string
}

/** system/plugin health cmd 返回(按需探活)。 */
export interface PluginHealth {
  id: string
  healthy: boolean
  checkedAt: string
}

/** context 条目元数据(ContextEntryMeta)。 */
export interface ContextEntryMeta {
  /** node://<namespace-path>/<entry-path>。 */
  uri: string
  contentType: string
  size?: number
  version: string
  updatedAt: string
  metadata: Record<string, string>
}

/** context 条目(含内容;大对象 content = { $ref })。 */
export interface ContextEntry extends ContextEntryMeta {
  content: string | unknown
}
