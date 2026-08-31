/** 设备客户端窄入口：只导出 neutral 协议、状态机及其直接依赖。 */

export {
  isTBError,
  statusForCode,
  TB_ERROR_CODES,
  TBError,
  type TBErrorBody,
  type TBErrorCode,
  type TBErrorOptions,
} from '../errors'
export { normalizePath, validatePath } from '../tree/path'
export {
  type DeviceExpose,
  type DeviceNodeCmd,
  type DeviceNodeInput,
  type TreePath,
} from '../types'
export * from './client'
export * from './frames'
// mailbox 是 server 侧权威(DeviceMailboxService 等),不属于设备客户端窄入口;
// 只显式导出设备执行侧真实消费的完成载荷类型。
export type { DeviceOperationCompletion } from './mailbox'
// presence 是 device 概念的纯投影;SDK /client 子入口经此消灭 dashboard 的手抄镜像。
export {
  derivePresence,
  type DerivePresenceInput,
  type Presence,
  PRESENCE_STALE_AFTER_MS,
  type PresenceState,
} from './presence'
