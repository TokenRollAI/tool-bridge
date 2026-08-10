/**
 * Tool Layer 的中立类型。
 *
 * `ToolSpec` 是**上游工具的中立形状**:mcp(`tools/list` 的 `Tool`)与 http
 * (`HttpToolDef`)都归一到它,虚拟化(virtualize.ts)与 `~help` 派生(mcpSchema.ts)
 * 只认 `ToolSpec`,不感知上游是 mcp 还是 http。它把 `ToolMeta`+`ToolDef`
 * 合并为一个形状:`description` 可缺省(上游可能不带),另携 `confirm`(危险工具二次确认)。
 */

/** 上游工具的中立形状(mcp/http 归一目标)。 */
export interface ToolSpec {
  /** 危险操作二次确认;进 `~help` 的 confirm 行。 */
  confirm?: boolean
  /** 一句话描述;进 `~help` 的 `h` 行。上游可能不带 → 可缺省。 */
  description?: string
  /** 副作用标记(read/write/destructive);进 `~help` 的 effect 行。 */
  effect?: string
  /** JSON Schema;`~help` 的 body 数据源。 */
  inputSchema?: unknown
  /** 工具名(虚拟化前为上游原名,虚拟化后为对外虚拟名)。 */
  name: string
}

/**
 * 工具调用结果。`isError:true` 是**工具业务级错误**(上游 HTTP 200
 * 正常返回、内容为错),按内容协商渲染——**不是** TBError(传输/协议错误才归一为
 * TBError,见 upstreamError.ts)。
 */
export interface ToolResult {
  /** markdown 文本或结构化 JSON(按内容协商输出)。 */
  content: string | unknown
  isError?: boolean
}

/*
 * 这里曾有一个 `ToolProvider` 接口(List/Get/Call 三动词)。它已删除:
 * - 平台从不发 `Get`(gateway pluginTool 只发 List/Call,`~help` 的数据源是 List 的产物),
 *   它是纯样板,却被写成**强制**方法;
 * - 网关侧真正被实现的是异步的 `UpstreamProvider`(gateway providers/types.ts),
 *   core 的这份同步声明没有任何实现者与消费者,只剩下"看起来是契约"的误导。
 * 作者面现在是 `OperationRegistry`(Zod 驱动,operation/registry.ts)。
 */
