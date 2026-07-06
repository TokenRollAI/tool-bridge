/**
 * 公共类型(Proto §0.3/§0.4、§2、§3)。
 *
 * 原样转写规范中的 TS 定义;字段与注释以 docs/Proto.md 为真源,
 * 此处仅补充实现所需的最小派生(如 ACTIONS 常量表)。
 */

/** 资源 URI(Proto §0.1)。 */
export type URI = string
/** 树上路径,'/' 分隔,不含保留段;如 "docs/context7"(Proto §0.3)。 */
export type TreePath = string
/** ISO 8601, UTC(Proto §0.3)。 */
export type Timestamp = string

export interface Page<T> {
  items: T[]
  /** 存在则表示还有下一页;传回 List 继续。 */
  cursor?: string
}

export interface ListOptions {
  cursor?: string
  /** 规范默认 50、上限 200,超上限静默钳制(Proto §0.3)。 */
  limit?: number
  /** 键集合由各接口 ~help 声明;未声明的键 → invalid_argument。 */
  filter?: Record<string, string>
}

/** List limit 的规范默认与上限(Proto §0.3)。 */
export const LIST_LIMIT_DEFAULT = 50
export const LIST_LIMIT_MAX = 200

/** "user:alice" | "agent:researcher" | "device:build-01"(Proto §0.3)。 */
export type OwnerRef = string

export interface CallContext {
  /** 本次调用使用的 SK 的 id(非明文)。 */
  keyId: string
  owner: OwnerRef
  scopes: Scope[]
  /** 全链路观测。 */
  traceId: string
}

// ---------- §2 Auth ----------

export type Action = 'read' | 'write' | 'call' | 'register' | 'admin'

export const ACTIONS: readonly Action[] = ['read', 'write', 'call', 'register', 'admin']

export interface Scope {
  /** 树路径 glob:"**" | "docs/**" | "device/build-01/**"(Proto §2.2)。 */
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
  /** 空数组 = 无任何权限(Proto §2.2)。 */
  scopes: Scope[]
  /** 反向注册路径约束(Proto §2.4);缺省见规则 b。 */
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

// ---------- §3 Tree ----------

export type NodeKind = 'directory' | 'mcp' | 'http' | 'builtin' | 'context' | 'device' | 'remote'

export interface TreeNode {
  /** 唯一键。 */
  path: TreePath
  kind: NodeKind
  /** 一句话;上级 ~help 列子节点时展示。 */
  description: string
  /** 按 kind 区分(Proto §3.2)。 */
  config?: NodeConfig
  /** 工具虚拟化(mcp/http 适用)。 */
  virtualize?: Virtualize
  /** keyId;device 节点由 Gateway 代写;自动物化 directory 为 'system:auto'(Proto §3.3)。 */
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
  shell?: boolean
  fs?: { root: string; readOnly?: boolean }
  tools?: string[]
}

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

export type NodeInput = Omit<TreeNode, 'registeredBy' | 'online' | 'createdAt' | 'updatedAt'>

/** 自动物化中间 directory 的 registeredBy 标记(Proto §3.3)。 */
export const SYSTEM_AUTO = 'system:auto'

/** 保留段(Proto §1.1):不可作为普通路径段。 */
export const RESERVED_SEGMENTS: readonly string[] = [
  '~help',
  '~skill',
  '~tree',
  '~register',
  '~describe',
]

/** 平台保留根路径段(Proto §1.1/§2.4b 基础集;部署配置可追加)。 */
export const RESERVED_ROOTS: readonly string[] = ['system', 'ui']
