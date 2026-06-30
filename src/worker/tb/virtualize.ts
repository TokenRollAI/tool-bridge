// Tools Management virtualization.
//
// Given a node's upstream tools and its Tools Management config (namespace +
// per-tool overrides), produce the externally exposed (virtual) tool list and a
// reverse map from virtual name back to the upstream name. Hidden tools are
// dropped from the exposed list and are not callable.

import { McpNode, ToolSpec } from './types';
import { NotFoundError } from './util';

export interface Virtualized {
  // Tools as exposed to clients, with virtual names/descriptions applied.
  exposed: ToolSpec[];
  // virtual name -> upstream tool name (only for non-hidden tools).
  reverse: Map<string, string>;
}

export function virtualizeTools(node: McpNode, upstream: ToolSpec[]): Virtualized {
  const overrides = node.toolOverrides ?? {};
  const exposed: ToolSpec[] = [];
  const reverse = new Map<string, string>();

  for (const tool of upstream) {
    const override = overrides[tool.name];
    if (override?.hide) {
      continue;
    }
    const virtualName = applyNamespace(node.namespace, override?.rename ?? tool.name);
    reverse.set(virtualName, tool.name);
    exposed.push({
      name: virtualName,
      description: override?.description ?? tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
    });
  }

  return { exposed, reverse };
}

// Resolve a client-supplied virtual tool name to its upstream name. Throws if
// the name is unknown (e.g. hidden or never existed).
export function resolveUpstreamTool(node: McpNode, upstream: ToolSpec[], virtualName: string): string {
  const { reverse } = virtualizeTools(node, upstream);
  const upstreamName = reverse.get(virtualName);
  if (!upstreamName) {
    throw new NotFoundError(`Tool '${virtualName}' is not exposed by node '${node.id}'.`);
  }
  return upstreamName;
}

function applyNamespace(namespace: string | undefined, name: string): string {
  return namespace ? `${namespace}__${name}` : name;
}
