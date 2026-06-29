// MCP adapter: the whole MCP server is a single end-path leaf.
//
//   describe(node, [])  -> end-path: endpoint.tools lists every callable tool
//                          (the tree does NOT expand each tool into its own node)
//   call(node, [], in)  -> tools/call, selecting the tool via input.tool

import { AdapterContext, HelpPayload, McpNode, TBAdapter, ToolSpec } from '../types';
import { callMcpTool, listMcpTools, McpTool, resolveMcpServer } from '../mcp-client';
import { oneLine } from '../util';
import { resolveUpstreamTool, virtualizeTools } from '../virtualize';

export const mcpAdapter: TBAdapter<McpNode> = {
  kind: 'mcp',

  async describe(node, ctx, sub): Promise<HelpPayload> {
    if (sub.length > 0) {
      // An MCP server is an atomic leaf; there is no deeper resource path.
      throw new Error(`MCP node '${node.id}' is a leaf; '${sub.join('/')}' is not a sub-resource.`);
    }
    const server = resolveMcpServer(ctx.env, node);
    const upstream = (await listMcpTools(server)).map(toToolSpec);
    const { exposed } = virtualizeTools(node, upstream);
    const example = exposed.length > 0 ? { tool: exposed[0].name, arguments: {} } : { tool: '', arguments: {} };
    return {
      htbp: 'draft',
      kind: 'mcp',
      title: node.title,
      description: node.description,
      cachable: true,
      endpoint: {
        method: 'POST',
        // The request body selects a tool by (virtual) name and carries args.
        inputSchema: {
          type: 'object',
          properties: {
            tool: { type: 'string', enum: exposed.map((tool) => tool.name) },
            arguments: { type: 'object' },
          },
          required: ['tool'],
        },
        example,
        tools: exposed,
      },
    };
  },

  async call(node, ctx, sub, input): Promise<unknown> {
    if (sub.length > 0) {
      throw new Error(`MCP node '${node.id}' is a leaf; call it directly with {tool, arguments}.`);
    }
    const { tool, args } = parseCall(input);
    if (!tool) {
      throw new Error(`MCP call to '${node.id}' requires a 'tool' field in the request body.`);
    }
    const server = resolveMcpServer(ctx.env, node);
    const upstream = (await listMcpTools(server)).map(toToolSpec);
    // Map the client-facing virtual name back to the upstream tool name; this
    // also rejects hidden tools.
    const upstreamName = resolveUpstreamTool(node, upstream, tool);
    return callMcpTool(server, upstreamName, args);
  },
};

function toToolSpec(tool: McpTool): ToolSpec {
  return {
    name: tool.name,
    description: tool.description ? oneLine(tool.description) : undefined,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
  };
}

// Body form: {tool: string, arguments?: object}.
function parseCall(input: unknown): { tool?: string; args: unknown } {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const record = input as { tool?: unknown; arguments?: unknown };
    return {
      tool: typeof record.tool === 'string' ? record.tool : undefined,
      args: record.arguments ?? {},
    };
  }
  return { args: {} };
}
