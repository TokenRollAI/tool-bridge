import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  AuditActor,
  AuditCallContext,
  auditContextFor,
  emitAuditEvent,
  errorCodeOf,
  inputSummary,
  routeAuditApi,
  traceIdOf,
} from './tb/audit';
import { clampCrawlOptions, crawlTree } from './tb/crawl';
import { materializePlacements } from './tb/entities';
import { errorResponseOf, ForbiddenError } from './tb/errors';
import { routeHostApi } from './tb/host-api';
import { routeProviderApi } from './tb/provider-api';
import {
  ExecutionDriverRegistry,
  routeDeviceHtbp,
  routeEndpointApi,
  routeTunnelApi,
  TunnelBroker,
} from './tb/device';
import { parseTree } from './tb/registry';
import { resolveCall, resolveHelp } from './tb/resolve';
import { PrincipalKind, resolvePrincipal, tenantModeEnabled } from './tb/tenant';
import {
  deleteDynamicServer,
  dynamicServersEnabled,
  listDynamicServers,
  putDynamicServer,
} from './tb/dynamic-servers';
import type { BuiltinHandlerRegistry, DirectoryNode } from './tb/types';

const MCP_PROTOCOL_VERSION = '2025-11-25';
const CLIENT_NAME = 'tool-bridge';
const CLIENT_VERSION = 'draft';
const MAX_JSON_BYTES = 1_000_000;
const MAX_SSE_BYTES = 4_000_000;

type JsonObject = Record<string, unknown>;

type AppEnv = Env & {
  AUTH_BEARER_TOKEN?: string;
  OAUTH_ISSUER?: string;
  OAUTH_JWKS_URI?: string;
  ALLOW_INSECURE_MCP_HTTP?: string;
};

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: unknown;
}

interface ServerConfig {
  id: string;
  name: string;
  endpoint: string;
  description?: string;
  headers?: Record<string, string>;
  allowedTools?: string[];
}

interface AdhocServerInput {
  name?: string;
  endpoint?: string;
  headers?: Record<string, string>;
  bearerToken?: string;
}

interface ResolvedServer extends ServerConfig {
  resolvedHeaders: Record<string, string>;
}

type AuthMode = 'none' | 'bearer' | 'oauth';

interface AuthInfo {
  mode: AuthMode;
  subject?: string;
  // Set when tenant mode is on and the Secret Key resolved to a tenant.
  tenantId?: string;
  // The tenant's tree root; when undefined, requests fall back to the env tree.
  root?: DirectoryNode;
  // D-3 unified principal record (tenant mode). Absent in bearer/oauth/none
  // modes, where the single credential is the deployment admin.
  principal?: PrincipalKind;
  providerId?: string;
  hostId?: string;
  // Control-plane access: admin keys in tenant mode; static bearer/OAuth in
  // non-tenant deployments. Anonymous `none` mode is intentionally not admin
  // once TENANTS exists because KV-backed M1/M3/M4 routes mutate/read shared
  // control-plane state.
  isAdmin: boolean;
}

interface RpcPayload {
  jsonrpc: '2.0';
  id?: string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface RpcResult {
  result: unknown;
  sessionId?: string;
}

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data, null, 2), { ...init, headers });
}

function text(data: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', headers.get('Content-Type') ?? 'text/plain; charset=utf-8');
  return new Response(data, { ...init, headers });
}

function errorResponse(status: number, code: string, message: string, details?: unknown): Response {
  return json({ error: { code, message, details } }, { status });
}

function getAuthMode(env: AppEnv): AuthMode {
  if (env.OAUTH_ISSUER) {
    return 'oauth';
  }
  if (env.AUTH_BEARER_TOKEN) {
    return 'bearer';
  }
  return 'none';
}

function getBearerToken(request: Request): string | undefined {
  const value = request.headers.get('Authorization');
  if (!value) {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1];
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const left = await sha256(a);
  const right = await sha256(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

async function authenticate(request: Request, env: AppEnv): Promise<AuthInfo | Response> {
  const mode = getAuthMode(env);

  // Tenant mode: the bearer token is a Secret Key resolved to a principal
  // record (agent/provider/host/admin) and, when tenant-bound, its tree.
  // This composes orthogonally on top of the base mode — when TENANTS is set we
  // always require a token and resolve it, even if the base mode is 'none'.
  if (tenantModeEnabled(env)) {
    const token = getBearerToken(request);
    if (!token) {
      return errorResponse(401, 'unauthorized', 'Secret Key (bearer token) required.');
    }
    const record = await resolvePrincipal(env, token);
    if (!record) {
      return errorResponse(401, 'unauthorized', 'Secret Key is invalid.');
    }
    return {
      mode,
      subject: record.label ?? record.providerId ?? record.hostId ?? record.tenantId,
      tenantId: record.tenantId,
      root: record.root,
      principal: record.principal,
      providerId: record.providerId,
      hostId: record.hostId,
      isAdmin: record.principal === 'admin',
    };
  }

  if (mode === 'none') {
    return { mode, isAdmin: !env.TENANTS };
  }

  const token = getBearerToken(request);
  if (!token) {
    return errorResponse(401, 'unauthorized', 'Bearer token required.');
  }

  if (mode === 'bearer') {
    const expectedToken = env.AUTH_BEARER_TOKEN;
    if (!expectedToken) {
      return errorResponse(500, 'auth_misconfigured', 'AUTH_BEARER_TOKEN is required for bearer auth.');
    }
    const ok = await constantTimeEqual(token, expectedToken);
    if (!ok) {
      return errorResponse(401, 'unauthorized', 'Bearer token is invalid.');
    }
    return { mode, subject: 'static-bearer', isAdmin: true };
  }

  try {
    const issuer = env.OAUTH_ISSUER;
    if (!issuer) {
      return errorResponse(500, 'auth_misconfigured', 'OAUTH_ISSUER is required for OAuth auth.');
    }
    const jwksUri = env.OAUTH_JWKS_URI || (await discoverJwksUri(issuer));
    const jwks = createRemoteJWKSet(new URL(jwksUri));
    const verified = await jwtVerify(token, jwks, {
      issuer,
      audience: env.OAUTH_REQUIRED_AUDIENCE || undefined,
    });
    return {
      mode,
      subject: typeof verified.payload.sub === 'string' ? verified.payload.sub : undefined,
      isAdmin: true,
    };
  } catch (error) {
    return errorResponse(401, 'unauthorized', 'OAuth bearer token is invalid.', messageOf(error));
  }
}

async function discoverJwksUri(issuer: string): Promise<string> {
  const issuerUrl = issuer.endsWith('/') ? issuer.slice(0, -1) : issuer;
  const response = await fetch(`${issuerUrl}/.well-known/openid-configuration`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Unable to load OIDC metadata: HTTP ${response.status}`);
  }
  const metadata = (await response.json()) as { jwks_uri?: unknown };
  if (typeof metadata.jwks_uri !== 'string' || metadata.jwks_uri.length === 0) {
    throw new Error('OIDC metadata does not include jwks_uri.');
  }
  return metadata.jwks_uri;
}

function publicAuthConfig(env: AppEnv): JsonObject {
  return {
    mode: getAuthMode(env),
    oauthIssuer: env.OAUTH_ISSUER || undefined,
    oauthAudience: env.OAUTH_REQUIRED_AUDIENCE || undefined,
  };
}

async function readJsonBody<T>(request: Request): Promise<T> {
  const length = request.headers.get('Content-Length');
  if (length && Number(length) > MAX_JSON_BYTES) {
    throw new Error('Request body is too large.');
  }
  const value = (await request.json()) as T;
  return value;
}

function parseConfiguredServers(env: AppEnv): ServerConfig[] {
  const raw = env.MCP_SERVERS_JSON || '{}';
  const parsed = JSON.parse(raw) as unknown;
  const entries: ServerConfig[] = [];
  // Nested tree form: collect every MCP leaf (skip directory/http/remote/mount)
  // so the legacy /api/servers + /mcp/* routes keep working under a tree config.
  if (isRecord(parsed) && (parsed.type === 'directory' || Array.isArray(parsed.children))) {
    collectMcpLeaves(parsed, entries);
    return entries;
  }
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      entries.push(normalizeServerConfig(item));
    }
    return entries;
  }
  if (isRecord(parsed)) {
    for (const [id, item] of Object.entries(parsed)) {
      entries.push(normalizeServerConfig({ id, ...(isRecord(item) ? item : {}) }));
    }
  }
  return entries;
}

// Recursively gather `type: "mcp"` nodes from a nested tree config.
function collectMcpLeaves(node: unknown, out: ServerConfig[]): void {
  if (!isRecord(node)) {
    return;
  }
  if (node.type === 'mcp') {
    out.push(normalizeServerConfig(node));
    return;
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collectMcpLeaves(child, out);
    }
  }
}

function normalizeServerConfig(value: unknown): ServerConfig {
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
  const headers = recordOfStrings(value.headers);
  const allowedTools = arrayOfStrings(value.allowedTools) ?? arrayOfStrings(value.allowed_tools);
  return {
    id,
    name: stringField(value, 'name') || id,
    endpoint,
    description: stringField(value, 'description'),
    headers,
    allowedTools,
  };
}

function normalizeAdhocServer(value: AdhocServerInput): ServerConfig {
  if (!value.endpoint) {
    throw new Error('Ad-hoc server endpoint is required.');
  }
  const headers = { ...(value.headers ?? {}) };
  if (value.bearerToken) {
    headers.Authorization = `Bearer ${value.bearerToken}`;
  }
  return {
    id: value.name || 'adhoc',
    name: value.name || 'Ad-hoc MCP',
    endpoint: value.endpoint,
    headers,
  };
}

// Stable, URL-safe id for a dynamically saved server.
function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'server';
}

async function resolveServer(env: AppEnv, serverId: string): Promise<ResolvedServer> {
  const configured = parseConfiguredServers(env).find((item) => item.id === serverId || item.name === serverId);
  if (configured) {
    return materializeServer(env, configured);
  }
  // Fall back to a runtime-added (KV) server.
  const dynamic = (await listDynamicServers(env)).find((item) => item.id === serverId || item.name === serverId);
  if (dynamic) {
    return materializeServer(env, { id: dynamic.id, name: dynamic.name, endpoint: dynamic.endpoint, description: dynamic.description });
  }
  throw new Error(`Unknown MCP server '${serverId}'.`);
}

function materializeServer(env: AppEnv, server: ServerConfig): ResolvedServer {
  const url = new URL(server.endpoint);
  if (url.protocol !== 'https:' && env.ALLOW_INSECURE_MCP_HTTP !== 'true') {
    throw new Error(`MCP endpoint for '${server.id}' must use https://.`);
  }
  return {
    ...server,
    endpoint: url.toString(),
    resolvedHeaders: materializeHeaders(env, server.headers),
  };
}

function materializeHeaders(env: AppEnv, headers: Record<string, string> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    result[key] = materializeHeaderValue(env, value);
  }
  return result;
}

function materializeHeaderValue(env: AppEnv, value: string): string {
  if (value.startsWith('$env:')) {
    return stringEnv(env, value.slice('$env:'.length));
  }
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name: string) => stringEnv(env, name));
}

function stringEnv(env: AppEnv, key: string): string {
  const value = (env as unknown as Record<string, unknown>)[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Environment variable '${key}' is required for MCP header substitution.`);
  }
  return value;
}

async function listToolsForServer(server: ResolvedServer): Promise<McpTool[]> {
  const result = await executeMcpRequest(server, 'tools/list', {});
  const tools = isRecord(result) && Array.isArray(result.tools) ? result.tools : [];
  const filtered = tools.map(normalizeTool).filter(Boolean) as McpTool[];
  if (!server.allowedTools || server.allowedTools.length === 0) {
    return filtered;
  }
  const allow = new Set(server.allowedTools);
  return filtered.filter((tool) => allow.has(tool.name));
}

async function callToolForServer(server: ResolvedServer, toolName: string, args: unknown): Promise<unknown> {
  if (server.allowedTools && server.allowedTools.length > 0 && !server.allowedTools.includes(toolName)) {
    throw new Error(`Tool '${toolName}' is not allowed for server '${server.id}'.`);
  }
  return executeMcpRequest(server, 'tools/call', {
    name: toolName,
    arguments: isRecord(args) ? args : {},
  });
}

async function executeMcpRequest(server: ResolvedServer, method: string, params: unknown): Promise<unknown> {
  const initialized = await initializeMcpSession(server);
  try {
    await sendMcpNotification(server, initialized.sessionId, 'notifications/initialized', {});
    const response = await sendMcpRequest(server, initialized.sessionId, method, params);
    return response.result;
  } finally {
    if (initialized.sessionId) {
      await terminateMcpSession(server, initialized.sessionId).catch(() => {});
    }
  }
}

async function initializeMcpSession(server: ResolvedServer): Promise<{ sessionId?: string }> {
  const response = await sendMcpRequest(server, undefined, 'initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: {
      name: CLIENT_NAME,
      version: CLIENT_VERSION,
    },
  });
  return { sessionId: response.sessionId };
}

async function sendMcpNotification(
  server: ResolvedServer,
  sessionId: string | undefined,
  method: string,
  params: unknown
): Promise<void> {
  const response = await fetch(server.endpoint, {
    method: 'POST',
    headers: mcpHeaders(server, sessionId),
    body: JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
    }),
  });
  if (response.status === 202) {
    return;
  }
  if (!response.ok) {
    throw new Error(`MCP notification '${method}' failed with HTTP ${response.status}.`);
  }
}

async function sendMcpRequest(
  server: ResolvedServer,
  sessionId: string | undefined,
  method: string,
  params: unknown
): Promise<RpcResult> {
  const id = crypto.randomUUID();
  const response = await fetch(server.endpoint, {
    method: 'POST',
    headers: mcpHeaders(server, sessionId),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }),
  });
  if (!response.ok) {
    throw new Error(`MCP request '${method}' failed with HTTP ${response.status}: ${await safeErrorText(response)}`);
  }
  const payload = await readRpcResponse(response, id);
  if (payload.error) {
    throw new Error(`MCP error ${payload.error.code}: ${payload.error.message}`);
  }
  return {
    result: payload.result,
    sessionId: response.headers.get('MCP-Session-Id') ?? undefined,
  };
}

function mcpHeaders(server: ResolvedServer, sessionId: string | undefined): Headers {
  const headers = new Headers(server.resolvedHeaders);
  headers.set('Accept', 'application/json, text/event-stream');
  headers.set('Content-Type', 'application/json');
  headers.set('MCP-Protocol-Version', MCP_PROTOCOL_VERSION);
  if (sessionId) {
    headers.set('MCP-Session-Id', sessionId);
  }
  return headers;
}

async function readRpcResponse(response: Response, id: string): Promise<RpcPayload> {
  const contentType = response.headers.get('Content-Type') ?? '';
  if (contentType.includes('text/event-stream')) {
    return readSseRpcResponse(response, id);
  }
  const textValue = await readBoundedText(response, MAX_JSON_BYTES);
  const payload = JSON.parse(textValue) as RpcPayload;
  if (payload.id !== id) {
    throw new Error(`Unexpected MCP response id '${String(payload.id)}'.`);
  }
  return payload;
}

async function readSseRpcResponse(response: Response, id: string): Promise<RpcPayload> {
  if (!response.body) {
    throw new Error('MCP server returned an empty SSE response.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventData: string[] = [];
  let bytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    bytes += value.byteLength;
    if (bytes > MAX_SSE_BYTES) {
      throw new Error('MCP SSE response exceeded the maximum size.');
    }
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const rawLine = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (line === '') {
        const payload = parseSseData(eventData);
        eventData = [];
        if (payload && payload.id === id) {
          return payload;
        }
      } else if (line.startsWith('data:')) {
        eventData.push(line.slice(5).trimStart());
      }
      newlineIndex = buffer.indexOf('\n');
    }
  }

  const payload = parseSseData(eventData);
  if (payload && payload.id === id) {
    return payload;
  }
  throw new Error(`MCP SSE stream ended before response '${id}' was received.`);
}

function parseSseData(lines: string[]): RpcPayload | undefined {
  if (lines.length === 0) {
    return undefined;
  }
  const data = lines.join('\n').trim();
  if (!data.startsWith('{')) {
    return undefined;
  }
  return JSON.parse(data) as RpcPayload;
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let result = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      return result + decoder.decode();
    }
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      throw new Error('Response body exceeded the maximum size.');
    }
    result += decoder.decode(value, { stream: true });
  }
}

async function safeErrorText(response: Response): Promise<string> {
  try {
    return await readBoundedText(response, 8_000);
  } catch {
    return '';
  }
}

async function terminateMcpSession(server: ResolvedServer, sessionId: string): Promise<void> {
  await fetch(server.endpoint, {
    method: 'DELETE',
    headers: mcpHeaders(server, sessionId),
  });
}

function normalizeTool(value: unknown): McpTool | undefined {
  if (!isRecord(value) || typeof value.name !== 'string') {
    return undefined;
  }
  return {
    name: value.name,
    description: typeof value.description === 'string' ? value.description : undefined,
    inputSchema: value.inputSchema,
    outputSchema: value.outputSchema,
    annotations: value.annotations,
  };
}

function helpAuth(authMode: AuthMode): 'none' | 'bearer' {
  return authMode === 'none' ? 'none' : 'bearer';
}

function buildHelp(server: ServerConfig, tools: McpTool[], basePath: string, authMode: AuthMode): string {
  const auth = helpAuth(authMode);
  const lines = [
    'htbp draft',
    `resource ${basePath}`,
    `title ${server.name}`,
    server.description ? `summary ${server.description}` : `summary MCP Streamable HTTP bridge for ${server.name}.`,
    'skill ./~skill',
    `auth ${auth}`,
    '',
  ];
  for (const tool of tools) {
    lines.push(`cmd ${tool.name} POST ${basePath}/tools/${encodeURIComponent(tool.name)}`);
    lines.push('  body application/json {"arguments":object?}');
    lines.push(`  auth ${auth}`);
    lines.push('  effect external');
    lines.push('  returns 200 application/json');
    if (tool.description) {
      lines.push(`  note ${oneLine(tool.description)}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function buildSkill(server: ServerConfig, tools: McpTool[], basePath: string, authMode: AuthMode): string {
  const toolList = tools
    .map((tool) => `- \`${tool.name}\`${tool.description ? `：${oneLine(tool.description)}` : ''}`)
    .join('\n');
  const authHeader = authMode === 'none' ? '' : 'Authorization: Bearer <token>\n';
  return `# ${server.name}

## When To Use

当需要通过 HTBP 调用 \`${server.name}\` 这个 MCP server 暴露的 tool 时，先读取 \`${basePath}/~help\`，再选择具体 tool endpoint。

## Request Construction

每个 MCP tool 都映射为一个普通 HTTP POST：

\`\`\`http
POST ${basePath}/tools/{tool}
${authHeader}Content-Type: application/json
\`\`\`

请求体：

\`\`\`json
{
  "arguments": {}
}
\`\`\`

## Available Tools

${toolList || '当前没有可见 tool。'}

## Safety

这些调用会转发到上游 MCP server。执行 write、delete、external side effect 操作前，应先确认用户意图。
`;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const raw = value[key];
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

function recordOfStrings(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') {
      result[key] = item;
    }
  }
  return result;
}

function arrayOfStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function routeApi(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api/auth/config' && request.method === 'GET') {
    return json(publicAuthConfig(env));
  }

  const authInfo = await authenticate(request, env);
  if (authInfo instanceof Response) {
    return authInfo;
  }

  // Provider/Placement management plane (M3).
  const providerApiResponse = await routeProviderApi(request, env, authInfo);
  if (providerApiResponse) {
    return providerApiResponse;
  }

  // Tunnel / Device endpoint and command-policy management plane (M2).
  const endpointApiResponse = await routeEndpointApi(request, env, authInfo);
  if (endpointApiResponse) {
    return endpointApiResponse;
  }

  // Host plane: registration, S2S keys, mounts:sync (M1).
  const hostApiResponse = await routeHostApi(request, env, authInfo);
  if (hostApiResponse) {
    return hostApiResponse;
  }

  // Audit query plane (M4).
  const auditResponse = await routeAuditApi(request, env, authInfo);
  if (auditResponse) {
    return auditResponse;
  }

  if (path === '/api/servers' && request.method === 'GET') {
    const staticServers = parseConfiguredServers(env).map(({ headers: _headers, ...server }) => ({
      ...server,
      source: 'static' as const,
    }));
    const dynamic = (await listDynamicServers(env)).map((server) => ({ ...server, source: 'dynamic' as const }));
    // Dynamic entries with an id that collides with a static one are dropped.
    const staticIds = new Set(staticServers.map((s) => s.id));
    const merged = [...staticServers, ...dynamic.filter((s) => !staticIds.has(s.id))];
    return json({ auth: authInfo, servers: merged, dynamicEnabled: dynamicServersEnabled(env) });
  }

  if (path === '/api/servers' && request.method === 'POST') {
    if (!dynamicServersEnabled(env)) {
      return errorResponse(501, 'not_supported', 'Saving servers requires the TENANTS KV binding.');
    }
    const body = await readJsonBody<{ name?: string; endpoint?: string; description?: string }>(request);
    if (!body.endpoint) {
      return errorResponse(400, 'bad_request', 'endpoint is required.');
    }
    // Validate (https enforcement etc.) and derive a stable id from name/endpoint.
    const resolved = materializeServer(env, normalizeAdhocServer({ name: body.name, endpoint: body.endpoint }));
    const id = slugify(body.name || resolved.id);
    await putDynamicServer(env, {
      id,
      name: body.name || id,
      endpoint: resolved.endpoint,
      description: body.description,
    });
    return json({ ok: true, id });
  }

  const deleteMatch = /^\/api\/servers\/([^/]+)$/.exec(path);
  if (deleteMatch && request.method === 'DELETE') {
    if (!dynamicServersEnabled(env)) {
      return errorResponse(501, 'not_supported', 'Deleting servers requires the TENANTS KV binding.');
    }
    await deleteDynamicServer(env, decodeURIComponent(deleteMatch[1] ?? ''));
    return json({ ok: true });
  }

  if (path === '/api/bridge/tools' && request.method === 'POST') {
    const body = await readJsonBody<{ server?: AdhocServerInput }>(request);
    const server = materializeServer(env, normalizeAdhocServer(body.server ?? {}));
    const tools = await listToolsForServer(server);
    return json({ server: publicServer(server), tools });
  }

  if (path === '/api/bridge/call' && request.method === 'POST') {
    const body = await readJsonBody<{ server?: AdhocServerInput; tool?: string; arguments?: unknown }>(request);
    if (!body.tool) {
      return errorResponse(400, 'bad_request', 'Tool name is required.');
    }
    const server = materializeServer(env, normalizeAdhocServer(body.server ?? {}));
    const result = await callToolForServer(server, body.tool, body.arguments);
    return json({ server: publicServer(server), tool: body.tool, result });
  }

  if (path === '/api/tree' && request.method === 'GET') {
    const tree = await crawlTree(env, await rootFor(authInfo, env), { path: '' }, authInfo.mode);
    return json({ auth: authInfo, tree });
  }

  if (path === '/api/crawl' && request.method === 'POST') {
    const body = await readJsonBody<{ start?: { path?: string; url?: string }; maxDepth?: number; maxNodes?: number }>(
      request
    );
    const opts = clampCrawlOptions({ maxDepth: body.maxDepth, maxNodes: body.maxNodes });
    const tree = await crawlTree(env, await rootFor(authInfo, env), body.start ?? { path: '' }, authInfo.mode, opts);
    return json({ auth: authInfo, tree });
  }

  const serverMatch = /^\/api\/servers\/([^/]+)(\/.*)?$/.exec(path);
  if (serverMatch) {
    const server = await resolveServer(env, decodeURIComponent(serverMatch[1] ?? ''));
    const suffix = serverMatch[2] ?? '';
    return routeConfiguredServer(request, server, suffix, `/api/servers/${encodeURIComponent(server.id)}`, authInfo.mode);
  }

  return errorResponse(404, 'not_found', 'API route not found.');
}

// The tree to resolve this request against: the tenant's tree when tenant mode
// resolved one, otherwise the global env tree (fallback / legacy behavior) —
// with the scope's enabled placements compiled in (D-1: request-time
// materialization; the entity layer never changes the runtime TreeNode shape).
async function rootFor(authInfo: AuthInfo, env: AppEnv): Promise<DirectoryNode> {
  const root = authInfo.root ?? parseTree(env);
  const scope = authInfo.root && authInfo.tenantId ? authInfo.tenantId : null;
  await materializePlacements(env, root, scope);
  return root;
}

async function routeHtbp(
  request: Request,
  env: AppEnv,
  builtinHandlers?: BuiltinHandlerRegistry,
  tunnelBroker?: TunnelBroker,
  executionDrivers?: ExecutionDriverRegistry,
  executionCtx?: ExecutionContext
): Promise<Response> {
  const startedAt = Date.now();
  const traceId = traceIdOf(request);
  const url = new URL(request.url);
  const rest = url.pathname.replace(/^\/htbp\/?/, '');
  const rawSegments = rest.split('/').filter((segment) => segment.length > 0);

  // A trailing ~help control segment requests help; otherwise it's an end-path call.
  const hasHelpSuffix = rawSegments[rawSegments.length - 1] === '~help';
  const isHelp = rawSegments.length === 0 || hasHelpSuffix;
  const segments = (hasHelpSuffix ? rawSegments.slice(0, -1) : rawSegments).map(decodeURIComponent);

  // Audit context (M4): every describe/call — including 401/403/404 denials —
  // emits one structured event; only the requested path is recorded for
  // denied/hidden resources, never metadata about what exists there.
  const actor: AuditActor = {
    principal: 'anonymous',
    onBehalfOf: request.headers.get('X-TB-On-Behalf-Of') ?? undefined,
  };
  let tenantId: string | undefined;
  let callContext: AuditCallContext = {};
  let input: { bytes: number; keys?: string[] } | undefined;
  let response: Response;

  try {
    const authInfo = await authenticate(request, env);
    if (authInfo instanceof Response) {
      response = authInfo;
    } else {
      actor.principal =
        authInfo.principal ??
        (authInfo.mode === 'none' ? 'anonymous' : authInfo.mode === 'bearer' ? 'static-bearer' : 'oauth');
      actor.subject = authInfo.subject;
      tenantId = authInfo.tenantId;
      // In tenant mode, only tenant-bound principals (or admin) may use the
      // data plane; a bare provider key is control-plane only.
      if (tenantModeEnabled(env) && !authInfo.root && !authInfo.isAdmin) {
        throw new ForbiddenError('This key is not bound to a tenant tree.');
      }
      if (segments[0] === '~device') {
        if (!isHelp && request.method !== 'POST') {
          response = errorResponse(405, 'method_not_allowed', 'Use GET {path}/~help or POST {path} to call.');
        } else {
          const accept = request.headers.get('Accept') ?? '';
          const body = isHelp ? undefined : await readJsonBody<unknown>(request);
          input = inputSummary(body);
          const routed = await routeDeviceHtbp({
            env,
            principal: authInfo,
            segments,
            isHelp,
            accept,
            input: body,
            traceId,
            broker: tunnelBroker,
            executionDrivers,
          });
          response = routed.response;
          callContext = routed.audit;
          tenantId = routed.tenantId ?? tenantId;
        }
      } else if (isHelp) {
        const root = await rootFor(authInfo, env);
        callContext = auditContextFor(root, segments);
        const accept = request.headers.get('Accept') ?? '';
        response = await resolveHelp(env, root, segments, authInfo.mode, accept, builtinHandlers);
      } else if (request.method === 'POST') {
        const root = await rootFor(authInfo, env);
        callContext = auditContextFor(root, segments);
        const body = await readJsonBody<unknown>(request);
        input = inputSummary(body);
        response = await resolveCall(env, root, segments, authInfo.mode, body, builtinHandlers);
      } else {
        response = errorResponse(405, 'method_not_allowed', 'Use GET {path}/~help or POST {path} to call.');
      }
    }
  } catch (error) {
    // Typed platform errors (NotFoundError → 404, UpstreamError → 502, ...)
    // carry their own status/code; anything else is a 500 internal_error.
    response = errorResponseOf(error);
  }

  response = new Response(response.body, response);
  response.headers.set('X-TB-Trace-Id', traceId);

  await emitAuditEvent(env, executionCtx, {
    ts: new Date(startedAt).toISOString(),
    traceId,
    action: isHelp ? 'describe' : 'call',
    actor,
    tenantId,
    path: url.pathname,
    tool: callContext.tool,
    provider: callContext.provider,
    effect: callContext.effect,
    scope: callContext.scope,
    decision:
      response.status === 401 || response.status === 403
        ? 'deny'
        : response.status === 404
          ? 'not_found'
          : 'allow',
    result: response.ok ? 'ok' : 'error',
    status: response.status,
    errorCode: response.ok ? undefined : await errorCodeOf(response),
    latencyMs: Date.now() - startedAt,
    reason: request.headers.get('X-TB-Reason') ?? undefined,
    input,
  });
  return response;
}

async function routeMcpBridge(request: Request, env: AppEnv): Promise<Response> {
  const authInfo = await authenticate(request, env);
  if (authInfo instanceof Response) {
    return authInfo;
  }
  const url = new URL(request.url);
  const match = /^\/mcp\/([^/]+)(\/.*)?$/.exec(url.pathname);
  if (!match) {
    return errorResponse(404, 'not_found', 'MCP bridge route not found.');
  }
  const server = await resolveServer(env, decodeURIComponent(match[1] ?? ''));
  return routeConfiguredServer(request, server, match[2] ?? '', `/mcp/${encodeURIComponent(server.id)}`, authInfo.mode);
}

async function routeConfiguredServer(
  request: Request,
  server: ResolvedServer,
  suffix: string,
  basePath: string,
  authMode: AuthMode
): Promise<Response> {
  if (suffix === '' && request.method === 'GET') {
    return json({ server: publicServer(server), links: { help: `${basePath}/~help`, skill: `${basePath}/~skill` } });
  }
  if (suffix === '/tools' && request.method === 'GET') {
    const tools = await listToolsForServer(server);
    return json({ server: publicServer(server), tools });
  }
  if (suffix === '/~help' && request.method === 'GET') {
    const tools = await listToolsForServer(server);
    return text(buildHelp(server, tools, basePath, authMode));
  }
  if (suffix === '/~skill' && request.method === 'GET') {
    const tools = await listToolsForServer(server);
    return text(buildSkill(server, tools, basePath, authMode), {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    });
  }
  const callMatch = /^\/tools\/([^/]+)(?:\/call)?$/.exec(suffix);
  if (callMatch && request.method === 'POST') {
    const body = await readJsonBody<{ arguments?: unknown }>(request);
    const tool = decodeURIComponent(callMatch[1] ?? '');
    const result = await callToolForServer(server, tool, body.arguments);
    return json({ server: publicServer(server), tool, result });
  }
  return errorResponse(404, 'not_found', 'Server route not found.');
}

function publicServer(server: ServerConfig): JsonObject {
  return {
    id: server.id,
    name: server.name,
    endpoint: server.endpoint,
    description: server.description,
    allowedTools: server.allowedTools,
  };
}

async function handleRequest(
  request: Request,
  env: AppEnv,
  options: BridgeOptions = {},
  executionCtx?: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (url.pathname.startsWith('/api/')) {
      return await routeApi(request, env);
    }
    if (url.pathname.startsWith('/tunnel/')) {
      const response = await routeTunnelApi(request, env, options.tunnelBroker);
      if (response) {
        return response;
      }
    }
    if (url.pathname.startsWith('/mcp/')) {
      return await routeMcpBridge(request, env);
    }
    if (url.pathname === '/htbp' || url.pathname.startsWith('/htbp/')) {
      // HTBP control-plane responses are cross-origin fetchable: federation and
      // browser agents fetch another TB server's ~help from a different origin.
      const response = await routeHtbp(
        request,
        env,
        options.builtinHandlers,
        options.tunnelBroker,
        options.executionDrivers,
        executionCtx
      );
      const withCors = new Response(response.body, response);
      withCors.headers.set('Access-Control-Allow-Origin', '*');
      return withCors;
    }
    return env.ASSETS.fetch(request);
  } catch (error) {
    return errorResponseOf(error);
  }
}

// Deploy-time embedding surface (SPEC-001 §8.3): a host worker builds its own
// bridge handler with its builtin tool implementations injected. Builtin
// injection is a code-level, deploy-time act — there is intentionally no
// runtime API to register a handler.
export interface BridgeOptions {
  builtinHandlers?: BuiltinHandlerRegistry;
  tunnelBroker?: TunnelBroker;
  executionDrivers?: ExecutionDriverRegistry;
}

export function createBridge(options: BridgeOptions = {}) {
  return {
    fetch(request, env, executionCtx?: ExecutionContext): Promise<Response> {
      return handleRequest(request, env, options, executionCtx);
    },
  } satisfies ExportedHandler<AppEnv>;
}

export type {
  EndpointDriver,
  EndpointKind,
  EndpointRecord,
  ExecutionDriver,
  ExecutionDriverRegistry,
  ExecutionDriverRequest,
  K8sPodEndpointConfig,
  SshEndpointConfig,
} from './tb/device';
export { buildSshExecCommand, createSshExecutionDriver, escapePosixArg } from './tb/ssh-driver';

export default createBridge();
