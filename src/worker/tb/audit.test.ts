// M4 audit conformance: emitted event fields, denied/hidden decisions,
// normalized error codes + traceId, redaction red lines, query API scoping.

import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../index';
import { AuditEvent } from './audit';
import { sha256Hex } from './tenant';
import { fakeKV, FakeKV } from './testing/fake-kv';
import { AppEnv } from './types';

type WorkerRequest = Parameters<typeof worker.fetch>[0];

const nowIso = '2026-07-04T00:00:00.000Z';

async function auditEnv(): Promise<{ env: AppEnv; kv: FakeKV }> {
  const kv = fakeKV({
    'tenant:a': JSON.stringify({ type: 'directory', id: 'root', title: 'A', children: [] }),
    'tenant:b': JSON.stringify({ type: 'directory', id: 'root', title: 'B', children: [] }),
    [`apikey:${await sha256Hex('tbk_admin')}`]: JSON.stringify({ principal: 'admin', label: 'root-admin' }),
    [`apikey:${await sha256Hex('tbk_agent_a')}`]: JSON.stringify({ tenantId: 'a', label: 'agent-a' }),
    [`apikey:${await sha256Hex('tbk_agent_b')}`]: JSON.stringify({ tenantId: 'b', label: 'agent-b' }),
    [`apikey:${await sha256Hex('tbp_prov')}`]: JSON.stringify({ principal: 'provider', providerId: 'acme' }),
    'provider:acme': JSON.stringify({
      id: 'acme',
      displayName: 'Acme',
      trustTier: 'community',
      status: 'active',
      createdAt: nowIso,
      updatedAt: nowIso,
    }),
    'pub:acme:search': JSON.stringify({
      providerId: 'acme',
      pubId: 'search',
      version: '1.0.0',
      binding: {
        type: 'http',
        endpoints: [{ name: 'query', method: 'POST', url: 'https://api.acme.dev/q', effect: 'read', scope: 'q:read' }],
      },
      status: 'published',
      createdAt: nowIso,
      updatedAt: nowIso,
    }),
    'placement:a:plc_1': JSON.stringify({
      id: 'plc_1',
      tenantId: 'a',
      path: 'tools/search',
      pubRef: { providerId: 'acme', pubId: 'search' },
      enabled: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    }),
  });
  return { kv, env: { TENANTS: kv, TENANT_MODE: 'true', MCP_SERVERS_JSON: '{}' } as unknown as AppEnv };
}

function call(env: AppEnv) {
  return (path: string, init?: RequestInit, token?: string) => {
    const headers = new Headers(init?.headers);
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    return worker.fetch(
      new Request(`https://bridge.example.com${path}`, { ...init, headers }) as unknown as WorkerRequest,
      env
    );
  };
}

function storedEvents(kv: FakeKV, scope: string): AuditEvent[] {
  return Object.entries(kv.dump())
    .filter(([key]) => key.startsWith(`audit:${scope}:`))
    .sort(([a], [b]) => (a < b ? -1 : 1)) // inverted ts: lexicographic == newest first
    .map(([, value]) => JSON.parse(value) as AuditEvent);
}

afterEach(() => vi.restoreAllMocks());

describe('every describe and call emits a structured event', () => {
  it('records actor/tenant/path/tool/provider/effect/scope/decision/result/status/traceId/latency', async () => {
    const { env, kv } = await auditEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    );
    const request = call(env);

    const help = await request('/htbp/tools/search/~help', { headers: { Accept: 'application/json' } }, 'tbk_agent_a');
    expect(help.status).toBe(200);
    expect(help.headers.get('X-TB-Trace-Id')).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 3));
    const invoke = await request(
      '/htbp/tools/search/query',
      { method: 'POST', body: JSON.stringify({ q: 'htbp' }) },
      'tbk_agent_a'
    );
    expect(invoke.status).toBe(200);

    const events = storedEvents(kv, 'a');
    expect(events).toHaveLength(2);
    const [callEvent, describeEvent] = events; // newest first

    expect(describeEvent).toMatchObject({
      action: 'describe',
      actor: { principal: 'agent', subject: 'agent-a' },
      tenantId: 'a',
      path: '/htbp/tools/search/~help',
      provider: 'acme',
      decision: 'allow',
      result: 'ok',
      status: 200,
    });
    expect(callEvent).toMatchObject({
      action: 'call',
      path: '/htbp/tools/search/query',
      tool: 'query',
      provider: 'acme',
      effect: 'read',
      scope: 'q:read',
      decision: 'allow',
      result: 'ok',
      status: 200,
    });
    expect(typeof callEvent.latencyMs).toBe('number');
    expect(callEvent.traceId).toBeTruthy();
    // Reserved SPEC-005 field stays unpopulated in M4.
    expect(callEvent.usage).toBeUndefined();
  });
});

describe('denied and hidden decisions are auditable without leaking metadata', () => {
  it('401 / 403 / 404 each produce an event carrying only the requested path', async () => {
    const { env, kv } = await auditEnv();
    const request = call(env);

    expect((await request('/htbp/tools/search/~help', {})).status).toBe(401); // no key
    expect((await request('/htbp/~help', {}, 'tbp_prov')).status).toBe(403); // control-plane-only key
    expect((await request('/htbp/hidden/thing', { method: 'POST', body: '{}' }, 'tbk_agent_a')).status).toBe(404);

    const globalEvents = storedEvents(kv, '_global');
    expect(globalEvents.map((e) => [e.decision, e.status]).sort()).toEqual([
      ['deny', 401],
      ['deny', 403],
    ]);
    expect(globalEvents.every((e) => e.provider === undefined && e.tool === undefined)).toBe(true);

    const tenantEvents = storedEvents(kv, 'a');
    expect(tenantEvents[0]).toMatchObject({
      decision: 'not_found',
      status: 404,
      errorCode: 'not_found',
      path: '/htbp/hidden/thing',
    });
  });
});

describe('error events carry the normalized code and trace id', () => {
  it('upstream failure -> errorCode UpstreamError; incoming X-TB-Trace-Id is honored', async () => {
    const { env, kv } = await auditEnv();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('ECONNREFUSED'))));
    const response = await call(env)(
      '/htbp/tools/search/query',
      { method: 'POST', body: '{}', headers: { 'X-TB-Trace-Id': 'trace-e2e-1' } },
      'tbk_agent_a'
    );
    expect(response.status).toBe(502);
    expect(response.headers.get('X-TB-Trace-Id')).toBe('trace-e2e-1');

    const [event] = storedEvents(kv, 'a');
    expect(event).toMatchObject({
      result: 'error',
      status: 502,
      errorCode: 'UpstreamError',
      traceId: 'trace-e2e-1',
      decision: 'allow', // authorized, then failed upstream
    });
  });
});

describe('redaction red lines', () => {
  it('never persists key material, header values, or raw inputs', async () => {
    const { env, kv } = await auditEnv();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    await call(env)(
      '/htbp/tools/search/query',
      {
        method: 'POST',
        body: JSON.stringify({
          apiKey: 'tbk_supersecret_value',
          nested: { Authorization: 'Bearer super-secret-token' },
          q: 'plain-query-probe',
        }),
      },
      'tbk_agent_a'
    );

    const serialized = JSON.stringify(storedEvents(kv, 'a'));
    // Neither the caller's key nor any input value survives into the event.
    expect(serialized).not.toContain('tbk_agent_a');
    expect(serialized).not.toContain('tbk_supersecret_value');
    expect(serialized).not.toContain('super-secret-token');
    expect(serialized).not.toContain('plain-query-probe');

    const [event] = storedEvents(kv, 'a');
    // Only the redacted summary: byte count + top-level key names.
    expect(event.input?.keys).toEqual(['apiKey', 'nested', 'q']);
    expect(event.input?.bytes).toBeGreaterThan(0);
  });
});

describe('query API', () => {
  it('admin reads any scope; tenant keys are forced to their own; providers are refused', async () => {
    const { env } = await auditEnv();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const request = call(env);
    await request('/htbp/tools/search/query', { method: 'POST', body: '{}' }, 'tbk_agent_a');

    const admin = await request('/api/audit/events?tenant=a&limit=10', {}, 'tbk_admin');
    expect(admin.status).toBe(200);
    const adminBody = (await admin.json()) as { scope: string; events: AuditEvent[] };
    expect(adminBody.events.length).toBeGreaterThan(0);

    // Tenant b sees its own (empty) scope even when asking for tenant a.
    const tenantB = await request('/api/audit/events?tenant=a', {}, 'tbk_agent_b');
    const tenantBBody = (await tenantB.json()) as { scope: string; events: AuditEvent[] };
    expect(tenantBBody.scope).toBe('b');
    expect(tenantBBody.events).toHaveLength(0);

    const provider = await request('/api/audit/events', {}, 'tbp_prov');
    expect(provider.status).toBe(403);
  });
});
