/**
 * MCP server 面(HTBP 保留控制段 `/~mcp`)。
 *
 * **双 era**:按 `isLegacyRequest` 分流——2026-07-28(modern,无握手、协议版本与客户端
 * 能力走 `_meta` 信封)交给 `createMcpHandler`;2025 系(legacy,`initialize` 握手)沿用
 * 迁移前的 `WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })`。
 * 两条腿共用同一个 Server 工厂,每请求现造。网关本就无状态(不签发 `Mcp-Session-Id`),
 * 与新规范的无状态内核天然对齐;老 Agent 保留可连。分流理由见 handleMcpRequest。
 *
 * **缓存提示(SEP-2549)**:`tools/list` 结果携带 `ttlMs`/`cacheScope`。SDK 只在 modern
 * 编解码器上填充这两个字段,2025 响应的线上形状完全不变,故无需按 era 分叉。
 * `cacheScope` 恒为 `private`:入口按部署能力裁剪,每次请求仍独立鉴权。
 * 业务工具目录只通过 tb_search / tb_help 按需读取,不进入 tools/list。
 */

import {
  type CallToolResult,
  createMcpHandler,
  isLegacyRequest,
  ProtocolError,
  ProtocolErrorCode,
  Server,
  type Tool,
  type ToolAnnotations,
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/server'
import { CallToolResultSchema, ToolSchema } from '@modelcontextprotocol/core'
import { isTBError, type ToolResult, type ToolSpec } from '@tool-bridge/core'
import { ToolJsonSchemaValidator } from './jsonSchemaValidator'

/** Only the fixed gateway entry points are MCP tools; command paths stay in arguments. */
export type McpBridgeTool = ToolSpec

export interface McpToolBridge {
  call(tool: McpBridgeTool, args: Record<string, unknown>): Promise<ToolResult>
  list(): Promise<McpBridgeTool[]>
}

/** JSON Schema 2020-12 里取「单个子 schema」的关键字。 */
const SUBSCHEMA_KEYS = [
  'additionalProperties', 'contains', 'else', 'if', 'items', 'not',
  'propertyNames', 'then', 'unevaluatedItems', 'unevaluatedProperties',
] as const
/** 取「名称 → 子 schema 映射」的关键字。 */
const SUBSCHEMA_MAP_KEYS = [
  '$defs', 'definitions', 'dependentSchemas', 'patternProperties', 'properties',
] as const
/** 取「子 schema 数组」的关键字。 */
const SUBSCHEMA_LIST_KEYS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const

/** 嵌套上限:上游 schema 是不可信输入,防病态深度拖垮校验本身。 */
const MAX_SCHEMA_DEPTH = 32

/**
 * 递归断言 `value` 处处是合法 JSON Schema(2020-12 允许布尔 schema)。
 *
 * 存在的理由:v2 的 `ToolSchema` 把 `inputSchema.properties` 放宽成
 * `Record<string, JSONValue>`,`{ properties: { value: 'not-a-schema' } }` 能过 parse;
 * SDK 的 AJV adapter 默认关闭 meta-schema 校验。这里保留结构与深度边界,
 * 具体方言和关键字语义仍由官方 adapter 校验,不把畸形 schema 当成无约束输入。
 */
function assertSchemaShape(value: unknown, path: string, depth = 0): void {
  if (typeof value === 'boolean') return
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`not a JSON Schema at '${path}'`)
  }
  if (depth >= MAX_SCHEMA_DEPTH) throw new Error(`JSON Schema nested too deeply at '${path}'`)
  const schema = value as Record<string, unknown>
  for (const key of SUBSCHEMA_KEYS) {
    const sub = schema[key]
    // Older JSON Schema dialects use an array-valued items for tuples. The SDK
    // chooses the dialect and rejects this form for 2020-12 itself.
    if (key === 'items' && Array.isArray(sub)) {
      sub.forEach((item, i) => assertSchemaShape(item, `${path}/items/${i}`, depth + 1))
    } else if (sub !== undefined) assertSchemaShape(sub, `${path}/${key}`, depth + 1)
  }
  for (const key of SUBSCHEMA_MAP_KEYS) {
    const map = schema[key]
    if (map === undefined) continue
    if (map === null || typeof map !== 'object' || Array.isArray(map)) {
      throw new Error(`'${key}' must be an object of schemas at '${path}'`)
    }
    for (const [name, sub] of Object.entries(map)) {
      assertSchemaShape(sub, `${path}/${key}/${name}`, depth + 1)
    }
  }
  for (const key of SUBSCHEMA_LIST_KEYS) {
    const list = schema[key]
    if (list === undefined) continue
    if (!Array.isArray(list)) throw new Error(`'${key}' must be an array of schemas at '${path}'`)
    list.forEach((sub, i) => assertSchemaShape(sub, `${path}/${key}/${i}`, depth + 1))
  }
}

function inputSchemaOf(
  raw: unknown,
): Tool['inputSchema'] {
  if (raw === undefined) return { type: 'object', properties: {} }
  const source = raw
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('MCP tool inputSchema must be a JSON Schema object')
  }
  const schema = source as Record<string, unknown>
  if (schema.type !== undefined && schema.type !== 'object') {
    throw new Error('MCP tool inputSchema root type must be object')
  }
  assertSchemaShape(schema, 'inputSchema')
  return { ...schema, type: 'object' } as Tool['inputSchema']
}

function inputValidator(raw: unknown, path: string) {
  try {
    // The MCP SDK's Tool schema permits JSONValue properties; the shape check above
    // narrows them to JSON Schemas before passing them to its official AJV adapter.
    return new ToolJsonSchemaValidator().getValidator(
      inputSchemaOf(raw) as Parameters<ToolJsonSchemaValidator['getValidator']>[0],
    )
  } catch {
    throw new ProtocolError(ProtocolErrorCode.InternalError, `invalid input schema for '${path}'`)
  }
}

/** Use the existing SDK AJV adapter, compiling only the selected command's schema. */
export function validateMcpArguments(raw: unknown, args: Record<string, unknown>, path: string): void {
  const validate = inputValidator(raw, path)
  const result = validate(args)
  if (!result.valid) throw new ProtocolError(ProtocolErrorCode.InvalidParams, result.errorMessage)
}

function annotationsOf(tool: McpBridgeTool): ToolAnnotations | undefined {
  const annotations: ToolAnnotations = {}
  if (tool.effect === 'read') annotations.readOnlyHint = true
  if (tool.effect === 'write' || tool.effect === 'destructive') annotations.readOnlyHint = false
  if (tool.effect === 'destructive' || tool.confirm === true) annotations.destructiveHint = true
  return Object.keys(annotations).length > 0 ? annotations : undefined
}

interface ProjectedTool {
  bridge: McpBridgeTool
  tool: Tool
  validateInput: ReturnType<ToolJsonSchemaValidator['getValidator']>
}

function projectTools(source: McpBridgeTool[]): ProjectedTool[] {
  const names = new Set<string>()
  return source.map((bridge) => {
    if (names.has(bridge.name)) {
      throw new ProtocolError(ProtocolErrorCode.InternalError, 'MCP tool name collision')
    }
    names.add(bridge.name)
    const annotations = annotationsOf(bridge)
    const validateInput = inputValidator(bridge.inputSchema, bridge.name)
    const parsed = ToolSchema.safeParse({
      name: bridge.name,
      description: bridge.description,
      inputSchema: inputSchemaOf(bridge.inputSchema),
      ...(annotations === undefined ? {} : { annotations }),
    })
    if (!parsed.success) {
      throw new ProtocolError(ProtocolErrorCode.InternalError, `invalid tool metadata for '${bridge.name}'`)
    }
    return { bridge, tool: parsed.data, validateInput }
  }).sort((a, b) => a.tool.name.localeCompare(b.tool.name))
}

function contentOf(value: unknown): CallToolResult['content'] {
  if (Array.isArray(value)) {
    const parsed = CallToolResultSchema.safeParse({ content: value })
    if (parsed.success) return parsed.data.content
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)
  return [{ type: 'text', text }]
}

/** Fixed gateway tools are assembled per authenticated request, for both MCP eras. */
function buildMcpServer(version: string, bridge: McpToolBridge, listTtlMs: number): Server {
  const validator = new ToolJsonSchemaValidator()
  const server = new Server(
    { name: 'tool-bridge', version },
    {
      capabilities: { tools: {} },
      jsonSchemaValidator: validator,
      // SEP-2549:仅 modern 编解码器消费,2025 响应不受影响。private 见文件头说明。
      cacheHints: { 'tools/list': { ttlMs: listTtlMs, cacheScope: 'private' } },
    },
  )
  let projected: Promise<ProjectedTool[]> | undefined
  const tools = () => projected ??= bridge.list().then(projectTools)
  server.setRequestHandler('tools/list', async () => ({
    tools: (await tools()).map(item => item.tool),
  }))
  server.setRequestHandler('tools/call', async (rpc) => {
    const selected = (await tools()).find(item => item.tool.name === rpc.params.name)
    if (selected === undefined) {
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'tool not found')
    }
    const args = rpc.params.arguments ?? {}
    const validation = selected.validateInput(args)
    if (!validation.valid) {
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, validation.errorMessage)
    }
    let result: ToolResult
    try {
      result = await bridge.call(selected.bridge, args)
    } catch (error) {
      if (!isTBError(error)) throw error
      result = { content: error.toJSON(), isError: true }
    }
    const candidate = {
      content: contentOf(result.contentBlocks ?? result.content),
      ...(result.isError === true ? { isError: true } : {}),
      ...(result.structuredContent !== undefined
        ? { structuredContent: result.structuredContent }
        : result.content !== null
          && typeof result.content === 'object'
          && !Array.isArray(result.content)
          ? { structuredContent: result.content as Record<string, unknown> }
          : {}),
    }
    const parsed = CallToolResultSchema.safeParse(candidate)
    if (!parsed.success) {
      throw new ProtocolError(ProtocolErrorCode.InternalError, 'invalid tool result')
    }
    return parsed.data
  })
  return server
}

/**
 * 处理一次已认证的 MCP 请求(modern 与 legacy 双 era)。
 *
 * `listTtlMs` 是 `tools/list` 的缓存寿命提示(毫秒),由调用方按 toolCache 的 TTL 传入
 * ——网关自身的上游工具缓存就以该窗口供应清单,对外承诺同一窗口不引入新的陈旧度。
 * 传 0 即最保守语义(客户端不缓存)。
 *
 * **两条腿手工分流,不用 `legacy:'stateless'` 内建回退**:内建回退只给 legacy 腿传
 * `sessionIdGenerator: undefined`,拿不到 `enableJsonResponse`,于是 2025 响应会退化成
 * SSE 流——而 `responseMode:'json'` 只管 modern 腿。这既改变了老客户端看到的线上形态
 * (迁移前恒为单 JSON 体),又在 workerd 里留下必须被中止的悬挂流(实测:测试跑出 13 条
 * AbortError 未处理拒绝)。`isLegacyRequest` 跑的就是 `createMcpHandler` 自身的分类代码,
 * 故手接分流不会与内建判定分歧。
 *
 * 每请求现造:与迁移前每请求现造 Server 的开销同级,且把调用方身份牢牢绑在本次请求上
 * (bridge 闭包携带调用方 ctx),不留跨请求状态。
 */
export async function handleMcpRequest(
  request: Request,
  version: string,
  bridge: McpToolBridge,
  listTtlMs: number,
): Promise<Response> {
  if (await isLegacyRequest(request)) {
    // 2025 系:完全沿用迁移前的形态——单 JSON 响应,无会话,不开 SSE。
    const server = buildMcpServer(version, bridge, listTtlMs)
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
    await server.connect(transport)
    return await transport.handleRequest(request)
  }
  const handler = createMcpHandler(() => buildMcpServer(version, bridge, listTtlMs), {
    // 不消费服务端主动消息流,固定单 JSON 响应;keepAlive 无流可保活,关掉免起定时器。
    responseMode: 'json',
    keepAliveMs: 0,
    // legacy 已在上面接走,这条腿只服务 modern;误判到此即响亮报错,不静默降级。
    legacy: 'reject',
  })
  return await handler.fetch(request)
}
