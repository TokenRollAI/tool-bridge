/**
 * @tool-bridge/sdk 公开面:createToolBridge / ToolBridge / Connection +
 * 四个宿主注入点。核心逻辑来自 @tool-bridge/core 与 gateway 的宿主中立 tbApp
 * (createTbApp),SDK 只做装配——公开面即全部通道,不存在私有通道。
 */

// 常用类型与内存宿主实现的再导出(嵌入方实现 Provider / 注入 store 用)。
export {
  type ContextEntry,
  type ContextEntryInput,
  type ContextEntryMeta,
  type ContextPatch,
  type ContextProvider,
  type DeviceClientState,
  type DeviceExpose,
  type ListOptions,
  MemoryObjectStore,
  MemoryStateStore,
  type NodeInput,
  type ObjectStore,
  type Page,
  type SearchOptions,
  SecretStoreImpl,
  type StateStore,
  TBError,
  type ToolProvider,
  type ToolResult,
  type ToolSpec,
  type TreePath,
} from '@tool-bridge/core'
export { createToolBridge } from './toolBridge'
export type {
  Connection,
  ConnectOptions,
  SdkConnection,
  ToolBridge,
  ToolBridgeConfig,
  ToolProviderLike,
} from './types'
