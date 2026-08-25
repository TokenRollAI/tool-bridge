import type { PluginBindings } from '@tool-bridge/app'
import { type BuiltinCatalog,
  type ContextProvider,
  type DeviceClientState,
  type DeviceExpose,
  type NodeInput,
  type ObjectStore,
  type OperationRegistry,
  type SecretStoreImpl,
  type StateStore,
  type ToolResult,
  type ToolSpec,
  type TreePath } from '@tool-bridge/core'

/** 值或其 Promise(SDK 使用者的 Provider 方法可同步亦可异步)。 */
export type Awaitable<T> = T | Promise<T>

/**
 * SDK 使用者手写的工具源:**只有 list 与 call 两个动词**(全小写,cmd 名 = 方法名)。
 * 此前还强制 `get`,但平台从不发 get(`~help` 的数据源是 list 产出的 ToolSpec[]),
 * 那是纯样板 —— 已随 core 的 `ToolProvider` 一并删除。方法可同步可异步。
 */
export interface ToolProviderLike {
  call(name: string, args: Record<string, unknown>): Awaitable<ToolResult>
  list(): Awaitable<ToolSpec[]>
}

/**
 * `registerTool` 收的工具源:手写 Provider **或**直接交一个 core `OperationRegistry`。
 * 后者是零样板路径 —— 用 Zod 声明入参,JSON Schema、校验、裸返回值包装都不用自己写,
 * 与 plugin 作者面(`@tool-bridge/plugin-sdk`)同一套内核。
 */
export type ToolSource = OperationRegistry | ToolProviderLike

/** createToolBridge 配置(标准签名 + SDK 引导扩展,后者见各字段注释)。 */
export interface ToolBridgeConfig {
  /**
   * Admin SK 明文(引导时 sha256 入库,与 gateway TB_BOOTSTRAP_ADMIN_SK 同语义);
   * 缺省取 env TB_BOOTSTRAP_ADMIN_SK；首次引导时两者皆无则拒绝启动。
   */
  adminSk?: string
  /** 放行 http:// 上游(仅本地开发)。 */
  allowInsecureHttp?: boolean
  /** secrets 缺省实现的主密钥(base64url 32B);缺省取 env TB_SECRET_ENCRYPTION_KEY。 */
  encryptionKey?: string
  /** 本实例 X-TB-Via 标识(缺省用入站 host 派生)。 */
  instanceId?: string
  /** X-TB-Via 跳数上限;默认 4。 */
  maxHops?: number
  /**
   * default Store 与对象型 Context 的共享字节 driver。Store 是部署必备能力，
   * 嵌入宿主必须显式注入；测试/明确易失开发可使用 MemoryObjectStore。
   */
  objects: ObjectStore
  /** 进程内插件装配表(binding 名 → fetch handler);`binding:<name>` 插件经此直调。 */
  pluginBindings?: PluginBindings
  /**
   * 内置插件目录的 descriptor(编译期常量)。与 {@link pluginBindings} **同源装配** ——
   * catalog 说"声明了什么"(挂载校验、选 export、列凭证字段),bindings 说"代码在哪"。
   * 只给 bindings 的话插件调得动但解析不出 export。
   *
   * 装 `@tool-bridge/plugins` 的宿主直接传它的 `BUILTIN_CATALOG`;自建插件集的嵌入方
   * 按同形状给自己那份。
   */
  pluginCatalog?: BuiltinCatalog
  /**
   * Provider OAuth 令牌端点的出站通道。SDK 不会回退到全局 fetch；嵌入方启用
   * Provider OAuth 时必须显式注入，并负责逐跳出站策略与跨源 body 重定向保护。
   */
  providerOAuthFetch?: typeof fetch

  // ---- 以下为 SDK 引导扩展(标准签名未列) ----

  /** remote baseUrl 的 host 后缀白名单;空/缺省 = 拒绝一切 remote 注册。 */
  remoteAllowlist?: string[]
  /** 追加保留根路径。 */
  reservedRoots?: string[]
  /**
   * 上游凭证;缺省实现 = 基于 state 的加密存储,主密钥取
   * config.encryptionKey 或 env TB_SECRET_ENCRYPTION_KEY——两者皆无 →
   * secret 能力禁用(Set 返回 unavailable)。
   */
  secrets?: SecretStoreImpl
  /** 树配置 / SK / manifest 的存取(宿主注入;内存宿主可用 MemoryStateStore)。 */
  state: StateStore
  /** create_upload 写入 grant 有效期秒；缺省 900，最大 604800。 */
  uploadGrantTtlSec?: number
}

/** Connection(state 词表与 core DeviceClientState 逐字一致)。 */
export interface Connection {
  close(): void
  readonly state: DeviceClientState
}

/** SDK 实现的 Connection 超集(便于嵌入方等待挂载/退出的便利面)。 */
export interface SdkConnection extends Connection {
  /** 连接终结(close() 或网关拒绝)。 */
  readonly closed: Promise<void>
  /** ready 帧到达(值 = 网关确认的 mountPath);拒绝/建连失败 → reject。 */
  readonly ready: Promise<string>
}

export interface ConnectOptions {
  /** 缺省 = os.hostname() 规范化,不持久化——断线重连恢复 online 依赖稳定 deviceId,长驻嵌入方应显式传入。 */
  deviceId?: string
  /**
   * 缺省 = 本实例 register* 注册的节点(经 hello 帧 nodes+cmds 上报)。
   * 显式传入时只支持 nodes(shell/fs 执行器属 CLI `tb connect`,SDK 不内置)。
   */
  expose?: DeviceExpose
  /** 缺省 device/<deviceId>。 */
  mountPath?: TreePath
}

/** ToolBridge。 */
export interface ToolBridge {
  /** 反向连接(HTTP → WebSocket):把本实例的节点挂到远程 TB(设备侧实现)。 */
  connect(remoteBaseUrl: string, sk: string, opts?: ConnectOptions): SdkConnection
  /** HTTP 表面:挂到任意宿主(Workers export / @hono/node-server / 已有 app.route)。 */
  fetch(req: Request): Promise<Response>
  registerContext(path: TreePath, provider: ContextProvider, meta?: Partial<NodeInput>): void
  /** 程序化注册:本地实现 Provider 挂上树(等价 NodeRegistry.Write;写入延迟到首次 fetch/connect 前)。 */
  registerTool(path: TreePath, source: ToolSource, meta?: Partial<NodeInput>): void
}
