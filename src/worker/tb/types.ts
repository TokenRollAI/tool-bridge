// TB SDK core abstractions.
//
// A TB Server is a self-describing, recursive tree. Every node answers
// `GET {path}/~help`. The JSON help payload carries either a "next layer
// resource list" (for directory / mid-path nodes) or an embedded endpoint
// schema (for end-path leaves). An agent walks the tree by following the
// relative `resources[].path` links until it reaches an `endpoint`.

export type NodeKind = 'directory' | 'mcp' | 'http' | 'remote';

export type AuthMode = 'none' | 'bearer' | 'oauth';

export type AppEnv = Env & {
  AUTH_BEARER_TOKEN?: string;
  OAUTH_ISSUER?: string;
  OAUTH_JWKS_URI?: string;
  ALLOW_INSECURE_MCP_HTTP?: string;
  HTBP_REMOTE_ALLOWLIST?: string;
};

// One entry in a node's "next layer resource list".
// INVARIANT: `path` is ALWAYS relative (e.g. "./context7", "../"). A node must
// never emit an absolute URL here, so any subtree stays mountable under any
// domain or base path. Remote federation is the only exception and is modeled
// as a `remote` node whose absolute target lives in config, not in help output.
export interface ResourceRef {
  name: string;
  path: string;
  description?: string;
}

// End-path description: how to actually call the leaf resource.
export interface EndpointSpec {
  method: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  example?: unknown;
}

// The JSON body returned by `GET {path}/~help`.
export interface HelpPayload {
  htbp: 'draft';
  kind: NodeKind;
  title: string;
  description?: string;
  cachable?: boolean; // GET help is cacheable (served with ETag / Cache-Control).
  resources?: ResourceRef[]; // Present for directory / mid-path nodes.
  endpoint?: EndpointSpec; // Present for end-path leaves.
}

// ---- Configuration tree (parsed from MCP_SERVERS_JSON) ----

export interface BaseNode {
  kind: NodeKind;
  id: string; // Unique among siblings; used as a URL path segment.
  title: string;
  summary?: string;
  // Set during tree build; non-enumerable so JSON.stringify never sees a cycle.
  parent?: TreeNode;
}

export interface DirectoryNode extends BaseNode {
  kind: 'directory';
  children: TreeNode[];
}

export interface McpNode extends BaseNode {
  kind: 'mcp';
  endpoint: string;
  description?: string;
  headers?: Record<string, string>;
  allowedTools?: string[];
}

export interface HttpEndpointConfig {
  name: string;
  method: string;
  url: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  example?: unknown;
  headers?: Record<string, string>;
}

export interface HttpNode extends BaseNode {
  kind: 'http';
  endpoints: HttpEndpointConfig[];
}

export interface RemoteNode extends BaseNode {
  kind: 'remote';
  helpUrl: string;
  headers?: Record<string, string>;
}

export type TreeNode = DirectoryNode | McpNode | HttpNode | RemoteNode;

// Context handed to an adapter when describing or calling a node.
// `basePath` is for self-inspection only; emitted resource paths stay relative.
export interface AdapterContext {
  env: AppEnv;
  authMode: AuthMode;
  basePath: string;
}

// Pluggable node behaviour. Each NodeKind has an adapter that knows how to
// describe a sub-path (mid or end) and how to invoke an end-path.
export interface TBAdapter<TNode extends TreeNode = TreeNode> {
  kind: NodeKind;
  // Returns the JSON help for `node` at the given relative sub-path segments.
  describe(node: TNode, ctx: AdapterContext, sub: string[]): Promise<HelpPayload>;
  // Invokes an end-path under `node` with the given JSON input.
  call(node: TNode, ctx: AdapterContext, sub: string[], input: unknown): Promise<unknown>;
}

// Crawler output: a flattened view of the walked tree.
export interface CrawlNode {
  kind: NodeKind;
  path: string; // Local "/htbp/..." path or absolute remote URL.
  title?: string;
  description?: string;
  helpUrl: string;
  children: CrawlNode[];
  endpoint?: EndpointSpec; // Present when this node is an end-path leaf.
  error?: string; // Non-fatal per-node fetch/parse failure.
  truncated?: boolean; // Descent stopped due to depth/node ceiling.
}
