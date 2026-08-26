import type { RegistryNode } from '@tool-bridge/sdk/client'
import type { Scope } from './scope'

/** 固定 HTBP wire 类型来自 SDK public artifact，不再由 CLI 手抄。 */
export type {
  HelpCommand as HelpCmd,
  HelpJson,
  Page,
  Presence,
  PresenceState,
  ToolSearchItem,
  ToolSearchPage,
  ToolSpec,
  TreeJson,
} from '@tool-bridge/sdk/client'

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
  | { authRef?: string, kind: 'tool', provider: string }
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

/**
 * Node 投影(NodeRegistry.List/Get 返回;CLI 只取渲染所需字段)。
 * 这是存储层形状:保留裸 `online`(连接建立/拆除的事件位),不是 `~tree` 的三态 presence。
 */
export interface Node extends Omit<RegistryNode, 'config' | 'description' | 'virtualize'> {
  config?: NodeConfig
  description?: string
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

/** NodeInput = Omit<Node,'registeredBy'|'online'|'lastSeenAt'|'createdAt'|'updatedAt'>。 */
export interface NodeInput {
  config?: NodeConfig
  description: string
  kind: RegistryNode['kind']
  path: string
  virtualize?: Virtualize
}
