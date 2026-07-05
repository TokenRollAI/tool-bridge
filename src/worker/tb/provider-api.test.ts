// M3 management-plane conformance: /api/providers/**, tbp_ ownership scoping,
// placement dry-run, /api/servers compat translation — exercised end-to-end
// through the worker fetch handler, both with raw requests (the curl path) and
// through the Admin SDK (same wire, §8.1 no-SDK-lock-in).

import { describe, expect, it } from 'vitest';
import worker from '../index';
import { createToolBridgeAdmin } from '../../sdk/admin';
import { Transport } from '../../sdk/transport';
import { sha256Hex } from './tenant';
import { fakeKV, FakeKV } from './testing/fake-kv';
import { AppEnv } from './types';

type WorkerRequest = Parameters<typeof worker.fetch>[0];

const TENANT_A_TREE = { type: 'directory', id: 'root', title: 'Tenant A', children: [] };
const TENANT_B_TREE = { type: 'directory', id: 'root', title: 'Tenant B', children: [] };

interface TestEnv {
  env: AppEnv;
  kv: FakeKV;
}

async function tenantEnv(): Promise<TestEnv> {
  const kv = fakeKV({
    'tenant:a': JSON.stringify(TENANT_A_TREE),
    'tenant:b': JSON.stringify(TENANT_B_TREE),
    [`apikey:${await sha256Hex('tbk_admin')}`]: JSON.stringify({ principal: 'admin', label: 'root-admin' }),
    [`apikey:${await sha256Hex('tbk_agent_a')}`]: JSON.stringify({ tenantId: 'a', label: 'agent-a' }),
    [`apikey:${await sha256Hex('tbk_agent_b')}`]: JSON.stringify({ tenantId: 'b', label: 'agent-b' }),
  });
  return { kv, env: { TENANTS: kv, TENANT_MODE: 'true', MCP_SERVERS_JSON: '{}' } as unknown as AppEnv };
}

function fetcher(env: AppEnv) {
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

// SDK transport that dispatches straight into the worker (service-binding shape).
function inProcessTransport(env: AppEnv): Transport {
  return {
    fetch: (path, init) =>
      worker.fetch(new Request(`https://bridge.example.com${path}`, init) as unknown as WorkerRequest, env),
  };
}

const SEARCH_PUB = {
  pubId: 'search',
  version: '1.0.0',
  binding: {
    type: 'http',
    endpoints: [{ name: 'query', method: 'POST', url: 'https://api.acme.dev/q', description: 'run a query' }],
  },
  semantics: { query: { effect: 'read' } },
};

describe('provider lifecycle end-to-end (admin + tbp_ provider key)', () => {
  it('create -> key -> publish -> place -> visible only in the placed tenant', async () => {
    const { env } = await tenantEnv();
    const call = fetcher(env);

    // Admin creates the provider and mints a tbp_ key (returned exactly once).
    const created = await call('/api/providers', { method: 'POST', body: JSON.stringify({ id: 'acme' }) }, 'tbk_admin');
    expect(created.status).toBe(201);
    const keyRes = await call('/api/providers/acme/keys', { method: 'POST', body: '{}' }, 'tbk_admin');
    expect(keyRes.status).toBe(201);
    const { key: tbpKey } = (await keyRes.json()) as { key: string };
    expect(tbpKey.startsWith('tbp_')).toBe(true);

    // The provider principal publishes under its own namespace.
    const pubRes = await call('/api/providers/acme/pubs', { method: 'POST', body: JSON.stringify(SEARCH_PUB) }, tbpKey);
    expect(pubRes.status).toBe(201);
    const publishRes = await call('/api/providers/acme/pubs/search/publish', { method: 'POST', body: '{}' }, tbpKey);
    expect(publishRes.status).toBe(200);

    // Admin places the publication into tenant a.
    const placeRes = await call(
      '/api/placements',
      {
        method: 'POST',
        body: JSON.stringify({ tenantId: 'a', path: 'tools/search', pubRef: { providerId: 'acme', pubId: 'search' } }),
      },
      'tbk_admin'
    );
    expect(placeRes.status).toBe(201);

    // Tenant a sees and can describe the materialized node; tenant b gets 404.
    const helpA = await call('/htbp/tools/search/~help', { headers: { Accept: 'application/json' } }, 'tbk_agent_a');
    expect(helpA.status).toBe(200);
    const helpPayload = (await helpA.json()) as { kind: string; resources?: Array<{ name: string }> };
    expect(helpPayload.kind).toBe('http');
    expect(helpPayload.resources?.[0]?.name).toBe('query');

    const helpB = await call('/htbp/tools/search/~help', {}, 'tbk_agent_b');
    expect(helpB.status).toBe(404);

    // Declared semantics surface in the end-path help.
    const helpQuery = await call('/htbp/tools/search/query/~help', { headers: { Accept: 'application/json' } }, 'tbk_agent_a');
    const queryPayload = (await helpQuery.json()) as { endpoint?: { effect?: string } };
    expect(queryPayload.endpoint?.effect).toBe('read');
  });

  it('provider principals cannot write outside their own namespace', async () => {
    const { env } = await tenantEnv();
    const call = fetcher(env);
    await call('/api/providers', { method: 'POST', body: JSON.stringify({ id: 'acme' }) }, 'tbk_admin');
    await call('/api/providers', { method: 'POST', body: JSON.stringify({ id: 'rival' }) }, 'tbk_admin');
    const { key: tbpKey } = (await (
      await call('/api/providers/acme/keys', { method: 'POST', body: '{}' }, 'tbk_admin')
    ).json()) as { key: string };

    // Writing another provider's entities -> 403 Forbidden (M0 reserved code).
    const cross = await call('/api/providers/rival/pubs', { method: 'POST', body: JSON.stringify(SEARCH_PUB) }, tbpKey);
    expect(cross.status).toBe(403);
    expect(((await cross.json()) as { error: { code: string } }).error.code).toBe('Forbidden');

    // Providers cannot mint keys, create providers, or write placements.
    expect((await call('/api/providers/acme/keys', { method: 'POST', body: '{}' }, tbpKey)).status).toBe(403);
    expect((await call('/api/providers', { method: 'POST', body: JSON.stringify({ id: 'x' }) }, tbpKey)).status).toBe(403);
    expect(
      (
        await call(
          '/api/placements',
          { method: 'POST', body: JSON.stringify({ path: 'x', pubRef: { providerId: 'acme', pubId: 'search' } }) },
          tbpKey
        )
      ).status
    ).toBe(403);

    // Owners cannot un-suspend themselves: status stays admin-controlled.
    await call('/api/providers/acme', { method: 'PUT', body: JSON.stringify({ status: 'suspended' }) }, 'tbk_admin');
    await call('/api/providers/acme', { method: 'PUT', body: JSON.stringify({ status: 'active' }) }, tbpKey);
    const after = (await (await call('/api/providers/acme', {}, 'tbk_admin')).json()) as {
      provider: { status: string };
    };
    expect(after.provider.status).toBe('suspended');

    // Agent keys have no control-plane access at all.
    expect((await call('/api/providers', {}, 'tbk_agent_a')).status).toBe(403);
    // ... and a bare provider key has no data-plane access.
    expect((await call('/htbp/~help', {}, tbpKey)).status).toBe(403);
  });

  it('rejects malformed key expiration dates at mint time', async () => {
    const { env } = await tenantEnv();
    const call = fetcher(env);
    await call('/api/providers', { method: 'POST', body: JSON.stringify({ id: 'acme' }) }, 'tbk_admin');

    const res = await call(
      '/api/providers/acme/keys',
      { method: 'POST', body: JSON.stringify({ expiresAt: 'not-a-date' }) },
      'tbk_admin'
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad_request');
  });

  it('placement dry-run reports affected grants without persisting', async () => {
    const { env } = await tenantEnv();
    const call = fetcher(env);
    await call('/api/providers', { method: 'POST', body: JSON.stringify({ id: 'acme' }) }, 'tbk_admin');
    await call('/api/providers/acme/pubs', { method: 'POST', body: JSON.stringify(SEARCH_PUB) }, 'tbk_admin');
    await call('/api/providers/acme/pubs/search/publish', { method: 'POST', body: '{}' }, 'tbk_admin');

    const dry = await call(
      '/api/placements',
      {
        method: 'POST',
        body: JSON.stringify({
          tenantId: 'a',
          path: 'tools/search',
          pubRef: { providerId: 'acme', pubId: 'search' },
          dryRun: true,
        }),
      },
      'tbk_admin'
    );
    expect(dry.status).toBe(200);
    const report = (await dry.json()) as {
      dryRun: boolean;
      action: string;
      affected: { tenantId: string; paths: string[]; grants: Array<{ label?: string; keyHash: string }> };
    };
    expect(report.dryRun).toBe(true);
    expect(report.action).toBe('create');
    expect(report.affected.paths).toEqual(['tools/search']);
    // Tenant a's keys are the affected grants; only truncated hashes appear.
    expect(report.affected.grants.map((g) => g.label)).toContain('agent-a');
    expect(report.affected.grants.every((g) => g.keyHash.length === 12)).toBe(true);

    // Nothing persisted.
    const list = (await (await call('/api/placements?tenant=a', {}, 'tbk_admin')).json()) as {
      placements: unknown[];
    };
    expect(list.placements).toHaveLength(0);
  });
});

describe('Admin SDK provider subset drives the same wire contract', () => {
  it('providers/publications/placements round-trip through the SDK', async () => {
    const { env } = await tenantEnv();
    const admin = createToolBridgeAdmin({ transport: inProcessTransport(env), credential: 'tbk_admin' });

    const provider = await admin.providers.create({ id: 'acme', displayName: 'Acme Tools', trustTier: 'verified' });
    expect(provider.trustTier).toBe('verified');

    await admin.publications.create('acme', SEARCH_PUB as never);
    const published = await admin.publications.publish('acme', 'search');
    expect(published.status).toBe('published');

    const impact = await admin.placements.dryRun({
      tenantId: 'a',
      path: 'tools/search',
      pubRef: { providerId: 'acme', pubId: 'search' },
    });
    expect(impact.dryRun).toBe(true);

    const { placement } = await admin.placements.put({
      tenantId: 'a',
      path: 'tools/search',
      pubRef: { providerId: 'acme', pubId: 'search' },
    });
    expect((await admin.placements.list('a')).map((p) => p.id)).toContain(placement.id);

    await admin.placements.delete(placement.id, 'a');
    expect(await admin.placements.list('a')).toHaveLength(0);

    // Typed error mapping: Forbidden surfaces as TBApiError with retryable=false.
    const agentSdk = createToolBridgeAdmin({ transport: inProcessTransport(env), credential: 'tbk_agent_a' });
    await expect(agentSdk.providers.list()).rejects.toMatchObject({ code: 'Forbidden', status: 403, retryable: false });
  });
});

describe('/api/servers compatibility layer', () => {
  it('does not promote anonymous none-mode callers to KV-backed control-plane admin', async () => {
    const kv = fakeKV();
    const env = { TENANTS: kv, MCP_SERVERS_JSON: '{}' } as unknown as AppEnv;
    const call = fetcher(env);

    for (const [path, init] of [
      ['/api/providers', {}],
      ['/api/placements?tenant=a', {}],
      ['/api/providers/acme/keys', { method: 'POST', body: '{}' }],
      ['/api/hosts', { method: 'POST', body: JSON.stringify({ id: 'watt' }) }],
      ['/api/audit/events?tenant=a', {}],
    ] as const) {
      const res = await call(path, init);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('Forbidden');
    }
  });

  it('translates registration into provider entities and the global tree', async () => {
    const kv = fakeKV();
    // Non-tenant deployment: KV present (dynamic servers enabled), no TENANT_MODE.
    const env = { TENANTS: kv, MCP_SERVERS_JSON: '{}' } as unknown as AppEnv;
    const call = fetcher(env);

    const post = await call('/api/servers', {
      method: 'POST',
      body: JSON.stringify({ name: 'My Server', endpoint: 'https://mcp.example.com/mcp' }),
    });
    expect(post.status).toBe(200);
    const { id } = (await post.json()) as { id: string };
    expect(id).toBe('my-server');

    // Entity records exist: anonymous provider + publication + global placement.
    const dump = kv.dump();
    expect(dump['provider:dynamic']).toBeDefined();
    expect(dump['pub:dynamic:my-server']).toBeDefined();
    expect(dump['placement:_global:dyn_my-server']).toBeDefined();
    expect(dump['dynamic-server:my-server']).toBeUndefined();

    // Legacy list surface still reports it.
    const list = (await (await call('/api/servers', {})).json()) as { servers: Array<{ id: string; source: string }> };
    expect(list.servers.find((s) => s.id === 'my-server')?.source).toBe('dynamic');

    // The registration now also materializes into the global /htbp tree.
    const help = await call('/htbp/~help', { headers: { Accept: 'application/json' } });
    const payload = (await help.json()) as { resources?: Array<{ path: string }> };
    expect(payload.resources?.map((r) => r.path)).toContain('./my-server');

    // Pre-existing legacy records keep being served (compat read path).
    await kv.put('dynamic-server:old-one', JSON.stringify({ id: 'old-one', name: 'Old', endpoint: 'https://old.example.com/mcp' }));
    const merged = (await (await call('/api/servers', {})).json()) as { servers: Array<{ id: string }> };
    expect(merged.servers.map((s) => s.id)).toEqual(expect.arrayContaining(['my-server', 'old-one']));

    // DELETE removes both representations.
    expect((await call('/api/servers/my-server', { method: 'DELETE' })).status).toBe(200);
    const afterDump = kv.dump();
    expect(afterDump['pub:dynamic:my-server']).toBeUndefined();
    expect(afterDump['placement:_global:dyn_my-server']).toBeUndefined();
  });
});
