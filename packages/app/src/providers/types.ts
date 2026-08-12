import type { ToolResult, ToolSpec } from '@tool-bridge/core'

/**
 * gateway 侧的**异步**工具源。
 *
 * 这是工具源在平台上**唯一**的契约:`list` + `call` 两个动词,方法返回 Promise
 * (mcp/http/plugin 实现都要发网络请求)。`list` 产出**虚拟化前**的上游原始 `ToolSpec[]`
 * (名字是上游真名);虚拟化与反查在调用点用 core 的 `virtualizeTools`/`resolveUpstreamTool`。
 * 没有 `Get`:`~help` 的数据源是 `list` 的产物,平台从不按名单取单个 spec。
 */
export interface UpstreamProvider {
  /** 用**上游真名**调用(调用点已把虚拟名反查为真名)。 */
  call(name: string, args: Record<string, unknown>): Promise<ToolResult>
  /** 枚举上游全部工具(虚拟化前的原名)。 */
  list(): Promise<ToolSpec[]>
}
