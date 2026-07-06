/**
 * HTBP 线上形状(与 core 的 HelpJson/TreeJson/TBError 对齐,Proto §1.3/§0.2)。
 * Dashboard 是纯 API 客户端,不 import core——形状以 Proto 为契约手抄,字段不多不少。
 */

export type NodeKind = 'directory' | 'builtin' | 'mcp' | 'http' | 'remote' | 'context' | 'device'

export type Action = 'read' | 'write' | 'call' | 'register' | 'admin'

export const ACTIONS: readonly Action[] = ['read', 'write', 'call', 'register', 'admin']

export interface Scope {
  /** 树路径 glob:"**" | "docs/**"(Proto §2.2)。 */
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
