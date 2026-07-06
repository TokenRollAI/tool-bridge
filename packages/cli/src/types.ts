import type { Scope } from './scope'

/**
 * 网关返回的线格式类型(CLI 本地镜像,只取渲染所需字段;未知字段透传忽略)。
 * 与 Proto §1/§2/§3 的 JSON 等价表现对齐(HelpJson/TreeJson 精确 schema 属实现自定,
 * 见 phase1-spec-digest §4.2/§4.3;此处按 team-lead 约定的契约建模)。
 */

export interface NodeSummary {
  path: string
  kind: string
  description?: string
}

export interface HelpCmd {
  name: string
  method?: string
  path?: string
  scope?: string
  /** arguments 的 JSON Schema(Proto §1.3;不含 {tool,arguments} 信封)。 */
  inputSchema?: unknown
  returns?: string
}

export interface HelpJson {
  htbp: string
  node: NodeSummary
  cmds: HelpCmd[]
  children?: NodeSummary[]
}

export interface TreeJson {
  path: string
  kind: string
  description?: string
  online?: boolean
  truncated?: boolean
  children?: TreeJson[]
}

export interface Page<T> {
  items: T[]
  cursor?: string
}

/** SecretKey 投影(hash 永不出网关,Proto §2.3)。 */
export interface SecretKeyView {
  id: string
  owner: string
  description?: string
  scopes: Scope[]
  registerPaths?: string[]
  disabled?: boolean
  createdAt?: string
  expiresAt?: string
}

export interface SecretKeyInput {
  owner: string
  description?: string
  scopes: Scope[]
  registerPaths?: string[]
  expiresAt?: string
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

/** 工具虚拟化(Proto §3.1;mcp/http 适用)。 */
export interface Virtualize {
  prefix?: string
  rename?: Record<string, string>
  hide?: string[]
  describe?: Record<string, string>
}

/** http Provider 的单个工具定义(Proto §3.2)。 */
export interface HttpToolDef {
  name: string
  description: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  pathTemplate: string
  inputSchema?: unknown
  effect?: 'read' | 'write' | 'destructive'
}

/** NodeConfig 按 kind(Proto §3.2;CLI 构造 mcp/http/remote/context 四形状)。 */
export type NodeConfig =
  | { kind: 'mcp'; url: string; authRef?: string }
  | {
      kind: 'http'
      endpoint: string
      tools: HttpToolDef[]
      authRef?: string
      authHeader?: string
      authScheme?: string
    }
  | { kind: 'remote'; baseUrl: string; skRef?: string }
  | {
      kind: 'context'
      provider: string
      providerConfig?: Record<string, unknown>
      authRef?: string
      readOnly?: boolean
      ttl?: number
    }

/** Node 投影(NodeRegistry.List/Get 返回;CLI 只取渲染所需字段)。 */
export interface Node {
  path: string
  kind: string
  description?: string
  config?: NodeConfig
  virtualize?: Virtualize
  registeredBy?: string
  online?: boolean
  createdAt?: string
  updatedAt?: string
}

/** context entry 元数据(ContextProvider List/Write/Update 返回,Proto §5.1)。 */
export interface ContextEntryMeta {
  uri: string
  contentType: string
  size?: number
  version: string
  updatedAt: string
  metadata: Record<string, string>
}

/** context entry 全量(Get 返回;大对象 content = { $ref: <预签名 URL> },Proto §5.1)。 */
export interface ContextEntry extends ContextEntryMeta {
  content: string | unknown
}

/** NodeInput = Omit<Node,'registeredBy'|'online'|'createdAt'|'updatedAt'>(Proto §3.3)。 */
export interface NodeInput {
  path: string
  kind: string
  description: string
  config?: NodeConfig
  virtualize?: Virtualize
}
