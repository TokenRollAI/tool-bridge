// Configuration tree: parse MCP_SERVERS_JSON into an in-memory TreeNode tree,
// resolve URL path segments to nodes, and materialize per-node headers.
//
// Backward compatibility: the legacy flat format (an object or array of MCP
// server configs) is auto-wrapped as the children of a synthetic root
// directory, so existing deployments need no config change.

import {
  AppEnv,
  BuiltinNode,
  BuiltinToolConfig,
  DirectoryNode,
  HttpEndpointConfig,
  HttpNode,
  McpNode,
  MountNode,
  RemoteNode,
  ToolEffect,
  ToolOverride,
  TreeNode,
} from './types';
import { arrayOfStrings, isRecord, recordOfStrings, stringField } from './util';

export const TREE_PREFIX = '/htbp';

export function parseTree(env: AppEnv): DirectoryNode {
  return parseTreeFromJson(env.MCP_SERVERS_JSON || '{}');
}

// Parse a tree config JSON string into a normalized, parent-linked DirectoryNode.
// Shared by the global env tree (parseTree) and per-tenant configs loaded from KV,
// so both go through the exact same validation + normalization.
export function parseTreeFromJson(raw: string): DirectoryNode {
  const parsed = JSON.parse(raw || '{}') as unknown;

  // Nested tree form: an object carrying `type`/`children`.
  if (isRecord(parsed) && (parsed.type === 'directory' || Array.isArray(parsed.children))) {
    const node = normalizeNode({ id: 'root', ...parsed }, 'root');
    if (node.kind !== 'directory') {
      throw new Error('Root tree node must be a directory.');
    }
    linkParents(node);
    return node;
  }

  // Legacy flat form: wrap configured MCP servers as children of a root dir.
  const root: DirectoryNode = {
    kind: 'directory',
    id: 'root',
    title: 'Tool Bridge',
    children: parseLegacyServers(parsed),
  };
  linkParents(root);
  return root;
}

function parseLegacyServers(parsed: unknown): TreeNode[] {
  const entries: McpNode[] = [];
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      entries.push(normalizeMcpNode(item));
    }
    return entries;
  }
  if (isRecord(parsed)) {
    for (const [id, item] of Object.entries(parsed)) {
      entries.push(normalizeMcpNode({ id, ...(isRecord(item) ? item : {}) }));
    }
  }
  return entries;
}

function normalizeNode(value: unknown, idPath: string): TreeNode {
  if (!isRecord(value)) {
    throw new Error(`Tree node at '${idPath}' must be an object.`);
  }
  const type = stringField(value, 'type') || (value.children ? 'directory' : 'mcp');
  switch (type) {
    case 'directory':
      return normalizeDirectoryNode(value, idPath);
    case 'mcp':
      return normalizeMcpNode(value);
    case 'http':
      return normalizeHttpNode(value, idPath);
    case 'remote':
      return normalizeRemoteNode(value, idPath);
    case 'mount':
      return normalizeMountNode(value, idPath);
    case 'builtin':
      return normalizeBuiltinNode(value, idPath);
    default:
      throw new Error(`Unknown tree node type '${type}' at '${idPath}'.`);
  }
}

function normalizeDirectoryNode(value: Record<string, unknown>, idPath: string): DirectoryNode {
  const id = stringField(value, 'id') || stringField(value, 'name');
  if (!id) {
    throw new Error(`Directory node at '${idPath}' is missing id/name.`);
  }
  const rawChildren = Array.isArray(value.children) ? value.children : [];
  const children = rawChildren.map((child, index) => normalizeNode(child, `${idPath}/${id}[${index}]`));
  assertUniqueSiblingIds(children, `${idPath}/${id}`);
  return {
    kind: 'directory',
    id,
    title: stringField(value, 'title') || stringField(value, 'name') || id,
    summary: stringField(value, 'summary') || stringField(value, 'description'),
    children,
  };
}

// Shared MCP normalization, used by both the nested and legacy flat formats.
// Mirrors the original normalizeServerConfig validation (endpoint aliasing,
// allowedTools snake/camel, header parsing).
function normalizeMcpNode(value: unknown): McpNode {
  if (!isRecord(value)) {
    throw new Error('MCP server config must be an object.');
  }
  const id = stringField(value, 'id') || stringField(value, 'name');
  const endpoint = stringField(value, 'endpoint') || stringField(value, 'url') || stringField(value, 'baseUrl');
  if (!id) {
    throw new Error('MCP server config is missing id/name.');
  }
  if (!endpoint) {
    throw new Error(`MCP server '${id}' is missing endpoint.`);
  }
  return {
    kind: 'mcp',
    id,
    title: stringField(value, 'name') || id,
    endpoint,
    description: stringField(value, 'description'),
    headers: recordOfStrings(value.headers),
    allowedTools: arrayOfStrings(value.allowedTools) ?? arrayOfStrings(value.allowed_tools),
    namespace: stringField(value, 'namespace'),
    toolOverrides: parseToolOverrides(value.toolOverrides ?? value.tool_overrides),
  };
}

function parseToolOverrides(value: unknown): Record<string, ToolOverride> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const result: Record<string, ToolOverride> = {};
  for (const [toolName, raw] of Object.entries(value)) {
    if (!isRecord(raw)) {
      continue;
    }
    result[toolName] = {
      hide: raw.hide === true,
      rename: stringField(raw, 'rename'),
      description: stringField(raw, 'description'),
    };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeHttpNode(value: Record<string, unknown>, idPath: string): HttpNode {
  const id = stringField(value, 'id') || stringField(value, 'name');
  if (!id) {
    throw new Error(`HTTP node at '${idPath}' is missing id/name.`);
  }
  const rawEndpoints = Array.isArray(value.endpoints) ? value.endpoints : [];
  const endpoints = rawEndpoints.map((item, index) => normalizeHttpEndpoint(item, `${idPath}/${id}[${index}]`));
  if (endpoints.length === 0) {
    throw new Error(`HTTP node '${id}' must declare at least one endpoint.`);
  }
  assertUniqueSiblingIds(
    endpoints.map((e) => ({ id: e.name })),
    `${idPath}/${id}`
  );
  return {
    kind: 'http',
    id,
    title: stringField(value, 'title') || stringField(value, 'name') || id,
    summary: stringField(value, 'summary') || stringField(value, 'description'),
    endpoints,
  };
}

function normalizeHttpEndpoint(value: unknown, idPath: string): HttpEndpointConfig {
  if (!isRecord(value)) {
    throw new Error(`HTTP endpoint at '${idPath}' must be an object.`);
  }
  const name = stringField(value, 'name');
  const method = stringField(value, 'method');
  const url = stringField(value, 'url');
  if (!name) {
    throw new Error(`HTTP endpoint at '${idPath}' is missing name.`);
  }
  if (!method) {
    throw new Error(`HTTP endpoint '${name}' is missing method.`);
  }
  if (!url) {
    throw new Error(`HTTP endpoint '${name}' is missing url.`);
  }
  return {
    name,
    method: method.toUpperCase(),
    url,
    description: stringField(value, 'description'),
    inputSchema: value.inputSchema,
    outputSchema: value.outputSchema,
    example: value.example,
    headers: recordOfStrings(value.headers),
    effect: parseToolEffect(value.effect),
    scope: stringField(value, 'scope'),
    confirm: value.confirm === true ? true : undefined,
  };
}

function normalizeRemoteNode(value: Record<string, unknown>, idPath: string): RemoteNode {
  const id = stringField(value, 'id') || stringField(value, 'name');
  if (!id) {
    throw new Error(`Remote node at '${idPath}' is missing id/name.`);
  }
  const helpUrl = stringField(value, 'helpUrl') || stringField(value, 'help_url') || stringField(value, 'url');
  if (!helpUrl) {
    throw new Error(`Remote node '${id}' is missing helpUrl.`);
  }
  return {
    kind: 'remote',
    id,
    title: stringField(value, 'title') || stringField(value, 'name') || id,
    summary: stringField(value, 'summary') || stringField(value, 'description'),
    helpUrl,
    headers: recordOfStrings(value.headers),
  };
}

function normalizeMountNode(value: Record<string, unknown>, idPath: string): MountNode {
  const id = stringField(value, 'id') || stringField(value, 'name');
  if (!id) {
    throw new Error(`Mount node at '${idPath}' is missing id/name.`);
  }
  const bucket = stringField(value, 'bucket') || stringField(value, 'binding');
  if (!bucket) {
    throw new Error(`Mount node '${id}' is missing bucket binding name.`);
  }
  return {
    kind: 'mount',
    id,
    title: stringField(value, 'title') || stringField(value, 'name') || id,
    summary: stringField(value, 'summary') || stringField(value, 'description'),
    bucket,
    prefix: stringField(value, 'prefix'),
    description: stringField(value, 'description'),
  };
}

function normalizeBuiltinNode(value: Record<string, unknown>, idPath: string): BuiltinNode {
  const id = stringField(value, 'id') || stringField(value, 'name');
  if (!id) {
    throw new Error(`Builtin node at '${idPath}' is missing id/name.`);
  }
  // Accept either { builtin: { tools: [...] } } (matches the config shape the
  // host uses to scope handlers) or a flat { tools: [...] }.
  const builtinBlock = isRecord(value.builtin) ? value.builtin : value;
  const rawTools = Array.isArray(builtinBlock.tools) ? builtinBlock.tools : [];
  const tools = rawTools.map((item, index) => normalizeBuiltinTool(item, `${idPath}/${id}[${index}]`));
  if (tools.length === 0) {
    throw new Error(`Builtin node '${id}' must declare at least one tool.`);
  }
  assertUniqueSiblingIds(
    tools.map((t) => ({ id: t.name })),
    `${idPath}/${id}`
  );
  return {
    kind: 'builtin',
    id,
    title: stringField(value, 'title') || stringField(value, 'name') || id,
    summary: stringField(value, 'summary') || stringField(value, 'description'),
    description: stringField(value, 'description'),
    tools,
  };
}

function normalizeBuiltinTool(value: unknown, idPath: string): BuiltinToolConfig {
  if (!isRecord(value)) {
    throw new Error(`Builtin tool at '${idPath}' must be an object.`);
  }
  const name = stringField(value, 'name');
  const handler = stringField(value, 'handler');
  if (!name) {
    throw new Error(`Builtin tool at '${idPath}' is missing name.`);
  }
  if (!handler) {
    throw new Error(`Builtin tool '${name}' is missing handler.`);
  }
  return {
    name,
    handler,
    description: stringField(value, 'description'),
    inputSchema: value.inputSchema,
    outputSchema: value.outputSchema,
    effect: parseToolEffect(value.effect),
    scope: stringField(value, 'scope'),
    confirm: value.confirm === true ? true : undefined,
  };
}

// Validate an optional effect field. Unknown / absent values leave it undefined
// so help output falls back to the historical `external` default.
function parseToolEffect(value: unknown): ToolEffect | undefined {
  if (value === 'read' || value === 'write' || value === 'destructive' || value === 'external') {
    return value;
  }
  return undefined;
}

function assertUniqueSiblingIds(children: { id: string }[], scope: string): void {
  const seen = new Set<string>();
  for (const child of children) {
    if (seen.has(child.id)) {
      throw new Error(`Duplicate sibling id '${child.id}' under '${scope}'.`);
    }
    seen.add(child.id);
  }
}

// Attach non-enumerable parent back-references for nodePath() / back-navigation.
function linkParents(node: TreeNode): void {
  if (node.kind === 'directory') {
    for (const child of node.children) {
      Object.defineProperty(child, 'parent', {
        value: node,
        enumerable: false,
        writable: true,
        configurable: true,
      });
      linkParents(child);
    }
  }
}

// The "/htbp/a/b/c" path for a node, walking the parent chain (root id omitted).
export function nodePath(node: TreeNode): string {
  const segments: string[] = [];
  let current: TreeNode | undefined = node;
  while (current && current.parent) {
    segments.unshift(current.id);
    current = current.parent;
  }
  return segments.length === 0 ? TREE_PREFIX : `${TREE_PREFIX}/${segments.map(encodeURIComponent).join('/')}`;
}

// Resolve URL path segments (after /htbp/) to a node plus any leftover sub-path
// that belongs to the node's adapter (e.g. an MCP tool name or HTTP endpoint).
export function findNode(root: DirectoryNode, segments: string[]): { node: TreeNode; sub: string[] } | undefined {
  let current: TreeNode = root;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (current.kind !== 'directory') {
      // Remaining segments are the adapter sub-path (tool name, endpoint, ...).
      return { node: current, sub: segments.slice(index) };
    }
    const child: TreeNode | undefined = current.children.find((item) => item.id === segment);
    if (!child) {
      return undefined;
    }
    current = child;
  }
  return { node: current, sub: [] };
}
