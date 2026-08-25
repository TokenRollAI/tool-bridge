/**
 * @tool-bridge/sdk 公开面:createToolBridge / ToolBridge / Connection +
 * 宿主注入点。核心逻辑来自 @tool-bridge/core 与 app 的宿主中立 tbApp
 * (createTbApp),SDK 只做装配——公开面即全部通道,不存在私有通道。
 */

/** Hermes-safe default Store upload helper; also available from `@tool-bridge/sdk/device`. */
export { uploadObject } from './device/storeUpload'
export type {
  CallUploadObjectOptions,
  StoreChecksum,
  StoreObjectDescriptor,
  UploadObjectInput,
  UploadObjectOptions,
} from './device/storeUpload'
export { createStoreClient } from './storeClient'
export type {
  StoreClient,
  StoreClientObjectDescriptor,
  StoreClientOptions,
  StoreListOptions,
  StoreListPage,
  StoreReadGrant,
  StoreShareGrant,
} from './storeClient'
export { createToolBridge } from './toolBridge'
export type {
  Connection,
  ConnectOptions,
  SdkConnection,
  ToolBridge,
  ToolBridgeConfig,
  ToolProviderLike,
  ToolSource,
} from './types'
/** S3/R2 S3-compatible 对象存储适配；配置到 `objects` 后可签发直传 PUT。 */
export { createS3ObjectStore, type S3StoreConfig } from '@tool-bridge/app'
// 常用类型与内存宿主实现的再导出(嵌入方实现 Provider / 注入 store 用)。
export {
  type ContextEntry,
  type ContextEntryInput,
  type ContextEntryMeta,
  type ContextPatch,
  type ContextProvider,
  type ContextUploadGrant,
  type ContextUploadInput,
  type DeviceClientState,
  type DeviceExpose,
  type ListOptions,
  MemoryObjectStore,
  MemoryStateStore,
  type NodeInput,
  type ObjectPresignedPut,
  type ObjectPresignPutOptions,
  type ObjectStore,
  OperationRegistry,
  type Page,
  type SearchOptions,
  SecretStoreImpl,
  type StateStore,
  TBError,
  type ToolResult,
  type ToolSpec,
  type TreePath,
} from '@tool-bridge/core'
