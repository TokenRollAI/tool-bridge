/** Host-neutral HTTP application; Node hosts inject PG repositories and S3 backends. */
import pkg from '../package.json' with { type: 'json' }
export const APP_VERSION = pkg.version

// --- 引导(Admin SK + 内置节点物化)---
// runBootstrap:宿主中立,有真实启动点的宿主直调(Node/SDK)。
export {
  buildDeps,
  type BuiltinAssemblyOpts,
  runBootstrap,
} from './bootstrap'

// --- 应用装配面(宿主接线的主入口)---
export { parseS3Credentials } from './contextNodes'

export {
  type DeviceChannel,
  type DeviceInvokeRequest,
  type LocalProviderHooks,
  type ReadinessReport,
  type TbAppDeps,
} from './deps'
export type { S3StoreConfig } from './deps'

// --- 设备反向注册:hello 校验与落库的单一真源 ---
// Node WebSocket 适配负责传输；共享生命周期与设备树规则由此处统一维护。
export {
  assertDeviceId,
  assertFsRoots,
  type DeviceHello,
  type HelloAcceptance,
  processDeviceHello,
} from './deviceHello'

// --- 设备连接生命周期(重验/断线/回收)的宿主中立编排 ---
export {
  deviceSearchCapacityWarning,
  markDeviceDisconnected,
  reclaimDeviceSubtree,
  reverifyDeviceAuthority,
} from './deviceLifecycle'

export {
  cleanupDeviceMailbox,
  type CleanupDeviceMailboxOptions,
  createDeviceMailboxService,
} from './deviceMailbox'
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
export {
  toWebObjectBodyStream,
  type WebObjectBodyStreamOptions,
} from './objectBodyStream'
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

// --- 大对象 $ref:预签名与网关中转 token ---

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
// --- 部署级 default Store：宿主装配与 scheduled cleanup ---
export {
  cleanupDefaultStore,
  defaultStoreRuntime,
  KEY_STORE_CLEANUP_PROGRESS,
  KEY_STORE_TOKEN_SECRET,
  resolveStoreRequestOrigin,
  STORE_CALL_CAPABILITY_HEADER,
  STORE_UPLOAD_HEADER,
  storeTokenSecret,
} from './store'
export { createTbApp } from './tbApp'

export { serveUiAssets } from './uiAssets'
