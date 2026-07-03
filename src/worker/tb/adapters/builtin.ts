// Builtin adapter: a whole-leaf node whose tools are implemented by the HOST
// worker, not by tool-bridge. The adapter owns the tree/help/routing only; the
// actual work runs in a host-provided handler function injected through
// `AdapterContext.builtinHandlers`.
//
//   describe(node, [])         -> directory: resources list the builtin tools
//   describe(node, [tool])     -> end-path: that tool's schema + call semantics
//   call(node, [tool], input)  -> dispatch to the host handler named by config
//
// This mirrors the MCP adapter's "server is a directory of tools, each tool is
// an end-path leaf" shape, so builtin nodes crawl and render exactly like MCP
// nodes. The difference is purely where the implementation lives: MCP forwards
// to an upstream server, builtin calls a locally registered function.

import {
  AdapterContext,
  BuiltinNode,
  BuiltinToolConfig,
  HelpPayload,
  ResourceRef,
  TBAdapter,
  ToolSpec,
} from '../types';
import { oneLine } from '../util';

export const builtinAdapter: TBAdapter<BuiltinNode> = {
  kind: 'builtin',

  async describe(node, _ctx, sub): Promise<HelpPayload> {
    // Node level: list the tools as the next layer (brief: name + description).
    if (sub.length === 0) {
      return {
        htbp: 'draft',
        kind: 'builtin',
        title: node.title,
        description: node.description,
        cachable: true,
        resources: node.tools.map(toResource),
      };
    }

    // Tool level (end-path): the selected tool's full detail + call semantics.
    const tool = findTool(node, sub[0]);
    return {
      htbp: 'draft',
      kind: 'builtin',
      title: tool.name,
      description: tool.description,
      cachable: true,
      endpoint: {
        method: 'POST',
        inputSchema: tool.inputSchema ?? { type: 'object' },
        outputSchema: tool.outputSchema,
        example: {},
        effect: tool.effect,
        scope: tool.scope,
        confirm: tool.confirm,
      },
    };
  },

  async call(node, ctx, sub, input): Promise<unknown> {
    if (sub.length === 0) {
      throw new Error(`Builtin node '${node.id}' requires a tool: call POST {path}/{tool}.`);
    }
    const tool = findTool(node, sub[0]);
    const registry = ctx.builtinHandlers ?? {};
    const handler = registry[tool.handler];
    if (!handler) {
      throw new Error(
        `Builtin tool '${tool.name}' references handler '${tool.handler}', which the host did not register.`
      );
    }
    return handler(extractArguments(input), ctx);
  },
};

// The MCP whole-leaf help renders one cmd per tool with its semantics, so carry
// the semantic fields onto every listed ToolSpec too (both the node-level list
// and, via describe([tool]), the end-path). Here we surface them on the brief
// list entry's description path indirectly; the full ToolSpec is built for the
// embedded-tools help form below.
function toResource(tool: BuiltinToolConfig): ResourceRef {
  return {
    name: tool.name,
    path: `./${encodeURIComponent(tool.name)}`,
    description: tool.description ? oneLine(tool.description) : undefined,
  };
}

// Build the embedded ToolSpec[] (with semantics) for an MCP-style whole-leaf
// help payload. Exposed so a host that wants to render the builtin node as a
// single end-path with all tools inline (like the MCP leaf) can reuse it.
export function builtinToolSpecs(node: BuiltinNode): ToolSpec[] {
  return node.tools.map((tool) => ({
    name: tool.name,
    description: tool.description ? oneLine(tool.description) : undefined,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    effect: tool.effect,
    scope: tool.scope,
    confirm: tool.confirm,
  }));
}

function findTool(node: BuiltinNode, name: string): BuiltinToolConfig {
  const tool = node.tools.find((item) => item.name === name);
  if (!tool) {
    throw new Error(`Tool '${name}' is not exposed by builtin node '${node.id}'.`);
  }
  return tool;
}

// The request body IS the tool arguments. Tolerate a {arguments:{...}} wrapper,
// matching the MCP adapter's call convention.
function extractArguments(input: unknown): unknown {
  if (input && typeof input === 'object' && !Array.isArray(input) && 'arguments' in input) {
    return (input as { arguments?: unknown }).arguments ?? {};
  }
  return input ?? {};
}

// Reference echo handler: returns whatever arguments it was called with. Hosts
// register this (or their own) into AdapterContext.builtinHandlers. Kept here as
// a ready-to-use default and as the test vehicle for the builtin call path.
export const echoHandler = (input: unknown): unknown => ({ echo: input });
