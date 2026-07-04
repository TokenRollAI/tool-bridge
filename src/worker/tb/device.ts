// Tunnel / Device isolated track (TASK-M2).
//
// This module deliberately keeps M2 behind placeholder interfaces:
//   - assertEndpointSession(request): validates only the registered endpoint
//     session shape used by the minimal broker.
//   - assertDeviceGrant(principal, endpoint, tool): enforces tenant/admin
//     reachability and leaves fine-grained grant expansion to a later spec.
//   - emitAuditSummary(...): reserved no-op; the common HTBP audit envelope
//     already records the describe/call summary.
//
// It does not implement credential encryption, deep verifier, OAuth, S2S key
// rotation, or any host token system changes.

import { BadRequestError, EndpointUnavailableError, ForbiddenError, NotFoundError, errorResponse } from './errors';
import { AuditCallContext } from './audit';
import { AppEnv, HelpPayload, ResourceRef } from './types';
import { arrayOfStrings, isRecord, json, stringField } from './util';

export type EndpointKind = 'sandbox' | 'k8s-pod' | 'pc' | 'browser-host' | 'mobile' | 'generic';
export type DeviceTool = 'exec.run' | 'fs.read' | 'logs.tail';

export interface EndpointRecord {
  id: string;
  tenantId?: string;
  providerId?: string;
  kind: EndpointKind;
  label?: string;
  capabilities: DeviceTool[];
  activeCapabilities?: DeviceTool[];
  status: 'offline' | 'online' | 'revoked';
  commandPolicyId?: string;
  sessionId?: string;
  lastSeenAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommandPolicy {
  id: string;
  defaultMode: 'deny' | 'allow';
  allowCommands?: string[];
  denyCommands?: string[];
  denyPatterns?: string[];
  allowShell?: boolean;
  allowedCwdPrefixes?: string[];
  maxTimeoutMs?: number;
  maxOutputBytes?: number;
  requireConfirmFor?: string[];
  envAllowlist?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DevicePrincipal {
  isAdmin: boolean;
  tenantId?: string;
  principal?: string;
  subject?: string;
}

export interface TunnelDispatchRequest {
  endpointId: string;
  sessionId: string;
  tool: DeviceTool;
  traceId: string;
  input: Record<string, unknown>;
  deadlineMs: number;
  maxOutputBytes: number;
}

export interface TunnelBroker {
  connect?(endpoint: EndpointRecord): Promise<{ sessionId?: string } | void>;
  heartbeat?(endpoint: EndpointRecord): Promise<void>;
  dispatch(endpoint: EndpointRecord, request: TunnelDispatchRequest): Promise<unknown>;
  cancel?(endpoint: EndpointRecord, requestId: string): Promise<void>;
}

export interface DeviceRouteResult {
  response: Response;
  audit: AuditCallContext;
  tenantId?: string;
}

const ENDPOINT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const POLICY_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const DEVICE_TOOLS: DeviceTool[] = ['exec.run', 'fs.read', 'logs.tail'];
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;
const GLOBAL_DENY_COMMANDS = new Set(['rm', 'mkfs', 'dd', 'shutdown', 'reboot', 'halt', 'sudo', 'su']);
const GLOBAL_DENY_PATTERNS = [
  /\brm\s+-[^\s]*r[^\s]*f\b.*(?:\s\/|\s\*)/,
  /:\s*\(\s*\)\s*\{/,
  />\s*\/dev\/sd[a-z]/,
  /\bcurl\b.*\|\s*(?:sh|bash)\b/,
  /\bwget\b.*\|\s*(?:sh|bash)\b/,
];

function kv(env: AppEnv): KVNamespace {
  if (!env.TENANTS) {
    throw new BadRequestError('Tunnel endpoints require the TENANTS KV binding.');
  }
  return env.TENANTS;
}

export function endpointsEnabled(env: AppEnv): boolean {
  return !!env.TENANTS;
}

export async function getEndpoint(env: AppEnv, id: string): Promise<EndpointRecord | null> {
  return (await kv(env).get(`endpoint:${id}`, 'json')) as EndpointRecord | null;
}

export async function putEndpoint(env: AppEnv, endpoint: EndpointRecord): Promise<void> {
  await kv(env).put(`endpoint:${endpoint.id}`, JSON.stringify(endpoint));
}

export async function listEndpoints(env: AppEnv): Promise<EndpointRecord[]> {
  const out: EndpointRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv(env).list({ prefix: 'endpoint:', cursor });
    for (const key of page.keys) {
      const endpoint = (await kv(env).get(key.name, 'json')) as EndpointRecord | null;
      if (endpoint) {
        out.push(endpoint);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

export async function getCommandPolicy(env: AppEnv, id: string): Promise<CommandPolicy | null> {
  return (await kv(env).get(`command-policy:${id}`, 'json')) as CommandPolicy | null;
}

export async function putCommandPolicy(env: AppEnv, policy: CommandPolicy): Promise<void> {
  await kv(env).put(`command-policy:${policy.id}`, JSON.stringify(policy));
}

async function listCommandPolicies(env: AppEnv): Promise<CommandPolicy[]> {
  const out: CommandPolicy[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv(env).list({ prefix: 'command-policy:', cursor });
    for (const key of page.keys) {
      const policy = (await kv(env).get(key.name, 'json')) as CommandPolicy | null;
      if (policy) {
        out.push(policy);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

export async function routeEndpointApi(
  request: Request,
  env: AppEnv,
  principal: DevicePrincipal
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith('/api/endpoints') && !path.startsWith('/api/command-policies')) {
    return undefined;
  }
  if (!endpointsEnabled(env)) {
    return errorResponse(501, 'not_supported', 'Tunnel endpoints require the TENANTS KV binding.');
  }
  requireAdmin(principal, 'Managing tunnel endpoints');

  if (path === '/api/endpoints') {
    if (request.method === 'GET') {
      return json({ endpoints: await listEndpoints(env) });
    }
    if (request.method === 'POST') {
      const endpoint = normalizeEndpointInput(await readJson(request));
      await putEndpoint(env, endpoint);
      return json({ endpoint }, { status: 201 });
    }
  }

  const endpointMatch = /^\/api\/endpoints\/([^/]+)$/.exec(path);
  if (endpointMatch) {
    const id = decodeURIComponent(endpointMatch[1] ?? '');
    const existing = await getEndpoint(env, id);
    if (!existing) {
      throw new NotFoundError(`Endpoint '${id}' not found.`);
    }
    if (request.method === 'GET') {
      return json({ endpoint: existing });
    }
    if (request.method === 'PUT') {
      const endpoint = normalizeEndpointInput(await readJson(request), existing);
      await putEndpoint(env, endpoint);
      return json({ endpoint });
    }
    if (request.method === 'DELETE') {
      const revoked = { ...existing, status: 'revoked' as const, updatedAt: new Date().toISOString() };
      await putEndpoint(env, revoked);
      return json({ endpoint: revoked });
    }
  }

  if (path === '/api/command-policies') {
    if (request.method === 'GET') {
      return json({ policies: await listCommandPolicies(env) });
    }
    if (request.method === 'POST') {
      const policy = normalizeCommandPolicyInput(await readJson(request));
      await putCommandPolicy(env, policy);
      return json({ policy }, { status: 201 });
    }
  }

  const policyMatch = /^\/api\/command-policies\/([^/]+)$/.exec(path);
  if (policyMatch) {
    const id = decodeURIComponent(policyMatch[1] ?? '');
    const existing = await getCommandPolicy(env, id);
    if (!existing) {
      throw new NotFoundError(`Command policy '${id}' not found.`);
    }
    if (request.method === 'GET') {
      return json({ policy: existing });
    }
    if (request.method === 'PUT') {
      const policy = normalizeCommandPolicyInput(await readJson(request), existing);
      await putCommandPolicy(env, policy);
      return json({ policy });
    }
    if (request.method === 'DELETE') {
      await kv(env).delete(`command-policy:${id}`);
      return json({ ok: true });
    }
  }

  return errorResponse(404, 'not_found', 'API route not found.');
}

export async function routeTunnelApi(
  request: Request,
  env: AppEnv,
  broker?: TunnelBroker
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/tunnel/')) {
    return undefined;
  }
  if (!endpointsEnabled(env)) {
    return errorResponse(501, 'not_supported', 'Tunnel endpoints require the TENANTS KV binding.');
  }
  if (request.method !== 'POST') {
    return errorResponse(405, 'method_not_allowed', 'Use POST for tunnel control-plane calls.');
  }

  if (url.pathname === '/tunnel/connect') {
    const endpoint = await assertEndpointSession(request, env);
    const connected = await broker?.connect?.(endpoint);
    const nowIso = new Date().toISOString();
    const sessionId = connected?.sessionId ?? crypto.randomUUID();
    const updated = { ...endpoint, status: 'online' as const, sessionId, lastSeenAt: nowIso, updatedAt: nowIso };
    await putEndpoint(env, updated);
    return json({ ok: true, endpointId: endpoint.id, sessionId, capabilities: endpoint.capabilities });
  }

  if (url.pathname === '/tunnel/heartbeat') {
    const body = await readJson(request);
    const endpoint = await requireSession(env, body);
    await broker?.heartbeat?.(endpoint);
    const nowIso = new Date().toISOString();
    await putEndpoint(env, { ...endpoint, lastSeenAt: nowIso, updatedAt: nowIso });
    return json({ ok: true, endpointId: endpoint.id });
  }

  if (url.pathname === '/tunnel/capabilities') {
    const body = await readJson(request);
    const endpoint = await requireSession(env, body);
    const reported = parseCapabilities(body.capabilities, endpoint.capabilities);
    if (reported.some((capability) => !endpoint.capabilities.includes(capability))) {
      throw new ForbiddenError('Endpoint cannot report capabilities outside its registered maximum.');
    }
    const nowIso = new Date().toISOString();
    await putEndpoint(env, { ...endpoint, activeCapabilities: reported, lastSeenAt: nowIso, updatedAt: nowIso });
    return json({ ok: true, endpointId: endpoint.id, capabilities: reported });
  }

  return errorResponse(404, 'not_found', 'Tunnel route not found.');
}

export async function routeDeviceHtbp(args: {
  env: AppEnv;
  principal: DevicePrincipal;
  segments: string[];
  isHelp: boolean;
  accept: string;
  input?: unknown;
  traceId: string;
  broker?: TunnelBroker;
}): Promise<DeviceRouteResult> {
  const { env, principal, segments, isHelp, input, traceId, broker } = args;
  if (segments[0] !== '~device') {
    throw new NotFoundError('Device route not found.');
  }

  if (segments.length === 1) {
    if (!isHelp) {
      throw new BadRequestError('Device root is describe-only; select /~device/{id}/{tool}.');
    }
    return {
      response: json(await deviceRootHelp(env, principal), { headers: { 'Cache-Control': 'private, max-age=30' } }),
      audit: {},
    };
  }

  const endpointId = segments[1];
  const endpoint = await getEndpoint(env, endpointId);
  if (!endpoint || endpoint.status === 'revoked') {
    throw new NotFoundError(`Endpoint '${endpointId}' not found.`);
  }
  assertDeviceGrant(principal, endpoint);
  if (segments.length > 3) {
    throw new NotFoundError(`Device path '/${segments.join('/')}' not found.`);
  }

  const toolFromPath = segments[2] as DeviceTool | undefined;
  const tool = toolFromPath ?? toolFromBody(input);
  const audit = { tool, provider: endpoint.providerId, effect: effectFor(tool), scope: scopeFor(tool) };

  if (isHelp) {
    const response = toolFromPath
      ? json(deviceToolHelp(endpoint, toolFromPath), { headers: { 'Cache-Control': 'private, max-age=30' } })
      : json(deviceEndpointHelp(endpoint), { headers: { 'Cache-Control': 'private, max-age=30' } });
    return { response, audit, tenantId: endpoint.tenantId };
  }

  if (!tool) {
    throw new BadRequestError('Device calls require a tool path or a body.tool field.');
  }
  if (tool === ('shell.run' as DeviceTool)) {
    throw new ForbiddenError('shell.run is not exposed by default.');
  }
  if (!DEVICE_TOOLS.includes(tool)) {
    throw new NotFoundError(`Device tool '${tool}' is not exposed.`);
  }
  if (!exposedCapabilities(endpoint).includes(tool)) {
    throw new NotFoundError(`Device endpoint '${endpoint.id}' does not expose '${tool}'.`);
  }
  if (endpoint.status !== 'online' || !endpoint.sessionId || !broker) {
    throw new EndpointUnavailableError(`Endpoint '${endpoint.id}' is offline.`);
  }

  const prepared = await prepareDeviceInput(env, endpoint, tool, input);
  emitAuditSummary({ endpointId: endpoint.id, tool, traceId });
  const result = await broker.dispatch(endpoint, {
    endpointId: endpoint.id,
    sessionId: endpoint.sessionId,
    tool,
    traceId,
    input: prepared.input,
    deadlineMs: prepared.deadlineMs,
    maxOutputBytes: prepared.maxOutputBytes,
  });
  return {
    response: json({ resource: `/htbp/${segments.join('/')}`, result }),
    audit,
    tenantId: endpoint.tenantId,
  };
}

async function deviceRootHelp(env: AppEnv, principal: DevicePrincipal): Promise<HelpPayload> {
  const endpoints = (await listEndpoints(env)).filter(
    (endpoint) =>
      endpoint.status !== 'revoked' &&
      (principal.isAdmin || !endpoint.tenantId || endpoint.tenantId === principal.tenantId)
  );
  return {
    htbp: 'draft',
    kind: 'directory',
    title: 'Devices',
    cachable: false,
    resources: endpoints.map((endpoint) => ({
      name: endpoint.id,
      path: `./${encodeURIComponent(endpoint.id)}`,
      description: endpoint.label,
    })),
  };
}

function deviceEndpointHelp(endpoint: EndpointRecord): HelpPayload {
  return {
    htbp: 'draft',
    kind: 'builtin',
    title: endpoint.label ?? endpoint.id,
    description: `${endpoint.kind} endpoint (${endpoint.status})`,
    cachable: false,
    resources: exposedCapabilities(endpoint).map(toResource),
  };
}

function deviceToolHelp(endpoint: EndpointRecord, tool: DeviceTool): HelpPayload {
  if (!exposedCapabilities(endpoint).includes(tool)) {
    throw new NotFoundError(`Device endpoint '${endpoint.id}' does not expose '${tool}'.`);
  }
  return {
    htbp: 'draft',
    kind: 'builtin',
    title: tool,
    cachable: false,
    endpoint: {
      method: 'POST',
      inputSchema: inputSchemaFor(tool),
      outputSchema: { type: 'object' },
      effect: effectFor(tool),
      scope: scopeFor(tool),
    },
  };
}

function toResource(tool: DeviceTool): ResourceRef {
  return {
    name: tool,
    path: `./${encodeURIComponent(tool)}`,
    description:
      tool === 'exec.run'
        ? 'Run a structured argv command'
        : tool === 'fs.read'
          ? 'Read a file from the endpoint'
          : 'Tail endpoint logs',
  };
}

function exposedCapabilities(endpoint: EndpointRecord): DeviceTool[] {
  return endpoint.activeCapabilities ?? endpoint.capabilities;
}

function inputSchemaFor(tool: DeviceTool): unknown {
  if (tool === 'exec.run') {
    return {
      type: 'object',
      required: ['argv'],
      properties: {
        argv: { type: 'array', items: { type: 'string' }, minItems: 1 },
        cwd: { type: 'string' },
        timeoutMs: { type: 'number' },
        maxOutputBytes: { type: 'number' },
      },
    };
  }
  if (tool === 'fs.read') {
    return { type: 'object', required: ['path'], properties: { path: { type: 'string' }, maxBytes: { type: 'number' } } };
  }
  return { type: 'object', properties: { stream: { type: 'string' }, lines: { type: 'number' } } };
}

function effectFor(tool: DeviceTool | undefined): 'read' | 'destructive' | undefined {
  if (!tool) {
    return undefined;
  }
  return tool === 'exec.run' ? 'destructive' : 'read';
}

function scopeFor(tool: DeviceTool | undefined): string | undefined {
  if (!tool) {
    return undefined;
  }
  return tool === 'exec.run' ? 'device:exec' : tool === 'fs.read' ? 'device:fs.read' : 'device:logs.tail';
}

function requireAdmin(principal: DevicePrincipal, what: string): void {
  if (!principal.isAdmin) {
    throw new ForbiddenError(`${what} requires an admin key.`);
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const value = (await request.json().catch(() => undefined)) as unknown;
  if (!isRecord(value)) {
    throw new BadRequestError('Request body must be a JSON object.');
  }
  return value;
}

function normalizeEndpointInput(value: Record<string, unknown>, existing?: EndpointRecord): EndpointRecord {
  const id = stringField(value, 'id') ?? existing?.id;
  if (!id || !ENDPOINT_ID_PATTERN.test(id)) {
    throw new BadRequestError(`Endpoint id must match ${ENDPOINT_ID_PATTERN}.`);
  }
  const nowIso = new Date().toISOString();
  const capabilities = parseCapabilities(value.capabilities, existing?.capabilities ?? ['exec.run']);
  const kindRaw = stringField(value, 'kind') ?? existing?.kind ?? 'generic';
  const kind = parseEndpointKind(kindRaw);
  const statusRaw = stringField(value, 'status') ?? existing?.status ?? 'offline';
  const status =
    statusRaw === 'online' || statusRaw === 'offline' || statusRaw === 'revoked' ? statusRaw : existing?.status ?? 'offline';
  return {
    id,
    tenantId: stringField(value, 'tenantId') ?? existing?.tenantId,
    providerId: stringField(value, 'providerId') ?? existing?.providerId,
    kind,
    label: stringField(value, 'label') ?? existing?.label,
    capabilities,
    activeCapabilities: existing?.activeCapabilities,
    status,
    commandPolicyId: stringField(value, 'commandPolicyId') ?? existing?.commandPolicyId,
    sessionId: existing?.sessionId,
    lastSeenAt: existing?.lastSeenAt,
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
}

function normalizeCommandPolicyInput(value: Record<string, unknown>, existing?: CommandPolicy): CommandPolicy {
  const id = stringField(value, 'id') ?? existing?.id;
  if (!id || !POLICY_ID_PATTERN.test(id)) {
    throw new BadRequestError(`Command policy id must match ${POLICY_ID_PATTERN}.`);
  }
  const nowIso = new Date().toISOString();
  const defaultMode = value.defaultMode === 'deny' || value.defaultMode === 'allow' ? value.defaultMode : existing?.defaultMode ?? 'allow';
  return {
    id,
    defaultMode,
    allowCommands: arrayOfStrings(value.allowCommands) ?? existing?.allowCommands,
    denyCommands: arrayOfStrings(value.denyCommands) ?? existing?.denyCommands,
    denyPatterns: arrayOfStrings(value.denyPatterns) ?? existing?.denyPatterns,
    allowShell: typeof value.allowShell === 'boolean' ? value.allowShell : existing?.allowShell,
    allowedCwdPrefixes: arrayOfStrings(value.allowedCwdPrefixes) ?? existing?.allowedCwdPrefixes,
    maxTimeoutMs: positiveNumber(value.maxTimeoutMs) ?? existing?.maxTimeoutMs,
    maxOutputBytes: positiveNumber(value.maxOutputBytes) ?? existing?.maxOutputBytes,
    requireConfirmFor: arrayOfStrings(value.requireConfirmFor) ?? existing?.requireConfirmFor,
    envAllowlist: arrayOfStrings(value.envAllowlist) ?? existing?.envAllowlist,
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
}

function parseCapabilities(value: unknown, fallback: DeviceTool[]): DeviceTool[] {
  const raw = Array.isArray(value) ? value : fallback;
  const tools = raw.filter((item): item is DeviceTool => typeof item === 'string' && DEVICE_TOOLS.includes(item as DeviceTool));
  if (tools.length === 0) {
    throw new BadRequestError('Endpoint capabilities must include at least one supported device tool.');
  }
  return [...new Set(tools)];
}

function parseEndpointKind(value: string): EndpointKind {
  if (['sandbox', 'k8s-pod', 'pc', 'browser-host', 'mobile', 'generic'].includes(value)) {
    return value as EndpointKind;
  }
  throw new BadRequestError(`Unsupported endpoint kind '${value}'.`);
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

async function assertEndpointSession(request: Request, env: AppEnv): Promise<EndpointRecord> {
  const body = await readJson(request);
  const endpointId = stringField(body, 'endpointId') ?? request.headers.get('X-TB-Endpoint-Id') ?? undefined;
  if (!endpointId) {
    throw new BadRequestError('endpointId is required.');
  }
  const endpoint = await getEndpoint(env, endpointId);
  if (!endpoint) {
    throw new NotFoundError(`Endpoint '${endpointId}' not found.`);
  }
  if (endpoint.status === 'revoked') {
    throw new ForbiddenError(`Endpoint '${endpointId}' is revoked.`);
  }
  return endpoint;
}

async function requireSession(env: AppEnv, body: Record<string, unknown>): Promise<EndpointRecord> {
  const endpointId = stringField(body, 'endpointId');
  const sessionId = stringField(body, 'sessionId');
  if (!endpointId || !sessionId) {
    throw new BadRequestError('endpointId and sessionId are required.');
  }
  const endpoint = await getEndpoint(env, endpointId);
  if (!endpoint || endpoint.status === 'revoked') {
    throw new NotFoundError(`Endpoint '${endpointId}' not found.`);
  }
  if (endpoint.sessionId !== sessionId) {
    throw new ForbiddenError('Endpoint session is invalid.');
  }
  return endpoint;
}

function assertDeviceGrant(principal: DevicePrincipal, endpoint: EndpointRecord): void {
  if (principal.isAdmin) {
    return;
  }
  if (endpoint.tenantId && principal.tenantId === endpoint.tenantId) {
    return;
  }
  throw new NotFoundError(`Endpoint '${endpoint.id}' not found.`);
}

async function prepareDeviceInput(
  env: AppEnv,
  endpoint: EndpointRecord,
  tool: DeviceTool,
  input: unknown
): Promise<{ input: Record<string, unknown>; deadlineMs: number; maxOutputBytes: number }> {
  const args = extractArguments(input);
  if (tool === 'exec.run') {
    return prepareExecInput(env, endpoint, args);
  }
  if (tool === 'fs.read') {
    const path = stringField(args, 'path');
    if (!path) {
      throw new BadRequestError('fs.read requires path.');
    }
    const maxOutputBytes = Math.min(positiveNumber(args.maxBytes) ?? DEFAULT_MAX_OUTPUT_BYTES, DEFAULT_MAX_OUTPUT_BYTES);
    return { input: { path, maxBytes: maxOutputBytes }, deadlineMs: DEFAULT_TIMEOUT_MS, maxOutputBytes };
  }
  const lines = Math.min(Math.max(positiveNumber(args.lines) ?? 100, 1), 1000);
  return {
    input: { stream: stringField(args, 'stream') ?? 'default', lines },
    deadlineMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  };
}

async function prepareExecInput(
  env: AppEnv,
  endpoint: EndpointRecord,
  args: Record<string, unknown>
): Promise<{ input: Record<string, unknown>; deadlineMs: number; maxOutputBytes: number }> {
  const argv = arrayOfStrings(args.argv);
  if (!argv || argv.length === 0 || argv.some((part) => part.length === 0)) {
    throw new BadRequestError('exec.run requires non-empty argv: string[].');
  }
  const policy = endpoint.commandPolicyId ? await getCommandPolicy(env, endpoint.commandPolicyId) : null;
  enforceCommandPolicy(argv, args, policy);
  const maxTimeout = policy?.maxTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutput = policy?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const timeoutMs = Math.min(positiveNumber(args.timeoutMs) ?? DEFAULT_TIMEOUT_MS, maxTimeout);
  const maxOutputBytes = Math.min(positiveNumber(args.maxOutputBytes) ?? DEFAULT_MAX_OUTPUT_BYTES, maxOutput);
  const input: Record<string, unknown> = { argv, timeoutMs, maxOutputBytes };
  const cwd = stringField(args, 'cwd');
  if (cwd) {
    input.cwd = cwd;
  }
  return { input, deadlineMs: timeoutMs, maxOutputBytes };
}

function enforceCommandPolicy(argv: string[], args: Record<string, unknown>, policy: CommandPolicy | null): void {
  const cmd = argv[0];
  const joined = argv.join(' ');
  if (GLOBAL_DENY_COMMANDS.has(cmd)) {
    throw new ForbiddenError(`Command '${cmd}' is denied by the global policy.`);
  }
  if (GLOBAL_DENY_PATTERNS.some((pattern) => pattern.test(joined))) {
    throw new ForbiddenError('Command is denied by the global policy.');
  }
  if (policy?.denyCommands?.includes(cmd)) {
    throw new ForbiddenError(`Command '${cmd}' is denied by policy '${policy.id}'.`);
  }
  if (policy?.denyPatterns?.some((pattern) => new RegExp(pattern).test(joined))) {
    throw new ForbiddenError(`Command is denied by policy '${policy.id}'.`);
  }
  if (policy?.allowCommands && !policy.allowCommands.includes(cmd)) {
    throw new ForbiddenError(`Command '${cmd}' is not allowed by policy '${policy.id}'.`);
  }
  if (policy?.defaultMode === 'deny' && !policy.allowCommands?.includes(cmd)) {
    throw new ForbiddenError(`Command '${cmd}' is not allowed by policy '${policy.id}'.`);
  }
  const cwd = stringField(args, 'cwd');
  if (cwd && policy?.allowedCwdPrefixes && !policy.allowedCwdPrefixes.some((prefix) => cwd.startsWith(prefix))) {
    throw new ForbiddenError(`cwd '${cwd}' is outside policy '${policy.id}'.`);
  }
}

function extractArguments(input: unknown): Record<string, unknown> {
  if (isRecord(input) && isRecord(input.arguments)) {
    return input.arguments;
  }
  return isRecord(input) ? input : {};
}

function toolFromBody(input: unknown): DeviceTool | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  const raw = stringField(input, 'tool');
  return raw && DEVICE_TOOLS.includes(raw as DeviceTool) ? (raw as DeviceTool) : undefined;
}

function emitAuditSummary(_event: { endpointId: string; tool: DeviceTool; traceId: string }): void {
  // Placeholder for SPEC-006/SPEC-005 integration. The caller's normal HTBP
  // audit event records the summary; command output is never captured here.
}
