// TB SDK core abstractions.
//
// A TB Server is a self-describing, recursive tree. Every node answers
// `GET {path}/~help`. The JSON help payload carries either a "next layer
// resource list" (for directory / mid-path nodes) or an embedded endpoint
// schema (for end-path leaves). An agent walks the tree by following the
// relative `resources[].path` links until it reaches an `endpoint`.

export type NodeKind = 'directory' | 'mcp' | 'http' | 'remote' | 'mount' | 'builtin';

// Declared side-effect class of a tool / end-path. Advisory metadata an agent
// (or a UI) uses to decide whether a call needs confirmation. `external` is the
// backward-compatible default when nothing is declared (matches the historical
// `effect external` text-DSL line).
export type ToolEffect = 'read' | 'write' | 'destructive' | 'external';

export type AuthMode = 'none' | 'bearer' | 'oauth';

export type AppEnv = Env & {
  AUTH_BEARER_TOKEN?: string;
  OAUTH_ISSUER?: string;
  OAUTH_JWKS_URI?: string;
  ALLOW_INSECURE_MCP_HTTP?: string;
  HTBP_REMOTE_ALLOWLIST?: string;
  TENANT_MODE?: string;
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

// One callable tool exposed by an MCP end-path leaf.
export interface ToolSpec {
  name: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  // Optional call semantics (advisory). Omitted fields keep the historical
  // default behavior: effect is treated as `external`, no scope, no confirm.
  effect?: ToolEffect;
  scope?: string; // Free-form permission/capability scope this tool needs.
  confirm?: boolean; // Hint that a client should confirm before calling.
}

// End-path description: how to actually call the leaf resource.
// For an MCP leaf the whole server is one end-path; `tools` lists the callable
// tools and a call selects one via the request body's `tool` field. For a
// single-shot HTTP endpoint, `tools` is absent and `inputSchema` describes the
// body directly.
export interface EndpointSpec {
  method: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  example?: unknown;
  tools?: ToolSpec[];
  // Call semantics for a single-shot end-path (no `tools`). Same defaults as
  // ToolSpec: omitted => effect `external`, no scope, no confirm.
  effect?: ToolEffect;
  scope?: string;
  confirm?: boolean;
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

// Per-tool virtualization override (Tools Management). Keyed by the upstream
// tool name; controls how (and whether) a tool is exposed.
export interface ToolOverride {
  hide?: boolean; // Omit from the exposed tools and reject calls.
  rename?: string; // Exposed name (before the namespace prefix is applied).
  description?: string; // Override the exposed description.
}

export interface McpNode extends BaseNode {
  kind: 'mcp';
  endpoint: string;
  description?: string;
  headers?: Record<string, string>;
  allowedTools?: string[];
  // Tools Management: a prefix joined to every exposed tool name as
  // `${namespace}__${name}`, to avoid collisions across servers.
  namespace?: string;
  // Per-upstream-tool-name overrides (hide / rename / description).
  toolOverrides?: Record<string, ToolOverride>;
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
  // Optional call semantics, surfaced in help. Defaults preserve prior behavior.
  effect?: ToolEffect;
  scope?: string;
  confirm?: boolean;
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

// Mount node: maps an object-storage prefix tree onto TB nodes. Sub-prefixes
// become directory-like nodes; objects become read-only leaves. Children are
// listed lazily from storage rather than declared in config.
export interface MountNode extends BaseNode {
  kind: 'mount';
  // Name of the R2 bucket binding on the Worker env (e.g. "TB_FILES").
  bucket: string;
  // Optional prefix within the bucket that this mount is rooted at.
  prefix?: string;
  description?: string;
}

export type TreeNode = DirectoryNode | McpNode | HttpNode | RemoteNode | MountNode | BuiltinNode;

// ---- Builtin node ----
//
// A `builtin` node is an MCP-shaped whole-leaf: it declares a static list of
// tools whose implementations live in the HOST worker, not in tool-bridge. The
// adapter only owns the tree/help/routing; the host injects the actual handler
// functions via `AdapterContext.builtinHandlers`. This keeps tool-bridge a
// generic bridge while letting a host (e.g. Watt) plug in its own websearch,
// echo, etc.

// One tool declared by a builtin node. `handler` names a function the host
// registered; the semantic fields flow straight through to help output.
export interface BuiltinToolConfig {
  name: string;
  description?: string;
  handler: string; // Key into the host-provided handler registry.
  inputSchema?: unknown;
  outputSchema?: unknown;
  effect?: ToolEffect;
  scope?: string;
  confirm?: boolean;
}

export interface BuiltinNode extends BaseNode {
  kind: 'builtin';
  description?: string;
  tools: BuiltinToolConfig[];
}

// A host-implemented builtin tool handler. `input` is the parsed call arguments
// (already unwrapped from any {arguments:{...}} envelope); the return value is
// serialized back to the caller as the call result.
export type BuiltinHandler = (input: unknown, ctx: AdapterContext) => Promise<unknown> | unknown;

// Host-injected registry of builtin handlers, keyed by the `handler` name a
// BuiltinToolConfig references. Absent by default (tool-bridge ships no
// handlers of its own beyond what a host or a test registers).
export type BuiltinHandlerRegistry = Record<string, BuiltinHandler>;

// Minimal object-storage provider used by the mount adapter. R2's binding is
// one implementation; tests provide an in-memory fake. Keeps the adapter
// independent of the concrete storage SDK.
export interface StorageEntry {
  name: string; // Last path segment (folder or file name).
  key: string; // Full storage key.
  isDir: boolean;
}

export interface StorageObject {
  key: string;
  body: string;
  contentType?: string;
  size?: number;
}

export interface StorageProvider {
  // List immediate children (one level) under `prefix`, treating "/" as the
  // directory delimiter.
  list(prefix: string): Promise<StorageEntry[]>;
  // Fetch a single object by key, or null if it does not exist.
  get(key: string): Promise<StorageObject | null>;
}

// Context handed to an adapter when describing or calling a node.
// `basePath` is for self-inspection only; emitted resource paths stay relative.
export interface AdapterContext {
  env: AppEnv;
  authMode: AuthMode;
  basePath: string;
  // Host-injected implementations for `builtin` node tools. Only the builtin
  // adapter reads this; other adapters ignore it. Absent when no host registers
  // any (builtin `describe`/help still works; `call` then errors clearly).
  builtinHandlers?: BuiltinHandlerRegistry;
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
