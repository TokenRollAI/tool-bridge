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

/**
 * 设备三态在线状态(core PresenceState 的本地镜像)。
 * - `online`:连接位为真且最近有存活观察。
 * - `stale`:连接位仍为真但存活观察已超时,很可能已不可路由。
 * - `offline`:已观察到连接拆除。
 */
export type PresenceState = 'online' | 'stale' | 'offline'

/** `~tree` / `~help` 上的 presence 形状,取代旧版裸 `online` 布尔。 */
export interface Presence {
  lastSeenAt?: string
  state: PresenceState
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
  path: string
  /** 仅 device:三态在线状态(网关投影时由 online + lastSeenAt 派生)。 */
  presence?: Presence
  truncated?: boolean
}

export interface Page<T> {
  cursor?: string
  items: T[]
}

/** root `~search` 返回的虚拟化后 ToolSpec。 */
export interface ToolSpec {
  confirm?: boolean
  description?: string
  effect?: string
  inputSchema?: unknown
  name: string
}

export interface ToolSearchItem {
  path: string
  tool: ToolSpec
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
export interface Node {
  config?: NodeConfig
  createdAt?: string
  description?: string
  kind: string
  /** 最近一次观察到设备存活的时刻;与 `online` 合看才是新鲜度。 */
  lastSeenAt?: string
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

/** NodeInput = Omit<Node,'registeredBy'|'online'|'lastSeenAt'|'createdAt'|'updatedAt'>。 */
export interface NodeInput {
  config?: NodeConfig
  description: string
  kind: string
  path: string
  virtualize?: Virtualize
}
