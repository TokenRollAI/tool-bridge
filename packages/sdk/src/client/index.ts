/** @tool-bridge/sdk/client — Web-standard 固定控制面 client。 */
export {
  createToolBridgeClient,
  ToolBridgeClientError,
} from './client'
export type {
  ClientErrorKind,
  ClientInvokeResult,
  ClientQueryPrimitive,
  ClientQueryValue,
  ClientRawResponse,
  ClientRequestOptions,
  ClientResponseSchema,
  GetHelpOptions,
  GetHelpTextOptions,
  ToolBridgeClient,
  ToolBridgeClientOptions,
} from './client'

export {
  createSetupClient,
  parseConfigUpdate,
  parseRuntimeConfig,
  parseSetupInput,
  parseStorageRotate,
  parseStorageWrite,
} from './management'
export type {
  ConfigStatus,
  RecoveryInput,
  RecoveryResult,
  RuntimeConfig,
  SetupDefaults,
  SetupInput,
  SetupResult,
  SetupStatus,
  StorageBackendView,
} from './management'

export {
  parseContextUploadGrant,
  parsePresignedPutGrant,
  PresignedPutError,
  putPresignedObject,
} from './presignedPut'
export type {
  ContextUploadGrant,
  PresignedPutErrorKind,
  PresignedPutGrant,
  PutPresignedOptions,
} from './presignedPut'
/**
 * builtin/system 管理面视图类型的唯一对外出口(真源在 core;core 是 private 包,
 * CLI/Dashboard 经此消费,不再各自手抄 PluginManifest/CatalogListItem/SecretKeyView 等)。
 * 这些是 `system/*` 命令的返回形状,不属于固定控制面 wire,故不走上面的 Wire* 别名。
 */
export type {
  CatalogExportAuth,
  CatalogExportDetails,
  CatalogListItem,
  ContextEntry,
  ContextEntryMeta,
  FederationHost,
  HttpToolDef,
  KeyBackup,
  KeyStatus,
  KeyTarget,
  MaintenanceJournal,
  MaintenanceStatus,
  NodeConfig,
  PluginCredentialField,
  PluginExport,
  PluginExportAuth,
  PluginHealthRecord,
  PluginManifest,
  PluginMountConfigField,
  PluginProfile,
  PluginRegistration,
  PluginView,
  Scope,
  SecretEntrySummary,
  SecretKeyCreated,
  SecretKeyInput,
  SecretKeyView,
  SkillDetail,
  SkillFile,
  SkillFileMeta,
  SkillSummary,
  StatusSummary,
  Virtualize,
} from '@tool-bridge/core'

export type { DeploymentClaim, DeploymentJobView, DeploymentSettings, DeploymentStatus } from '@tool-bridge/core/deployment'

/**
 * device presence 三态派生(存储态 online+lastSeenAt → offline/stale/online 投影)。
 * `~tree` 已由宿主投影好 presence 直接读;`system/registry` 的存储态要三态就过这里。
 */
export {
  derivePresence,
  type DerivePresenceInput,
  PRESENCE_STALE_AFTER_MS,
} from '@tool-bridge/core/device'

export { fixedControlPlaneOpenApi } from '@tool-bridge/core/protocol'

export type { FixedControlPlaneOpenApi } from '@tool-bridge/core/protocol'
export type {
  WireAction as Action,
  WireDeviceOperationDetail as DeviceOperationDetail,
  WireDeviceOperationListRequest as DeviceOperationListRequest,
  WireDeviceOperationState as DeviceOperationState,
  WireDeviceOperationSummary as DeviceOperationSummary,
  WireFeedbackDetail as FeedbackDetail,
  WireFeedbackList as FeedbackList,
  WireFeedbackSubmitRequest as FeedbackSubmitRequest,
  WireFeedbackSubmitResponse as FeedbackSubmitResponse,
  WireFeedbackView as FeedbackView,
  WireFeedbackVote as FeedbackVote,
  WireHealthResponse as HealthResponse,
  WireHelpCommand as HelpCommand,
  WireHelpJson as HelpJson,
  WireLivenessResponse as LivenessResponse,
  WireNodeInput as NodeInput,
  WireNodeKind as NodeKind,
  WireOAuthAuthorizeRequest as OAuthAuthorizeRequest,
  WireOAuthAuthorizeResponse as OAuthAuthorizeResponse,
  WirePage as Page,
  WirePresence as Presence,
  WirePresenceState as PresenceState,
  WireReadinessResponse as ReadinessResponse,
  WireRegistryNode as RegistryNode,
  WireTBErrorBody as TBErrorBody,
  WireTBErrorCode as TBErrorCode,
  WireToolSearchFederation as ToolSearchFederation,
  WireToolSearchItem as ToolSearchItem,
  WireToolSearchPage as ToolSearchPage,
  WireToolSearchRequest as ToolSearchRequest,
  WireToolSearchSource as ToolSearchSource,
  WireToolSearchSourceResult as ToolSearchSourceResult,
  WireToolSearchSourceStatus as ToolSearchSourceStatus,
  WireToolSpec as ToolSpec,
  WireTreeJson as TreeJson,
} from '@tool-bridge/core/protocol'

/** Action 枚举常量表(运行时值,经 protocol 出口)。 */
export { ACTIONS } from '@tool-bridge/core/protocol'
