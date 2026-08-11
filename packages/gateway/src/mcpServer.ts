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
 * `cacheScope` 恒为 `private`:本网关的工具清单经调用方 scope 过滤(见 tbApp 的
 * Authorizer.Check),对共享中间层可缓存等同于跨身份泄露目录。
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
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker'
import { CallToolResultSchema, ToolSchema } from '@modelcontextprotocol/core'

export interface McpBridgeTool {
  confirm?: boolean
  description?: string
  effect?: string
  identity: string
  inputSchema?: unknown
  invokePath: string
  invokeWithEnvelope: boolean
  mcpName?: string
  operation?: 'help' | 'listNodes' | 'search'
  providerBacked?: boolean
  sourcePath: string
  toolName: string
}

export interface McpToolBridge {
  call(tool: McpBridgeTool, args: Record<string, unknown>): Promise<{
    content: unknown
    isError?: boolean
    structuredContent?: Record<string, unknown>
  }>
  list(): Promise<McpBridgeTool[]>
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Length-unambiguous identity for an HTBP invocation tuple. */
export function mcpToolIdentity(
  invokePath: string,
  toolName: string,
  invokeWithEnvelope: boolean,
): string {
  return JSON.stringify([invokePath, toolName, invokeWithEnvelope ? 'envelope' : 'flat'])
}

/** MCP-safe encoding; long identities retain a readable prefix plus collision-resistant SHA-256. */
export async function mcpToolName(identity: string): Promise<string> {
  const encoded = [...new TextEncoder().encode(identity)]
    .map((byte) => {
      const char = String.fromCharCode(byte)
      if (/[A-Za-z0-9.-]/.test(char)) return char
      if (char === '_') return '__'
      return `_${byte.toString(16).padStart(2, '0')}`
    })
    .join('')
  const prefixed = `tb_${encoded}`
  if (prefixed.length <= 128) return prefixed

  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity)))
  return `tb_${encoded.slice(0, 60)}_${hex(digest)}`
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
 * cfworker 编译时也不报错,反而把那条属性当作无约束——即 `validateInput` 对它静默放行。
 * 两道防线同时失效会让畸形上游 schema 变成调用路径上的 fail-open,故在投影处显式关死。
 */
function assertSchemaShape(value: unknown, path: string, depth = 0): void {
  if (typeof value === 'boolean') return
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`not a JSON Schema at '${path}'`)
  }
  if (depth >= MAX_SCHEMA_DEPTH) throw new Error(`JSON Schema nested too deeply at '${path}'`)
  const schema = value as Record<string, unknown>
  for (const key of SUBSCHEMA_KEYS) {
    if (schema[key] !== undefined) assertSchemaShape(schema[key], `${path}/${key}`, depth + 1)
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

function inputSchemaOf(raw: unknown): Tool['inputSchema'] {
  if (raw === undefined) return { type: 'object', properties: {} }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('MCP tool inputSchema must be a JSON Schema object')
  }
  const schema = raw as Record<string, unknown>
  if (schema.type !== undefined && schema.type !== 'object') {
    throw new Error('MCP tool inputSchema root type must be object')
  }
  assertSchemaShape(schema, 'inputSchema')
  return { ...schema, type: 'object' } as Tool['inputSchema']
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
  validateInput: ReturnType<CfWorkerJsonSchemaValidator['getValidator']>
}

async function projectTools(
  source: McpBridgeTool[],
  validator: CfWorkerJsonSchemaValidator,
): Promise<ProjectedTool[]> {
  const unique = new Map<string, McpBridgeTool>()
  for (const tool of source) {
    if (unique.has(tool.identity)) {
      throw new ProtocolError(ProtocolErrorCode.InternalError, 'duplicate HTBP tool identity')
    }
    unique.set(tool.identity, tool)
  }
  const projected = await Promise.all(
    [...unique.values()].map(async (bridge) => {
      const name = bridge.mcpName ?? await mcpToolName(bridge.identity)
      const annotations = annotationsOf(bridge)
      const description = bridge.description === undefined
        ? `HTBP ${bridge.invokePath}`
        : `${bridge.description}\n\nHTBP ${bridge.invokePath}`
      let inputSchema: Tool['inputSchema']
      try {
        inputSchema = inputSchemaOf(bridge.inputSchema)
      } catch {
        throw new ProtocolError(ProtocolErrorCode.InternalError,
          `invalid input schema for '${bridge.sourcePath}/${bridge.toolName}'`,
        )
      }
      const candidate = {
        name,
        description,
        inputSchema,
        _meta: {
          'io.tool-bridge/path': bridge.sourcePath,
          'io.tool-bridge/command': bridge.toolName,
        },
        ...(annotations !== undefined ? { annotations } : {}),
      }
      const parsed = ToolSchema.safeParse(candidate)
      if (!parsed.success) {
        throw new ProtocolError(ProtocolErrorCode.InternalError,
          `invalid tool metadata for '${bridge.sourcePath}/${bridge.toolName}'`,
        )
      }
      let validateInput: ProjectedTool['validateInput']
      try {
        // ToolSchema 把 inputSchema.properties 定为 Record<string, JSONValue>(含 null),
        // 而 getValidator 要 Record<string, JSONSchema>——SDK 自身两侧类型不咬合。运行时
        // 无碍(非法 schema 由 getValidator 抛出,下面 catch 兜住),故在此单点收窄。
        validateInput = validator.getValidator(
          parsed.data.inputSchema as Parameters<CfWorkerJsonSchemaValidator['getValidator']>[0],
        )
      } catch {
        throw new ProtocolError(ProtocolErrorCode.InternalError,
          `invalid input schema for '${bridge.sourcePath}/${bridge.toolName}'`,
        )
      }
      return { bridge, tool: parsed.data, validateInput }
    }),
  )
  const names = new Set<string>()
  for (const item of projected) {
    if (names.has(item.tool.name)) {
      throw new ProtocolError(ProtocolErrorCode.InternalError, 'MCP tool name collision')
    }
    names.add(item.tool.name)
  }
  return projected.sort((a, b) => a.tool.name.localeCompare(b.tool.name))
}

function contentOf(value: unknown): CallToolResult['content'] {
  if (Array.isArray(value)) {
    const parsed = CallToolResultSchema.safeParse({ content: value })
    if (parsed.success) return parsed.data.content
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)
  return [{ type: 'text', text }]
}

/**
 * 造一个只服务本次请求的 Server。工厂形态是 `createMcpHandler` 的要求:modern 与
 * legacy 两条腿各自取一个新实例,互不共享状态。
 *
 * `Server`(低阶 API)在 v2 标了 deprecated,推荐 `McpServer`——但那套是围绕
 * `registerTool` 的静态注册设计的,而本网关的工具集是每请求从 HTBP 树按调用方权限
 * 现算的(projectTools),属文档所称的 advanced use case,故继续用低阶 API。
 */
function buildMcpServer(version: string, bridge: McpToolBridge, listTtlMs: number): Server {
  const validator = new CfWorkerJsonSchemaValidator()
  const server = new Server(
    { name: 'tool-bridge', version },
    {
      capabilities: { tools: {} },
      jsonSchemaValidator: validator,
      // SEP-2549:仅 modern 编解码器消费,2025 响应不受影响。private 见文件头说明。
      cacheHints: { 'tools/list': { ttlMs: listTtlMs, cacheScope: 'private' } },
    },
  )
  server.setRequestHandler('tools/list', async () => ({
    tools: (await projectTools(await bridge.list(), validator)).map(item => item.tool),
  }))
  server.setRequestHandler('tools/call', async (rpc) => {
    const projected = await projectTools(await bridge.list(), validator)
    const selected = projected.find(item => item.tool.name === rpc.params.name)
    if (selected === undefined) {
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'tool not found')
    }
    const args = rpc.params.arguments ?? {}
    const validation = selected.validateInput(args)
    if (!validation.valid) {
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, validation.errorMessage)
    }
    const result = await bridge.call(selected.bridge, args)
    const candidate = {
      content: contentOf(result.content),
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
