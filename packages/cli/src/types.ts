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
