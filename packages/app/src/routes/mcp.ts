import {
  deviceOperationStateSchema,
  toolSearchOptionsSchema,
} from '@tool-bridge/core/protocol'
/** Fixed MCP entry points. Business tools are discovered and invoked by HTBP path. */
import { MAX_TREE_DEPTH, OperationRegistry, TBError, type ToolResult } from '@tool-bridge/core'
import { z } from 'zod/v4'
import type { RouteEnv } from './env'
import { invokeMcpTarget, mcpPath, mcpRequest, mcpResponse } from '../mcpInvoke'
import { type AppContext, type TbHono, TOOL_CACHE_TTL_DEFAULT } from '../deps'
import { handleMcpRequest, type McpToolBridge } from '../mcpServer'
import { runHandler } from '../responses'

const callInput = z.strictObject({
  path: z.string().min(1).describe('Complete command path returned by tb_help or tb_search; the same path as tb call.'),
  args: z.record(z.string(), z.unknown()).optional().describe('The command arguments object. Defaults to {}.'),
  delivery: z.enum(['realtime', 'mailbox', 'fallback']).optional(),
  ttlSeconds: z.number().int().positive().optional(),
  idempotencyKey: z.string().min(1).optional(),
})

const operationIdentity = {
  deviceId: z.string().min(1),
  operationId: z.string().min(1),
}
const deviceOperationInput = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('list'),
    deviceId: z.string().min(1),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().positive().optional(),
    states: z.array(deviceOperationStateSchema).min(1).optional(),
  }),
  z.strictObject({ action: z.literal('get'), ...operationIdentity }),
  z.strictObject({ action: z.literal('cancel'), ...operationIdentity }),
])

function mcpBridgeFor(c: AppContext, env: RouteEnv, app: TbHono): McpToolBridge {
  const operations = new OperationRegistry<undefined>()
  const request = async (path: string, body?: unknown): Promise<ToolResult> =>
    mcpResponse(await mcpRequest(c, app, path, body))

  if (env.globalSearchCapabilities().includes('search')) {
    operations.register('tb_search', {
      description: 'Search visible Tool Bridge tools, compact by default. Use tb_help on a selected command path for its full schema, then tb_call. Use detail="full" to include schemas in this response.',
      effect: 'read',
      inputSchema: toolSearchOptionsSchema.extend({ query: z.string().trim().min(1) }),
    }, async ({ query, ...opts }) => request('/~search', { query, opts }))
  }
  operations.register('tb_help', {
    description: 'Describe a visible node or complete command path, including input schema, permissions, effects and device delivery. Root help browses available nodes. Equivalent to tb help.',
    effect: 'read',
    inputSchema: z.strictObject({
      path: z.string().optional(),
      tool: z.string().min(1).regex(/^[^/]+$/).optional(),
      format: z.enum(['json', 'markdown', 'dsl']).optional(),
      schemas: z.boolean().optional(),
    }),
  }, async ({ path = '', tool, format = 'json', schemas }) => {
    const prefix = mcpPath(path, true)
    if (tool !== undefined && prefix === '') {
      throw new TBError('invalid_argument', 'tool detail requires a node path')
    }
    const command = tool === undefined ? prefix : `${prefix}/${mcpPath(tool)}`
    const response = await mcpRequest(c, app, `/${command ? `${command}/` : ''}~help${schemas ? '?schemas=1' : ''}`, undefined, {
      accept: format === 'json' ? 'application/json' : format === 'dsl' ? 'text/plain' : 'text/markdown',
    })
    return mcpResponse(response)
  })
  operations.register('tb_list_nodes', {
    description: 'Browse visible Tool Bridge nodes at a bounded depth. Use tb_help to inspect one node or command. Equivalent to tb ls / tb tree; works without search.',
    effect: 'read',
    inputSchema: z.strictObject({
      path: z.string().optional(),
      depth: z.number().int().min(0).max(MAX_TREE_DEPTH).optional(),
    }),
  }, async ({ path = '', depth = 1 }) => {
    const prefix = mcpPath(path, true)
    return request(`/${prefix ? `${prefix}/` : ''}~tree?depth=${depth}`)
  })
  operations.register('tb_call', {
    description: 'Invoke one Tool Bridge command by its complete path and arguments, equivalent to tb call. Discover unknown commands with tb_search / tb_help; check the target effect and confirm before writes. Supports tools, Context, Skill and system commands. Device delivery may return a mailbox operation; inspect it with tb_device_operations. Never retry a write merely because the result is unknown.',
    effect: 'destructive',
    confirm: true,
    inputSchema: callInput,
  }, async input => invokeMcpTarget(c, env, app, input))
  operations.register('tb_device_operations', {
    description: 'List, inspect or cancel device mailbox operations, equivalent to tb device op. Use the original deviceId and operationId. Cancellation of a claimed operation is cooperative; result_unknown and expired with executionMayHaveOccurred do not establish that a retry is safe.',
    effect: 'destructive',
    confirm: true,
    inputSchema: deviceOperationInput,
  }, async (input) => {
    const { action, deviceId } = input
    const body = action === 'list'
      ? { deviceId, opts: { cursor: input.cursor, limit: input.limit, states: input.states } }
      : { deviceId, operationId: input.operationId }
    return request(`/~device/operations/${action}`, body)
  })

  return {
    list: async () => operations.list(),
    call: async (tool, args) => operations.call(tool.name, args, undefined),
  }
}

export function registerMcpRoute(app: TbHono, env: RouteEnv): void {
  app.all('/~mcp', c =>
    runHandler(async () => handleMcpRequest(
      c.req.raw,
      env.deps.version,
      mcpBridgeFor(c, env, app),
      (env.deps.toolCacheTtlSec ?? TOOL_CACHE_TTL_DEFAULT) * 1000,
    )))
}
