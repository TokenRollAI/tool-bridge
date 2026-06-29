// MCP adapter: the MCP server is a directory of tools; each tool is an end-path
// leaf.
//
//   describe(node, [])         -> directory: resources list the tools (name +
//                                 description + relative path), no schemas
//   describe(node, [tool])     -> end-path: that tool's full inputSchema
//   call(node, [tool], args)   -> tools/call with `args` as the arguments

import { AdapterContext, HelpPayload, McpNode, ResourceRef, TBAdapter, ToolSpec } from '../types';
import { callMcpTool, listMcpTools, McpTool, resolveMcpServer } from '../mcp-client';
import { oneLine } from '../util';
import { resolveUpstreamTool, virtualizeTools } from '../virtualize';

export const mcpAdapter: TBAdapter<McpNode> = {
  kind: 'mcp',

  async describe(node, ctx, sub): Promise<HelpPayload> {
    const server = resolveMcpServer(ctx.env, node);
    const upstream = (await listMcpTools(server)).map(toToolSpec);
    const { exposed } = virtualizeTools(node, upstream);

    // MCP level: list the tools as the next layer (brief: name + description).
    if (sub.length === 0) {
      return {
        htbp: 'draft',
        kind: 'mcp',
        title: node.title,
        description: node.description,
        cachable: true,
        resources: exposed.map(toResource),
      };
    }

    // Tool level (end-path): the selected tool's full detail.
    const toolName = sub[0];
    const tool = exposed.find((item) => item.name === toolName);
    if (!tool) {
      throw new Error(`Tool '${toolName}' is not exposed by node '${node.id}'.`);
    }
    return {
      htbp: 'draft',
      kind: 'mcp',
      title: tool.name,
      description: tool.description,
      cachable: true,
      endpoint: {
        method: 'POST',
        inputSchema: tool.inputSchema ?? { type: 'object' },
        outputSchema: tool.outputSchema,
        example: {},
      },
    };
  },

  async call(node, ctx, sub, input): Promise<unknown> {
    if (sub.length === 0) {
      throw new Error(`MCP node '${node.id}' requires a tool: call POST {path}/{tool}.`);
    }
    const server = resolveMcpServer(ctx.env, node);
    const upstream = (await listMcpTools(server)).map(toToolSpec);
    // Map the client-facing (virtual) tool name in the path back to the upstream
    // name; this also rejects hidden tools.
    const upstreamName = resolveUpstreamTool(node, upstream, sub[0]);
    return callMcpTool(server, upstreamName, extractArguments(input));
  },
};

function toResource(tool: ToolSpec): ResourceRef {
  return {
    name: tool.name,
    path: `./${encodeURIComponent(tool.name)}`,
    description: tool.description,
  };
}

function toToolSpec(tool: McpTool): ToolSpec {
  return {
    name: tool.name,
    description: tool.description ? oneLine(tool.description) : undefined,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
  };
}

// The request body IS the tool arguments. Tolerate a {arguments:{...}} wrapper.
function extractArguments(input: unknown): unknown {
  if (input && typeof input === 'object' && !Array.isArray(input) && 'arguments' in input) {
    return (input as { arguments?: unknown }).arguments ?? {};
  }
  return input ?? {};
}
