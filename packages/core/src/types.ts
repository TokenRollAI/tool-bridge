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
  /** 存在则表示还有下一页;传回 List 继续。 */
  cursor?: string
  items: T[]
}

export interface ListOptions {
  cursor?: string
  /** 键集合由各接口 ~help 声明;未声明的键 → invalid_argument。 */
  filter?: Record<string, string>
  /** 规范默认 50、上限 200,超上限静默钳制。 */
  limit?: number
}

/** List limit 的规范默认与上限。 */
export const LIST_LIMIT_DEFAULT = 50
export const LIST_LIMIT_MAX = 200

/** "user:alice" | "agent:researcher" | "device:build-01"。 */
export type OwnerRef = string

export interface CallContext {
  /** 本次调用使用的 SK 的 id(非明文)。 */
  keyId: string
  /** 平台→Plugin envelope 专用:挂载节点 config.providerConfig 透传(每挂载非敏感配置)。 */
  mountConfig?: Record<string, unknown>
  /** 平台→Plugin envelope 专用:本次调用来自哪个挂载节点(同一 plugin 可多路径挂载)。 */
  mountPath?: TreePath
  owner: OwnerRef
  /** 反向注册路径收紧规则;缺省按非保留根放行。 */
  registerPaths?: TreePath[]
  scopes: Scope[]
  /** 全链路观测。 */
  traceId: string
}

// ---------- Auth ----------

export type Action = 'read' | 'write' | 'call' | 'register' | 'admin'

export const ACTIONS: readonly Action[] = ['read', 'write', 'call', 'register', 'admin']

export interface Scope {
  actions: Action[]
  /** 默认 allow;deny 优先于一切 allow。 */
  effect?: 'allow' | 'deny'
  /** 树路径 glob:"**" | "docs/**" | "device/build-01/**"。 */
  pattern: string
}

export interface SecretKey {
  createdAt: Timestamp
  description?: string
  /** 吊销 = Update{disabled:true} 或 Delete。 */
  disabled?: boolean
  /** 过期视同 disabled。 */
  expiresAt?: Timestamp
  /** sha256(明文);明文仅在签发响应中出现一次。 */
  hash: string
  /** key id(可公开,审计用)。 */
  id: string
  owner: OwnerRef
  /** 反向注册路径约束;缺省见规则 b。 */
  registerPaths?: TreePath[]
  /** 空数组 = 无任何权限。 */
  scopes: Scope[]
}

export interface SecretKeyInput {
  description?: string
  expiresAt?: Timestamp
  owner: OwnerRef
  registerPaths?: TreePath[]
  scopes: Scope[]
}

// ---------- Tree ----------

export type NodeKind
  = | 'directory'
    | 'mcp'
    | 'http'
    | 'builtin'
    | 'context'
    | 'device'
    | 'remote'
    | 'tool'
    | 'skillhub'

export const NODE_KINDS: readonly NodeKind[] = [
  'directory',
  'mcp',
  'http',
  'builtin',
  'context',
  'device',
  'remote',
  'tool',
  'skillhub',
]

export interface TreeNode {
  /** 按 kind 区分。 */
  config?: NodeConfig
  createdAt: Timestamp
  /** 一句话;上级 ~help 列子节点时展示。 */
  description: string
  kind: NodeKind
  /** 仅 device:连接状态。 */
  online?: boolean
  /** 唯一键。 */
  path: TreePath
  /** keyId;device 节点由 Gateway 代写;自动物化 directory 为 'system:auto'。 */
  registeredBy: string
  updatedAt: Timestamp
  /** 工具虚拟化(mcp/http 适用)。 */
  virtualize?: Virtualize
}

export interface Virtualize {
  /** description override。 */
  describe?: Record<string, string>
  /** 隐藏的工具名。 */
  hide?: string[]
  /** 工具名统一加前缀。 */
  prefix?: string
  /** 原名 → 虚拟名。 */
  rename?: Record<string, string>
}

export interface HttpToolDef {
  description: string
  /** 工具副作用词汇;缺省由 Provider 按 method/schema 派生。 */
  effect?: 'read' | 'write' | 'destructive'
  /** JSON Schema;~help 的数据源。 */
  inputSchema?: unknown
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  name: string
  /** 相对 endpoint;支持 {param} 占位。 */
  pathTemplate: string
}

export interface DeviceExpose {
  /** 挂 `<mountPath>/fs` context 节点(file provider);支持多根。 */
  fs?: { readOnly?: boolean, roots: string[] }
  /** SDK 自定义节点(路径相对 mountPath)。 */
  nodes?: DeviceNodeInput[]
  /** 挂 `<mountPath>/shell` 工具节点;allow 白名单语义:缺省 [] = 全拒。 */
  shell?: { allow?: string[], description?: string }
}

/**
 * expose.nodes 元素:NodeInput + 可选工具表 `cmds`(ToolSpec 形状,
 * SDK 随注册上送;网关存入代写节点的 providerConfig 作 `~help` 数据源,不新增帧类型)。
 */
export type DeviceNodeInput = NodeInput & { cmds?: DeviceNodeCmd[] }

/** 设备自定义节点随注册上送的单条工具元数据(与 tool/types.ts 的 ToolSpec 同形)。 */
export interface DeviceNodeCmd {
  confirm?: boolean
  description?: string
  effect?: string
  inputSchema?: unknown
  name: string
}

export type NodeConfig
  /** auth:'oauth' 时凭证由网关托管 OAuth 流程获取(POST /<path>/~authorize 发起),authRef 忽略。 */
  = | {
    auth?: 'oauth'
    /** authRef 凭证注入的头名(默认 Authorization)。 */
    authHeader?: string
    authRef?: string
    /** 凭证前缀;空串 = 原样注入(默认 Bearer)。 */
    authScheme?: string
    /** 静态明文请求头(非机密,如上游要求的工具白名单头);authRef 头优先。 */
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
  | { kind: 'builtin', module: string }
  | {
    authRef?: string
    kind: 'context'
    provider: string
    providerConfig?: Record<string, unknown>
    readOnly?: boolean
    /** ttl 秒:到期整节点回收(临时 namespace)。 */
    ttl?: number
  }
  | { deviceId: string, expose: DeviceExpose, kind: 'device' }
  | { baseUrl: string, kind: 'remote', skRef?: string }
  /** tool-provider 挂载:provider = plugin id 或 SDK 内部保留 id(如 '@local')。
   *  providerConfig:设备自定义节点的转发标记(deviceId+mountPath+cmds,网关代写)。
   *  authRef:上游凭证引用,调用时平台 resolve 后经 X-TB-Upstream-Auth 注入 plugin。 */
  | { authRef?: string, kind: 'tool', provider: string, providerConfig?: Record<string, unknown> }
  /** skillhub:与 context 同形的内容型 kind,存 Agent Skill(每 skill = <id>/SKILL.md + 若干文本文件)。
   *  底层复用 context 的对象存储(provider r2 用平台自带桶,无需外部凭证;s3 需 authRef)。 */
  | {
    authRef?: string
    kind: 'skillhub'
    provider: string
    providerConfig?: Record<string, unknown>
    readOnly?: boolean
    /** ttl 秒:到期整节点回收(临时 hub)。 */
    ttl?: number
  }

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
  '~feedback',
]

/** 平台保留根路径段(基础集;部署配置可追加)。 */
export const RESERVED_ROOTS: readonly string[] = ['system', 'ui']
