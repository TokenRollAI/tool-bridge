import type { Scope } from './scope'

/**
 * 网关返回的线格式类型(CLI 本地镜像,只取渲染所需字段;未知字段透传忽略)。
 * HelpJson/TreeJson 为渲染所需的精确 schema,按网关契约建模。
 */

export interface NodeSummary {
  description?: string
  kind: string
  path: string
}

export interface HelpCmd {
  /** arguments 的 JSON Schema(不含 {tool,arguments} 信封)。 */
  inputSchema?: unknown
  method?: string
  name: string
  path?: string
  returns?: string
  scope?: string
}

export interface HelpJson {
  children?: NodeSummary[]
  cmds: HelpCmd[]
  htbp: string
  node: NodeSummary
}

export interface TreeJson {
  children?: TreeJson[]
  description?: string
  kind: string
  online?: boolean
  path: string
  truncated?: boolean
}

export interface Page<T> {
  cursor?: string
  items: T[]
}

/** SecretKey 投影(hash 永不出网关)。 */
export interface SecretKeyView {
  createdAt?: string
  description?: string
  disabled?: boolean
  expiresAt?: string
  id: string
  owner: string
  registerPaths?: string[]
  scopes: Scope[]
}

export interface SecretKeyInput {
  description?: string
  expiresAt?: string
  owner: string
  registerPaths?: string[]
  scopes: Scope[]
}

/** SKRegistry.Write 返回:密钥投影 + 明文(仅此一次)。 */
export interface SecretKeyCreated {
  key: SecretKeyView
  secret: string
}

export interface SecretSummary {
  name: string
  updatedAt?: string
}

export interface StatusView {
  healthy?: boolean
  version?: string
}

/** 工具虚拟化(mcp/http 适用)。 */
export interface Virtualize {
  describe?: Record<string, string>
  hide?: string[]
  prefix?: string
  rename?: Record<string, string>
}

/** http Provider 的单个工具定义。 */
export interface HttpToolDef {
  description: string
  effect?: 'read' | 'write' | 'destructive'
  inputSchema?: unknown
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  name: string
  pathTemplate: string
}

/** NodeConfig 按 kind(CLI 构造 mcp/http/remote/context/skillhub 形状)。 */
export type NodeConfig
  = | {
    auth?: 'oauth'
    authHeader?: string
    authRef?: string
    authScheme?: string
    headers?: Record<string, string>
    kind: 'mcp'
    url: string
  }
  | {
    authHeader?: string
    authRef?: string
    authScheme?: string
    endpoint: string
    kind: 'http'
    tools: HttpToolDef[]
  }
  | { baseUrl: string, kind: 'remote', skRef?: string }
  | {
    authRef?: string
    kind: 'context'
    provider: string
    providerConfig?: Record<string, unknown>
    readOnly?: boolean
    ttl?: number
  }
  | {
    authRef?: string
    kind: 'skillhub'
    provider: string
    providerConfig?: Record<string, unknown>
    readOnly?: boolean
    ttl?: number
  }

/** Node 投影(NodeRegistry.List/Get 返回;CLI 只取渲染所需字段)。 */
export interface Node {
  config?: NodeConfig
  createdAt?: string
  description?: string
  kind: string
  online?: boolean
  path: string
  registeredBy?: string
  updatedAt?: string
  virtualize?: Virtualize
}

/** context entry 元数据(ContextProvider List/Write/Update 返回)。 */
export interface ContextEntryMeta {
  contentType: string
  metadata: Record<string, string>
  size?: number
  updatedAt: string
  uri: string
  version: string
}

/** context entry 全量(Get 返回;大对象 content = { $ref: <预签名 URL> })。 */
export interface ContextEntry extends ContextEntryMeta {
  content: string | unknown
}

/** NodeInput = Omit<Node,'registeredBy'|'online'|'createdAt'|'updatedAt'>。 */
export interface NodeInput {
  config?: NodeConfig
  description: string
  kind: string
  path: string
  virtualize?: Virtualize
}
