import type { RegistryNode } from '@tool-bridge/sdk/client'

/**
 * builtin/system 管理面视图与 NodeConfig 形状直接来自 core(经依赖 bundle,单一真源)。
 * 此前 CLI 手抄一份且已实际漂移(tool 变体缺 export/providerConfig,靠 as 断言压制)。
 * SecretSummary 是 core `SecretEntrySummary` 的既有 CLI 命名。
 */
export type {
  ContextEntry,
  ContextEntryMeta,
  HttpToolDef,
  NodeConfig,
  SecretKeyCreated,
  SecretKeyInput,
  SecretKeyView,
  SecretEntrySummary as SecretSummary,
  Virtualize,
} from '@tool-bridge/core'

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
import type { NodeConfig, Virtualize } from '@tool-bridge/core'

/** whoami 的宽松健康视图(system/status/get 返回的 StatusSummary 子集,探测失败时字段缺省)。 */
export interface StatusView {
  healthy?: boolean
  version?: string
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

/** NodeInput = Omit<Node,'registeredBy'|'online'|'lastSeenAt'|'createdAt'|'updatedAt'>。 */
export interface NodeInput {
  config?: NodeConfig
  description: string
  kind: RegistryNode['kind']
  path: string
  virtualize?: Virtualize
}
