import type { ToolResult, ToolSpec } from '@tool-bridge/core'

/**
 * gateway 侧的**异步**工具源。
 *
 * core 的 `ToolProvider` 是同步逻辑契约(纯逻辑内核不做 I/O);gateway 的 mcp/http 实现要发
 * 网络请求,故这里用返回 Promise 的等价形状。`List` 产出**虚拟化前**的上游原始 `ToolSpec[]`
 * (名字是上游真名);虚拟化与反查在调用点用 core 的 `virtualizeTools`/`resolveUpstreamTool`。
 */
export interface UpstreamProvider {
  /** 枚举上游全部工具(虚拟化前的原名)。 */
  list(): Promise<ToolSpec[]>
  /** 用**上游真名**调用(调用点已把虚拟名反查为真名)。 */
  call(name: string, args: Record<string, unknown>): Promise<ToolResult>
}
