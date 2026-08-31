// Action 枚举常量表(wire 契约的一部分):SDK /client 经此提供运行时值,
// Dashboard/CLI 不再各自手抄 ['read','write','call','register','admin']。
export { ACTIONS } from '../types'
/** @tool-bridge/core/protocol — 固定控制面 wire 真源与 OpenAPI artifact。 */
export * from './openapi'
export * from './wire'
