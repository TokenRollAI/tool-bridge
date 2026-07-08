/**
 * 公共类型。
 *
 * 原样转写规范中的 TS 定义;此处仅补充实现所需的最小派生(如 ACTIONS 常量表)。
 */

/** 资源 URI。 */
export type URI = string
/** 树上路径,'/' 分隔,不含保留段;如 "docs/context7"。 */
export type TreePath = string
/** ISO 8601, UTC。 */
export type Timestamp = string

export interface Page<T> {
  items: T[]
  /** 存在则表示还有下一页;传回 List 继续。 */
  cursor?: string
}

export interface ListOptions {
  cursor?: string
  /** 规范默认 50、上限 200,超上限静默钳制。 */
  limit?: number
  /** 键集合由各接口 ~help 声明;未声明的键 → invalid_argument。 */
  filter?: Record<string, string>
}

/** List limit 的规范默认与上限。 */
export const LIST_LIMIT_DEFAULT = 50
export const LIST_LIMIT_MAX = 200

/** "user:alice" | "agent:researcher" | "device:build-01"。 */
export type OwnerRef = string

export interface CallContext {
  /** 本次调用使用的 SK 的 id(非明文)。 */
  keyId: string
  owner: OwnerRef
  scopes: Scope[]
  /** 反向注册路径收紧规则;缺省按非保留根放行。 */
  registerPaths?: TreePath[]
  /** 全链路观测。 */
  traceId: string
  /** 平台→Plugin envelope 专用:本次调用来自哪个挂载节点(同一 plugin 可多路径挂载)。 */
  mountPath?: TreePath
  /** 平台→Plugin envelope 专用:挂载节点 config.providerConfig 透传(每挂载非敏感配置)。 */
  mountConfig?: Record<string, unknown>
}

// ---------- Auth ----------

export type Action = 'read' | 'write' | 'call' | 'register' | 'admin'

export const ACTIONS: readonly Action[] = ['read', 'write', 'call', 'register', 'admin']

export interface Scope {
  /** 树路径 glob:"**" | "docs/**" | "device/build-01/**"。 */
  pattern: string
  actions: Action[]
  /** 默认 allow;deny 优先于一切 allow。 */
  effect?: 'allow' | 'deny'
}

export interface SecretKey {
  /** key id(可公开,审计用)。 */
  id: string
  /** sha256(明文);明文仅在签发响应中出现一次。 */
  hash: string
  owner: OwnerRef
  description?: string
  /** 空数组 = 无任何权限。 */
  scopes: Scope[]
  /** 反向注册路径约束;缺省见规则 b。 */
  registerPaths?: TreePath[]
  /** 吊销 = Update{disabled:true} 或 Delete。 */
  disabled?: boolean
  createdAt: Timestamp
  /** 过期视同 disabled。 */
  expiresAt?: Timestamp
}

export interface SecretKeyInput {
  owner: OwnerRef
  description?: string
  scopes: Scope[]
  registerPaths?: TreePath[]
  expiresAt?: Timestamp
}

// ---------- Tree ----------

export type NodeKind =
  | 'directory'
  | 'mcp'
  | 'http'
  | 'builtin'
  | 'context'
  | 'device'
  | 'remote'
  | 'tool'

export const NODE_KINDS: readonly NodeKind[] = [
  'directory',
  'mcp',
  'http',
  'builtin',
  'context',
  'device',
  'remote',
  'tool',
]

export interface TreeNode {
  /** 唯一键。 */
  path: TreePath
  kind: NodeKind
  /** 一句话;上级 ~help 列子节点时展示。 */
  description: string
  /** 按 kind 区分。 */
  config?: NodeConfig
  /** 工具虚拟化(mcp/http 适用)。 */
  virtualize?: Virtualize
  /** keyId;device 节点由 Gateway 代写;自动物化 directory 为 'system:auto'。 */
  registeredBy: string
  /** 仅 device:连接状态。 */
  online?: boolean
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface Virtualize {
  /** 工具名统一加前缀。 */
  prefix?: string
  /** 原名 → 虚拟名。 */
  rename?: Record<string, string>
  /** 隐藏的工具名。 */
  hide?: string[]
  /** description override。 */
  describe?: Record<string, string>
}

export interface HttpToolDef {
  name: string
  description: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** 相对 endpoint;支持 {param} 占位。 */
  pathTemplate: string
  /** JSON Schema;~help 的数据源。 */
  inputSchema?: unknown
  /** 工具副作用词汇;缺省由 Provider 按 method/schema 派生。 */
  effect?: 'read' | 'write' | 'destructive'
}

export interface DeviceExpose {
  /** 挂 `<mountPath>/shell` 工具节点;allow 白名单语义:缺省 [] = 全拒。 */
  shell?: { description?: string; allow?: string[] }
  /** 挂 `<mountPath>/fs` context 节点(file provider);支持多根。 */
  fs?: { roots: string[]; readOnly?: boolean }
  /** SDK 自定义节点(路径相对 mountPath)。 */
  nodes?: DeviceNodeInput[]
}

/**
 * expose.nodes 元素:NodeInput + 可选工具表 `cmds`(ToolSpec 形状,
 * SDK 随注册上送;网关存入代写节点的 providerConfig 作 `~help` 数据源,不新增帧类型)。
 */
export type DeviceNodeInput = NodeInput & { cmds?: DeviceNodeCmd[] }

/** 设备自定义节点随注册上送的单条工具元数据(与 tool/types.ts 的 ToolSpec 同形)。 */
export interface DeviceNodeCmd {
  name: string
  description?: string
  inputSchema?: unknown
  effect?: string
  confirm?: boolean
}

export type NodeConfig =
  /** auth:'oauth' 时凭证由网关托管 OAuth 流程获取(POST /<path>/~authorize 发起),authRef 忽略。 */
  | { kind: 'mcp'; url: string; authRef?: string; auth?: 'oauth' }
  | {
      kind: 'http'
      endpoint: string
      tools: HttpToolDef[]
      authRef?: string
      authHeader?: string
      authScheme?: string
    }
  | { kind: 'builtin'; module: string }
  | {
      kind: 'context'
      provider: string
      providerConfig?: Record<string, unknown>
      authRef?: string
      readOnly?: boolean
      /** ttl 秒:到期整节点回收(临时 namespace)。 */
      ttl?: number
    }
  | { kind: 'device'; deviceId: string; expose: DeviceExpose }
  | { kind: 'remote'; baseUrl: string; skRef?: string }
  /** tool-provider 挂载:provider = plugin id 或 SDK 内部保留 id(如 '@local')。
   *  providerConfig:设备自定义节点的转发标记(deviceId+mountPath+cmds,网关代写)。 */
  | { kind: 'tool'; provider: string; providerConfig?: Record<string, unknown> }

export type NodeInput = Omit<TreeNode, 'registeredBy' | 'online' | 'createdAt' | 'updatedAt'>

/** 自动物化中间 directory 的 registeredBy 标记。 */
export const SYSTEM_AUTO = 'system:auto'

/** 保留段:不可作为普通路径段。 */
export const RESERVED_SEGMENTS: readonly string[] = [
  '~help',
  '~skill',
  '~tree',
  '~register',
  '~describe',
  '~authorize',
]

/** 平台保留根路径段(基础集;部署配置可追加)。 */
export const RESERVED_ROOTS: readonly string[] = ['system', 'ui']
