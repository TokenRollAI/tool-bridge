import type {
  ContextProvider,
  DeviceClientState,
  DeviceExpose,
  NodeInput,
  ObjectStore,
  SecretStoreImpl,
  StateStore,
  ToolResult,
  ToolSpec,
  TreePath,
} from '@tool-bridge/core'

/** 值或其 Promise(SDK 使用者的 Provider 方法可同步亦可异步)。 */
export type Awaitable<T> = T | Promise<T>

/**
 * SDK 使用者实现的工具源(Proto §4.1 ToolProvider 的放宽形态:
 * 方法允许返回 Promise;core 的同步 ToolProvider 天然可赋值)。
 */
export interface ToolProviderLike {
  List(): Awaitable<ToolSpec[]>
  Get(name: string): Awaitable<ToolSpec>
  Call(name: string, args: Record<string, unknown>): Awaitable<ToolResult>
}

/**
 * §6 设备 WS 的网关侧宿主注入点(Proto §7)。本轮 SDK 未实现其消费
 * (Docker 宿主属 Phase 6),注入将得到 unimplemented。
 */
export interface DeviceTransport {
  onConnection(handler: (conn: DeviceConn) => void): void
}

export interface DeviceConn {
  readonly authorization?: string
  send(frame: unknown): void
  onFrame(handler: (frame: unknown) => void): void
  onClose(handler: () => void): void
  close(code?: number): void
}

/** createToolBridge 配置(Proto §7 签名 + SDK 引导扩展,后者见各字段注释)。 */
export interface ToolBridgeConfig {
  /** 树配置 / SK / manifest 的存取(宿主注入;内存宿主可用 MemoryStateStore)。 */
  state: StateStore
  /** context 对象('r2' 平台 provider 的落点);缺省 → 该 provider unavailable。 */
  objects?: ObjectStore
  /**
   * §2.5 上游凭证;缺省实现 = 基于 state 的加密存储,主密钥取
   * config.encryptionKey 或 env TB_SECRET_ENCRYPTION_KEY——两者皆无 →
   * secret 能力禁用(Set 返回 unavailable,与 §2.5 一致)。
   */
  secrets?: SecretStoreImpl
  /** §6 设备 WS 的网关侧宿主;未注入则 device 能力禁用。本轮注入 → unimplemented(Phase 6)。 */
  deviceTransport?: DeviceTransport
  /** §2.4 b 的追加保留根路径。 */
  reservedRoots?: string[]
  /** §3.4 remote baseUrl 的 host 后缀白名单;空/缺省 = 拒绝一切 remote 注册。 */
  remoteAllowlist?: string[]
  /** §3.4 X-TB-Via 跳数上限;默认 4。 */
  maxHops?: number

  // ---- 以下为 SDK 引导扩展(Proto §7 未列;决策见实现报告) ----

  /**
   * Admin SK 明文(引导时 sha256 入库,与 gateway TB_BOOTSTRAP_ADMIN_SK 同语义);
   * 缺省取 env TB_BOOTSTRAP_ADMIN_SK;皆无 → 首次引导随机生成并 console.log 一次。
   */
  adminSk?: string
  /** secrets 缺省实现的主密钥(base64url 32B);缺省取 env TB_SECRET_ENCRYPTION_KEY。 */
  encryptionKey?: string
  /** 放行 http:// 上游(仅本地开发,Proto §4.2)。 */
  allowInsecureHttp?: boolean
  /** 本实例 X-TB-Via 标识(缺省用入站 host 派生)。 */
  instanceId?: string
}

/** Proto §7 Connection(state 词表与 core DeviceClientState 逐字一致)。 */
export interface Connection {
  close(): void
  readonly state: DeviceClientState
}

/** SDK 实现的 Connection 超集(便于嵌入方等待挂载/退出;Proto 之外的便利面)。 */
export interface SdkConnection extends Connection {
  /** ready 帧到达(值 = 网关确认的 mountPath);拒绝/建连失败 → reject。 */
  readonly ready: Promise<string>
  /** 连接终结(close() 或网关拒绝)。 */
  readonly closed: Promise<void>
}

export interface ConnectOptions {
  /** 缺省 = os.hostname() 规范化,不持久化——断线重连恢复 online 依赖稳定 deviceId,长驻嵌入方应显式传入。 */
  deviceId?: string
  /** 缺省 device/<deviceId>(Proto §6.1)。 */
  mountPath?: TreePath
  /**
   * 缺省 = 本实例 register* 注册的节点(经 hello 帧 nodes+cmds 上报)。
   * 显式传入时只支持 nodes(shell/fs 执行器属 CLI `tb connect`,SDK 不内置)。
   */
  expose?: DeviceExpose
}

/** Proto §7 ToolBridge。 */
export interface ToolBridge {
  /** HTTP 表面:挂到任意宿主(Workers export / @hono/node-server / 已有 app.route)。 */
  fetch(req: Request): Promise<Response>
  /** 程序化注册:本地实现 Provider 挂上树(等价 NodeRegistry.Write;写入延迟到首次 fetch/connect 前)。 */
  registerTool(path: TreePath, provider: ToolProviderLike, meta?: Partial<NodeInput>): void
  registerContext(path: TreePath, provider: ContextProvider, meta?: Partial<NodeInput>): void
  /** 反向连接(HTTP → WebSocket):把本实例的节点挂到远程 TB(§6 的设备侧实现)。 */
  connect(remoteBaseUrl: string, sk: string, opts?: ConnectOptions): SdkConnection
}
