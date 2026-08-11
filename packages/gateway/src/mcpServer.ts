import {
  CallToolRequestSchema,
  type CallToolResult,
  CallToolResultSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type Tool,
  type ToolAnnotations,
  ToolSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'

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

function inputSchemaOf(raw: unknown): Tool['inputSchema'] {
  if (raw === undefined) return { type: 'object', properties: {} }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('MCP tool inputSchema must be a JSON Schema object')
  }
  const schema = raw as Record<string, unknown>
  if (schema.type !== undefined && schema.type !== 'object') {
    throw new Error('MCP tool inputSchema root type must be object')
  }
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
      throw new McpError(ErrorCode.InternalError, 'duplicate HTBP tool identity')
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
      const candidate = {
        name,
        description,
        inputSchema: inputSchemaOf(bridge.inputSchema),
        _meta: {
          'io.tool-bridge/path': bridge.sourcePath,
          'io.tool-bridge/command': bridge.toolName,
        },
        ...(annotations !== undefined ? { annotations } : {}),
      }
      const parsed = ToolSchema.safeParse(candidate)
      if (!parsed.success) {
        throw new McpError(
          ErrorCode.InternalError,
          `invalid tool metadata for '${bridge.sourcePath}/${bridge.toolName}'`,
        )
      }
      let validateInput: ProjectedTool['validateInput']
      try {
        validateInput = validator.getValidator(parsed.data.inputSchema)
      } catch {
        throw new McpError(
          ErrorCode.InternalError,
          `invalid input schema for '${bridge.sourcePath}/${bridge.toolName}'`,
        )
      }
      return { bridge, tool: parsed.data, validateInput }
    }),
  )
  const names = new Set<string>()
  for (const item of projected) {
    if (names.has(item.tool.name)) {
      throw new McpError(ErrorCode.InternalError, 'MCP tool name collision')
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

/** Handle one authenticated, stateless MCP Streamable HTTP request. */
export async function handleMcpRequest(
  request: Request,
  version: string,
  bridge: McpToolBridge,
): Promise<Response> {
  const validator = new CfWorkerJsonSchemaValidator()
  const server = new Server(
    { name: 'tool-bridge', version },
    {
      capabilities: { tools: {} },
      jsonSchemaValidator: validator,
    },
  )
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: (await projectTools(await bridge.list(), validator)).map(item => item.tool),
  }))
  server.setRequestHandler(CallToolRequestSchema, async (rpc) => {
    const projected = await projectTools(await bridge.list(), validator)
    const selected = projected.find(item => item.tool.name === rpc.params.name)
    if (selected === undefined) {
      throw new McpError(ErrorCode.InvalidParams, 'tool not found')
    }
    const args = rpc.params.arguments ?? {}
    const validation = selected.validateInput(args)
    if (!validation.valid) {
      throw new McpError(ErrorCode.InvalidParams, validation.errorMessage)
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
      throw new McpError(ErrorCode.InternalError, 'invalid tool result')
    }
    return parsed.data
  })

  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
  await server.connect(transport)
  return await transport.handleRequest(request)
}
