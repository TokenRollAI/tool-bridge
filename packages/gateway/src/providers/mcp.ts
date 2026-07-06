/**
 * mcp 内置 Provider(Proto §4.2):经官方 MCP SDK 的 Streamable HTTP client 连接 `config.url`。
 *
 * - `List` ← `tools/list`,`Call` ← `tools/call`;上游 `tools[].inputSchema` 已是 JSON Schema,
 *   直接进 `ToolSpec.inputSchema`;annotations 派生 effect(readOnlyHint→read、
 *   destructiveHint→destructive;无提示则不标注,避免过度声明)。
 * - **会话一次性(Proto §4.2 定型)**:每次 list/call 完整握手(connect→操作→finally
 *   terminateSession + close),不跨请求复用;上游 404(会话失效)时重建会话重试一次。
 * - `authRef` 经 SecretStore.resolve 注入 `requestInit.headers` 的静态 `Authorization: Bearer`。
 * - **单一 choke point**(`guard`):一切传输/协议错误经 `normalizeUpstreamError` 归一为 TBError;
 *   MCP RPC 业务错误(`result.isError`)不是错误——落 `ToolResult.isError`,正常返回。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker'
import {
  assertSecureUrl,
  isTBError,
  normalizeUpstreamError,
  type SecretStoreImpl,
  type ToolResult,
  type ToolSpec,
} from '@tool-bridge/core'
import type { UpstreamProvider } from './types'

/** mcp 节点 config(Proto §3.2)。 */
export interface McpConfig {
  url: string
  authRef?: string
}

/** MCP SDK 返回的单个工具形状(仅取我们用到的字段)。 */
interface McpTool {
  name: string
  description?: string
  inputSchema?: unknown
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
}

/** annotations → effect(Proto §4.1 词汇);无明确提示则返回 undefined(不臆测 write)。 */
function effectFromAnnotations(a: McpTool['annotations']): string | undefined {
  if (!a) return undefined
  if (a.readOnlyHint === true) return 'read'
  if (a.destructiveHint === true) return 'destructive'
  return undefined
}

function toSpec(t: McpTool): ToolSpec {
  const spec: ToolSpec = { name: t.name }
  if (t.description !== undefined) spec.description = t.description
  if (t.inputSchema !== undefined) spec.inputSchema = t.inputSchema
  const effect = effectFromAnnotations(t.annotations)
  if (effect !== undefined) spec.effect = effect
  return spec
}

/** callTool 结果 → ToolResult:全 text 片段拼接;含非 text 片段则结构化原样返回。 */
function toToolResult(res: { content?: unknown; isError?: boolean }): ToolResult {
  const parts = Array.isArray(res.content)
    ? (res.content as Array<{ type: string; text?: string }>)
    : []
  const allText = parts.length > 0 && parts.every((p) => p.type === 'text')
  const content: unknown = allText ? parts.map((p) => p.text ?? '').join('') : res.content
  const out: ToolResult = { content }
  if (res.isError === true) out.isError = true
  return out
}

/**
 * 我们只使用 Streamable HTTP 的 request/response 能力(listTools/callTool),不消费服务端主动
 * 消息流。MCP SDK 在 initialize 后会自动尝试 GET 打开可选 standalone SSE;这里对 GET 直接
 * 返回 405(协议允许:服务器不提供 SSE),避免关闭会话时中止一条无用网络连接。
 */
const noStandaloneSseFetch: typeof fetch = (input, init) => {
  const method =
    init?.method ??
    (input instanceof Request
      ? input.method
      : typeof input === 'object' && 'method' in input
        ? input.method
        : 'GET')
  if (String(method).toUpperCase() === 'GET') {
    return Promise.resolve(new Response(null, { status: 405, statusText: 'Method Not Allowed' }))
  }
  return fetch(input, init)
}

/**
 * 一次性会话内执行 `fn`:connect(完成 initialize 握手)→ fn → finally 终止会话 + 关闭。
 * 上游 404(会话失效)→ 重建 transport(不带 sessionId)重连重试一次(Reference §3)。
 */
async function withSession<T>(
  url: string,
  bearer: string | undefined,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const makeTransport = (): StreamableHTTPClientTransport =>
    new StreamableHTTPClientTransport(
      new URL(url),
      bearer !== undefined
        ? {
            fetch: noStandaloneSseFetch,
            requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
          }
        : { fetch: noStandaloneSseFetch },
    )

  const run = async (transport: StreamableHTTPClientTransport): Promise<T> => {
    // SDK 默认的 Ajv 校验器经 new Function 编译 schema,workerd 禁 eval——上游工具一旦声明
    // outputSchema,tools/list 阶段就会抛 "Code generation from strings disallowed"。
    // 换 SDK 自带的 @cfworker/json-schema 解释执行实现。
    const client = new Client(
      { name: 'tool-bridge', version: '0.0.0' },
      { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
    )
    await client.connect(transport)
    try {
      return await fn(client)
    } finally {
      await transport.terminateSession().catch(() => {})
      // 不调用 client.close():SDK close 会 abort transport,在 workerd 中会把已完成的一次性
      // HTTP 请求记成 "Network connection lost" 浮动异常。standalone SSE 已由 fetch wrapper 禁用,
      // list/call 的 POST 响应在 fn 返回前已完成,这里无需再 abort。
    }
  }

  try {
    return await run(makeTransport())
  } catch (err) {
    if (err instanceof StreamableHTTPError && err.code === 404) {
      // 会话失效:重建会话重试一次。
      return await run(makeTransport())
    }
    throw err
  }
}

/** 单一 choke point:把传输/协议错误归一为 TBError(已是 TBError 的原样抛出)。 */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (isTBError(err)) throw err
    if (err instanceof StreamableHTTPError && err.code !== undefined) {
      throw normalizeUpstreamError({ kind: 'http', status: err.code, message: err.message })
    }
    throw normalizeUpstreamError({
      kind: 'network',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * 构造 mcp Provider。`allowInsecure`(env `TB_ALLOW_INSECURE_HTTP=true`)放行 http:// 上游。
 * 构造即做 https 强制(Proto §4.2):非法 url → 抛 invalid_argument(在 guard 之外,快速失败)。
 */
export function createMcpProvider(
  config: McpConfig,
  secrets: SecretStoreImpl,
  opts: { allowInsecure: boolean },
): UpstreamProvider {
  const secErr = assertSecureUrl(config.url, opts.allowInsecure)
  if (secErr) throw secErr

  const bearer = (): Promise<string | undefined> =>
    config.authRef !== undefined ? secrets.resolve(config.authRef) : Promise.resolve(undefined)

  return {
    list: () =>
      guard(async () => {
        const b = await bearer()
        const { tools } = (await withSession(config.url, b, (c) => c.listTools())) as {
          tools: McpTool[]
        }
        return tools.map(toSpec)
      }),
    call: (name, args) =>
      guard(async () => {
        const b = await bearer()
        const res = await withSession(config.url, b, (c) => c.callTool({ name, arguments: args }))
        return toToolResult(res as { content?: unknown; isError?: boolean })
      }),
  }
}
