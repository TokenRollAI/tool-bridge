/**
 * Tool Layer 的中立类型(Proto §4.1)。
 *
 * `ToolSpec` 是**上游工具的中立形状**:mcp(`tools/list` 的 `Tool`)与 http
 * (`HttpToolDef`)都归一到它,虚拟化(virtualize.ts)与 `~help` 派生(mcpSchema.ts)
 * 只认 `ToolSpec`,不感知上游是 mcp 还是 http。它把 Proto §4.1 的 `ToolMeta`+`ToolDef`
 * 合并为一个形状:`description` 可缺省(上游可能不带),另携 `confirm`(危险工具二次确认)。
 */

/** 上游工具的中立形状(mcp/http 归一目标)。 */
export interface ToolSpec {
  /** 工具名(虚拟化前为上游原名,虚拟化后为对外虚拟名)。 */
  name: string
  /** 一句话描述;进 `~help` 的 `h` 行。上游可能不带 → 可缺省。 */
  description?: string
  /** JSON Schema;`~help` 的 body 数据源。 */
  inputSchema?: unknown
  /** 副作用标记(mcp: read/write/destructive;http: readonly/mutating/destructive);进 `~help` 的 effect 行。 */
  effect?: string
  /** 危险操作二次确认;进 `~help` 的 confirm 行。 */
  confirm?: boolean
}

/**
 * 工具调用结果(Proto §4.1)。`isError:true` 是**工具业务级错误**(上游 HTTP 200
 * 正常返回、内容为错),按 §1.2 协商渲染——**不是** TBError(传输/协议错误才归一为
 * TBError,见 upstreamError.ts)。
 */
export interface ToolResult {
  /** markdown 文本或结构化 JSON(按 §1.2 协商输出)。 */
  content: string | unknown
  isError?: boolean
}

/**
 * 工具源契约(Proto §4.1,原样:List/Get/Call 三动词——工具源天然只读 + 可调用)。
 * mcp/http 内置 Provider 实现它,把上游归一到 `ToolSpec`;`List` 返回全量数组
 * (工具源天然小,豁免 §0.4 分页)。此接口是逻辑契约,I/O 实现(gateway)可返回 Promise。
 */
export interface ToolProvider {
  /** 枚举该源的全部工具(虚拟化前的原始名;网关做映射)。 */
  List(): ToolSpec[]
  /** 单个工具的完整 schema/描述 —— `~help` 的数据源。 */
  Get(name: string): ToolSpec
  /** 调用。 */
  Call(name: string, args: Record<string, unknown>): ToolResult
}
