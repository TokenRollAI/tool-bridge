/**
 * 协议与内核版本常量。
 *
 * HTBP 协议版本用于 `~help` DSL 首行(`htbp <ver>`);major 与
 * Plugin 的 interfaceVersion 对齐。此处只承载协议版本,不承载 npm 包版本
 * ——包版本(healthz 用)由各包的 package.json 提供,避免两处漂移。
 */

/** HTBP 协议版本。 */
export const HTBP_VERSION = '0.1'

/** `~help` DSL 首行(`htbp 0.1`)。 */
export const HTBP_HELP_HEADER = `htbp ${HTBP_VERSION}`
