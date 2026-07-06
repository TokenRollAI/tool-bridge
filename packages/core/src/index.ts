/**
 * @tool-bridge/core —— 树 / Auth / 协议编解码的纯逻辑内核(无宿主依赖)。
 * 网关、SDK、CLI 都装配它;Phase 1 起是公共内核(Architecture.md、DOD.md:19)。
 */

export * from './auth/authorizer'
export * from './auth/registerPath'
export * from './auth/scope'
export * from './auth/sk'
export * from './builtin'
export {
  isTBError,
  statusForCode,
  TBError,
  type TBErrorBody,
  type TBErrorCode,
  type TBErrorOptions,
} from './errors'
export * from './htbp/helpDsl'
export * from './htbp/model'
export * from './htbp/negotiate'
export * from './htbp/tree'
export * from './secret/secretStore'
export * from './store'
export * from './tree/path'
export * from './tree/registry'
export * from './tree/visibility'
export * from './types'
export { HTBP_HELP_HEADER, HTBP_VERSION } from './version'
