/**
 * @tool-bridge/core —— 树 / Auth / 协议编解码的纯逻辑内核(无宿主依赖)。
 * 网关、SDK、CLI 都装配它;Phase 1 起是公共内核(Architecture.md、DOD.md:19)。
 *
 * Phase 0 只落地:TBError 契约与映射、协议版本常量。
 */

export {
  isTBError,
  statusForCode,
  TBError,
  type TBErrorBody,
  type TBErrorCode,
  type TBErrorOptions,
} from './errors'
export { HTBP_HELP_HEADER, HTBP_VERSION } from './version'
