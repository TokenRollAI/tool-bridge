/**
 * `@tool-bridge/app` —— 宿主中立的 HTBP 应用层。
 *
 * 这一层实现整棵 HTBP 树的全部行为(路由、内容协商、`~help`/`~tree`/`~skill`/
 * `~describe`/`~register`/`~feedback` 保留段、权限判定、工具虚拟化、remote 联邦、
 * context 四动词、skillhub、plugin 传输、托管 OAuth、无状态 `/~mcp` 投影与全局搜索),
 * 且不依赖任何具体基础设施:宿主差异全部经 `TbAppDeps` 的注入点传入——
 *
 *   StateStore     KV / D1 / SQLite / 内存
 *   ObjectStore    R2 / S3 / 文件系统 / 内存
 *   SecretStore    AES-256-GCM 信封,主密钥由宿主提供
 *   DeviceChannel  Durable Object / Node ws / 自定义传输
 *   SearchIndex    可选;缺省不暴露 search capability
 *
 * 因此同一棵树可以跑在 Cloudflare Workers(`@tool-bridge/gateway`)、
 * Node/Docker(`@tool-bridge/server`)、进程内嵌(`@tool-bridge/sdk`),
 * 或任何自备上述实现的宿主上。自建宿主的最小形态:
 *
 * ```ts
 * import { createTbApp, runBootstrap } from '@tool-bridge/app'
 *
 * await runBootstrap(state, { adminSk, requireAdminSk: true })
 * const app = createTbApp({ state, secrets, objects: () => objectStore, version: '1.0.0' })
 * // app.fetch(request) —— 一个标准 fetch handler
 * ```
 */

// --- 引导(Admin SK + 内置节点物化)---
// runBootstrap:宿主中立,有真实启动点的宿主直调(Node/SDK)。
// ensureBootstrapped:模块级 once,给无启动钩子、只能首请求惰性引导的宿主(Workers)。
export {
  buildDeps,
  type BuiltinAssemblyOpts,
  ensureBootstrapped,
  resetBootstrapForTest,
  runBootstrap,
} from './bootstrap'

// --- 应用装配面(宿主接线的主入口)---
export { dispatchContextCmd, parseS3Credentials } from './contextNodes'

export {
  type DeviceChannel,
  type DeviceInvokeRequest,
  type LocalProviderHooks,
  type TbAppDeps,
} from './deps'

// --- 设备反向注册:hello 校验与落库的单一真源 ---
// 宿主胶水(DO / Node ws)只负责传输,协议行为改这里,防两宿主树形态漂移。
export {
  assertDeviceId,
  assertFsRoots,
  type DeviceHello,
  type HelloAcceptance,
  processDeviceHello,
} from './deviceHello'

// --- 无状态 /~mcp 投影(把 HTBP 树暴露成 MCP server)---
export {
  handleMcpRequest,
  type McpBridgeTool,
  type McpToolBridge,
  mcpToolIdentity,
  mcpToolName,
} from './mcpServer'
// --- mcp 上游的托管 OAuth 授权码流程 ---
export {
  assertLocalRedirectUri,
  finishMcpAuthorization,
  GatewayMcpOAuthProvider,
  invalidateMcpOAuth,
  type McpOAuthFlowOpts,
  type McpOAuthProviderOpts,
  OAUTH_CALLBACK_PATH,
  type OAuthStatePayload,
  openOAuthState,
  reauthorizeRequired,
  renderOAuthCallbackHtml,
  sealOAuthState,
  type StartAuthorizationResult,
  startMcpAuthorization,
} from './oauth'
// --- Provider 接线零件(自建宿主按需装配)---
export { createHttpProvider, type HttpConfig } from './providers/http'
export { createMcpProvider, invalidateMcpEra, type McpConfig } from './providers/mcp'
// --- Plugin 传输(平台 → Plugin 的信封通道;binding: 为进程内直调)---
export {
  callPlugin,
  fetchPluginContract,
  type PluginBindingHandler,
  type PluginCallOptions,
  probePlugin,
  resolvePluginEndpoint,
} from './providers/pluginClient'

export type { PluginBindings } from './providers/pluginClient'
export { createPluginContextProvider, type PluginContextOptions } from './providers/pluginContext'
export { createPluginToolProvider } from './providers/pluginTool'

export { assertRemoteAllowed, passthroughRemote, type RemoteConfig } from './providers/remote'
export type { RemoteSettings } from './providers/remote'

export { createS3ObjectStore, type S3StoreConfig } from './providers/s3Object'

// --- 大对象 $ref:预签名与网关中转 token ---
export { encodeObjectKey, presignS3Url } from './providers/s3Sign'
export {
  cachedTools,
  getTools,
  invalidateToolCache,
  peekToolCache,
  toolCacheKey,
  toolCacheTtl,
} from './providers/toolCache'
export type { UpstreamProvider } from './providers/types'
export { type RefTokenPayload, signRefToken, verifyRefToken } from './refToken'
// --- 全局工具搜索的派生状态同步 ---
export {
  canonicalSearchTools,
  isMutableSearchIndex,
  type SearchDirtyMarker,
  SearchSynchronizer,
} from './search/synchronizer'
export { createTbApp } from './tbApp'
