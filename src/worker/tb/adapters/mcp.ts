// MCP adapter: maps an upstream MCP server's tools into the TB help model.
//
//   describe(node, [])          -> mid-path: list tools as relative resources
//   describe(node, [toolName])  -> end-path: tool's input schema as an endpoint
//   call(node, [toolName], in)  -> tools/call

import { AdapterContext, HelpPayload, McpNode, ResourceRef, TBAdapter } from '../types';
import { callMcpTool, listMcpTools, McpTool, resolveMcpServer } from '../mcp-client';
import { oneLine } from '../util';

export const mcpAdapter: TBAdapter<McpNode> = {
  kind: 'mcp',

  async describe(node, ctx, sub): Promise<HelpPayload> {
    const server = resolveMcpServer(ctx.env, node);
    const tools = await listMcpTools(server);

    if (sub.length === 0) {
      return {
        htbp: 'draft',
        kind: 'mcp',
        title: node.title,
        description: node.description,
        cachable: true,
        resources: tools.map(toResource),
      };
    }

    const toolName = sub[0];
    const tool = tools.find((item) => item.name === toolName);
    if (!tool) {
      throw new Error(`Tool '${toolName}' not found on server '${node.id}'.`);
    }
    return {
      htbp: 'draft',
      kind: 'mcp',
      title: tool.name,
      description: tool.description,
      cachable: true,
      endpoint: {
        method: 'POST',
        inputSchema: tool.inputSchema ?? {},
        outputSchema: tool.outputSchema,
        example: { arguments: {} },
      },
    };
  },

  async call(node, ctx, sub, input): Promise<unknown> {
    if (sub.length === 0) {
      throw new Error(`MCP node '${node.id}' requires a tool name to call.`);
    }
    const server = resolveMcpServer(ctx.env, node);
    const args = extractArguments(input);
    return callMcpTool(server, sub[0], args);
  },
};

function toResource(tool: McpTool): ResourceRef {
  return {
    name: tool.name,
    path: `./${encodeURIComponent(tool.name)}`,
    description: tool.description ? oneLine(tool.description) : undefined,
  };
}

// Accept either {arguments: {...}} or a bare argument object.
function extractArguments(input: unknown): unknown {
  if (input && typeof input === 'object' && !Array.isArray(input) && 'arguments' in input) {
    return (input as { arguments?: unknown }).arguments ?? {};
  }
  return input ?? {};
}
