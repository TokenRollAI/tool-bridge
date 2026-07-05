// Minimal platform audit trail (TASK-M4, SPEC-001 §6.8, SPEC-005 预留).
//
// Answers: who called what, when, under which grant decision, with what
// result. One structured event per HTBP describe/call — including denied
// (401/403) and hidden-resource (404) decisions, which carry only the
// requested path, never metadata about what exists there.
//
// Redaction red lines (§6.8 / TASK-M4): events never contain API keys,
// credentials, raw tokens, header values, or request/response payloads. The
// only input-derived fields are the byte count and the top-level JSON key
// names; results are recorded as status/latency only.
//
// Storage: KV `audit:{tenantId|_global}:{invertedTs}:{rand}` with a TTL
// (AUDIT_TTL_SECONDS, default 7 days). The inverted timestamp makes a prefix
// list return newest-first. Disabled when the TENANTS binding is absent or
// AUDIT_MODE=off.

import { errorResponse } from './errors';
import { findNode } from './registry';
import { AppEnv, DirectoryNode } from './types';
import { isRecord, json } from './util';

export interface AuditActor {
  principal: string; // agent | provider | host | admin | service | static-bearer | oauth | anonymous
  subject?: string;
  onBehalfOf?: string; // X-TB-On-Behalf-Of annotation (never a credential)
}

export interface AuditEvent {
  ts: string;
  traceId: string;
  action: 'describe' | 'call';
  actor: AuditActor;
  tenantId?: string;
  path: string; // requested /htbp path
  tool?: string; // adapter sub-path (tool / endpoint name) when present
  provider?: string; // providerId when the node came from a placement
  effect?: string; // declared semantics, when statically known
  scope?: string;
  decision: 'allow' | 'deny' | 'not_found';
  result: 'ok' | 'error';
  status: number;
  errorCode?: string; // normalized platform error code on error events
  latencyMs: number;
  reason?: string; // X-TB-Reason annotation passthrough
  input?: { bytes: number; keys?: string[] }; // redacted summary, never values
  // Reserved for SPEC-005 quota/metering; M4 defines the field, never fills it.
  usage?: { requests?: number; inputBytes?: number; outputBytes?: number };
}

const DEFAULT_TTL_SECONDS = 7 * 24 * 3600;
// Far-future millisecond bound used to invert timestamps for newest-first sort.
const TS_BOUND = 10_000_000_000_000;

export function auditEnabled(env: AppEnv): boolean {
  return !!env.TENANTS && (env as { AUDIT_MODE?: string }).AUDIT_MODE !== 'off';
}

export function traceIdOf(request: Request): string {
  const incoming = request.headers.get('X-TB-Trace-Id');
  // Accept a sane external trace id; otherwise mint one.
  if (incoming && /^[A-Za-z0-9._-]{1,128}$/.test(incoming)) {
    return incoming;
  }
  return crypto.randomUUID();
}

// Redacted input summary: byte count + top-level key names only. Values are
// never inspected beyond JSON structure and never persisted.
export function inputSummary(input: unknown): { bytes: number; keys?: string[] } | undefined {
  if (input === undefined) {
    return undefined;
  }
  let bytes = 0;
  try {
    bytes = JSON.stringify(input)?.length ?? 0;
  } catch {
    bytes = 0;
  }
  return {
    bytes,
    keys: isRecord(input) ? Object.keys(input).slice(0, 32) : undefined,
  };
}

export function auditScope(tenantId: string | undefined): string {
  return tenantId ?? '_global';
}

// Statically derivable call context for an event: the adapter sub-path (tool /
// endpoint), the placement provenance (provider id, tagged at materialization)
// and any DECLARED effect/scope semantics. Upstream-derived semantics are
// deliberately not fetched — audit must never add an upstream round trip.
export interface AuditCallContext {
  tool?: string;
  provider?: string;
  effect?: string;
  scope?: string;
}

export function auditContextFor(root: DirectoryNode, segments: string[]): AuditCallContext {
  const found = findNode(root, segments);
  if (!found) {
    return {};
  }
  const node = found.node;
  const context: AuditCallContext = {
    tool: found.sub.length > 0 ? found.sub.join('/') : undefined,
    provider: (node as unknown as { tbProviderId?: string }).tbProviderId,
  };
  const first = found.sub[0];
  if (first) {
    if (node.kind === 'http') {
      const endpoint = node.endpoints.find((item) => item.name === first);
      context.effect = endpoint?.effect;
      context.scope = endpoint?.scope;
    } else if (node.kind === 'builtin') {
      const tool = node.tools.find((item) => item.name === first);
      context.effect = tool?.effect;
      context.scope = tool?.scope;
    } else if (node.kind === 'mcp') {
      const override = node.toolOverrides?.[first];
      context.effect = override?.effect;
      context.scope = override?.scope;
    }
  }
  return context;
}

// Best-effort extraction of the normalized error code from an already-built
// envelope response (for the audit event; the response itself is untouched).
export async function errorCodeOf(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.clone().json()) as { error?: { code?: unknown } };
    return typeof body?.error?.code === 'string' ? body.error.code : undefined;
  } catch {
    return undefined;
  }
}

export async function writeAuditEvent(env: AppEnv, event: AuditEvent): Promise<void> {
  if (!auditEnabled(env)) {
    return;
  }
  const kv = env.TENANTS as KVNamespace;
  const invTs = String(TS_BOUND - Date.parse(event.ts)).padStart(14, '0');
  const rand = crypto.randomUUID().slice(0, 8);
  const ttlRaw = Number((env as { AUDIT_TTL_SECONDS?: string }).AUDIT_TTL_SECONDS);
  const ttl = Number.isFinite(ttlRaw) && ttlRaw >= 60 ? ttlRaw : DEFAULT_TTL_SECONDS;
  await kv.put(`audit:${auditScope(event.tenantId)}:${invTs}:${rand}`, JSON.stringify(event), {
    expirationTtl: ttl,
  });
}

// Emit without blocking the response when an ExecutionContext is available;
// await inline otherwise (tests, non-Workers hosts) so writes are deterministic.
export function emitAuditEvent(env: AppEnv, ctx: ExecutionContext | undefined, event: AuditEvent): Promise<void> {
  const write = writeAuditEvent(env, event).catch(() => {
    // Audit must never break the data plane.
  });
  if (ctx?.waitUntil) {
    ctx.waitUntil(write);
    return Promise.resolve();
  }
  return write;
}

// ---- Query API ----

export interface AuditQueryPrincipal {
  isAdmin: boolean;
  tenantId?: string;
  principal?: string;
}

// GET /api/audit/events?limit=&tenant= — newest first. Admin may query any
// scope (or all); tenant-bound keys are forced to their own tenant's scope.
export async function routeAuditApi(
  request: Request,
  env: AppEnv,
  principal: AuditQueryPrincipal
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/audit/events') {
    return undefined;
  }
  if (request.method !== 'GET') {
    return errorResponse(405, 'method_not_allowed', 'Use GET /api/audit/events.');
  }
  if (!auditEnabled(env)) {
    return errorResponse(501, 'not_supported', 'Audit requires the TENANTS KV binding.');
  }
  if (!principal.isAdmin && !principal.tenantId) {
    return errorResponse(403, 'Forbidden', 'Audit query requires an admin or tenant-bound key.');
  }

  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);
  const requested = url.searchParams.get('tenant') ?? undefined;
  // Non-admins can only read their own tenant's events.
  const scope = principal.isAdmin ? requested : auditScope(principal.tenantId);
  const prefix = scope ? `audit:${scope}:` : 'audit:';

  const kv = env.TENANTS as KVNamespace;
  const events: AuditEvent[] = [];
  let cursor: string | undefined;
  while (events.length < limit) {
    const page = await kv.list({ prefix, cursor, limit: Math.min(limit - events.length, 100) });
    for (const key of page.keys) {
      const event = (await kv.get(key.name, 'json')) as AuditEvent | null;
      if (event) {
        events.push(event);
      }
      if (events.length >= limit) {
        break;
      }
    }
    if (page.list_complete) {
      break;
    }
    cursor = page.cursor;
  }
  return json({ scope: scope ?? 'all', events });
}
