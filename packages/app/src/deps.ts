/**
 * 宿主注入面与请求期公共类型。
 *
 * 这里只放形状:五个注入点(state / objects / secrets / device / search)、进程内
 * Provider 钩子与解析后的部署配置。行为实现分散在 paths/federation/deviceNodes/
 * toolNodes/contextNodes/helpModel 与 routes/*,装配在 tbApp.ts。
 */
import type {
  BuiltinCatalog,
  CallContext,
  ContextProvider,
  ObjectStore,
  SearchIndex,
  SecretStoreImpl,
  StateStore,
  TreePath,
} from '@tool-bridge/core'
import type { Context, Hono } from 'hono'
import type { PluginBindings } from './providers/pluginClient'
import type { UpstreamProvider } from './providers/types'
import type { RemoteSettings } from './providers/remote'

/** 帧协议 call 转发的入参(id 由调用点生成,幂等键)。 */
export interface DeviceInvokeRequest {
  arguments: Record<string, unknown>
  id: string
  path: string
  tool: string
}

/** 设备通道宿主(CF = DeviceSession DO / Docker = ws)。 */
export interface DeviceChannel {
  /** HTTP→WS 调用转发:结果为 DeviceCallResult 形状(设备侧 result 帧)。 */
  invoke(deviceId: string, req: DeviceInvokeRequest): Promise<unknown>
  /** WS 升级请求转交(/system/device/ws)。 */
  ws(deviceId: string, request: Request): Promise<Response>
}

/** 进程内本地 Provider 钩子(SDK registerTool/registerContext 的装配面)。 */
export interface LocalProviderHooks {
  /** kind:'context' 节点按路径取进程内 ContextProvider;undefined → 走 plugin 解析。 */
  context?(nodePath: TreePath): ContextProvider | undefined
  /** kind:'tool' 节点按路径取进程内工具源;undefined → 走 plugin 解析。 */
  tool?(nodePath: TreePath): UpstreamProvider | undefined
}

/**
 * tb app 的宿主注入面(五注入点 + 解析后的部署配置)。
 * 核心业务逻辑零分叉:Workers 适配层(app.ts)与 SDK(packages/sdk)都注入此形状。
 */
export interface TbAppDeps {
  /** 放行 http:// 上游(仅本地开发)。 */
  allowInsecureHttp: boolean
  /** Dashboard 静态资源(Workers Static Assets);缺省 → /ui 404。 */
  assets?: (request: Request) => Promise<Response>
  /**
   * 规范网关 origin(如 `https://tool-bridge.example.com`)。配置后,OAuth 的
   * redirect_uri 钉在此规范值上,而非每请求动态取 origin——防止实例经多域名
   * (自定义域 + *.workers.dev 等)访问时,授权 code 在不同域名间被互换。
   * 缺省 → 回退到请求期 origin(单域名部署行为不变)。
   */
  canonicalOrigin?: string
  /** 设备通道;缺省 → device 能力禁用。 */
  device?: DeviceChannel
  /** $ref 中转 token 签名密钥(TB_SECRET_ENCRYPTION_KEY);缺省 → /~ref 404、大对象走 presign 或 unavailable。 */
  encryptionKey?: string
  /** 认证前的实例就绪钩子(引导/延迟注册 flush);每请求调用,幂等由宿主保证。 */
  ensureReady?: () => Promise<void>
  /** SDK 进程内 Provider 表(缺省无)。 */
  locals?: LocalProviderHooks
  /** context 平台对象存储('r2' provider 的落点);缺省 → 该 provider unavailable。 */
  objects?: () => Promise<ObjectStore> | ObjectStore
  /**
   * 进程内插件装配表(binding 名 → fetch handler)。manifest.endpoint 为
   * `binding:<name>` 的插件经此直调,零网络跳;未装配的 binding 注册/调用报 unavailable。
   */
  pluginBindings?: PluginBindings
  /**
   * 内置插件目录(descriptor)。**编译期常量**,由 `@tool-bridge/plugins` 的
   * `catalog.generated.ts` 求值生成 —— 内置插件的目录项与它的代码是同一份构建产物,
   * 故不会陈旧、也不落库(见 `llmdoc/architecture/plugin-runtime.md`)。
   *
   * 与 {@link pluginBindings} **是一对**:catalog 说"声明了什么"(挂载校验、选 export、
   * 列凭证字段),bindings 说"代码在哪"(实际调用)。装配了 binding 却没给 catalog,
   * 那个插件解析不出 export;反之则解析得出但调不动(unavailable)。宿主该两者同源装配。
   */
  pluginCatalog?: BuiltinCatalog
  /** context Get 的 $ref 内联阈值(字节,缺省 1 MiB)。 */
  refThresholdBytes?: number
  /** $ref URL(presign 与 /~ref 中转)有效期秒(缺省 900)。 */
  refTtlSec?: number
  /** remote 联邦透传配置。 */
  remote: RemoteSettings
  /** 追加保留根路径(在内置保留根之外额外声明)。 */
  reservedRoots?: string[]
  /** 全局工具搜索索引；缺省或未声明 search capability 时 /~search 不存在。 */
  search?: SearchIndex
  secrets: SecretStoreImpl
  state: StateStore
  /** mcp/tool 工具缓存 TTL 秒(缺省 300)。 */
  toolCacheTtlSec?: number
  /** healthz 与 system/status 回显的版本号(单一真源:宿主 package.json)。 */
  version: string
}
/** mcp/tool 上游工具集的默认缓存 TTL(秒)。 */
export const TOOL_CACHE_TTL_DEFAULT = 300

/** 请求期变量:认证中间件写入,handler 只读。 */
export type Vars = { ctx: CallContext, store: StateStore }

export type AppContext = Context<{ Variables: Vars }>

/** 装配中的 app 实例类型(routes/* 注册路由与 `/~mcp` 自回灌都用它)。 */
export type TbHono = Hono<{ Variables: Vars }>
