// M1 Host SDK conformance — the Watt-style host profile (SPEC-001 §8.3):
// service-binding-shaped transport + shallow S2S credential + builtin handler
// injection + mounts.sync + tree consumption + error/effect adapters.
//
// Every SDK step is also exercised as a raw request (the curl path) at least
// once: §8.1 — there is nothing only the SDK can do.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBridge } from '../../worker/index';
import { sha256Hex } from '../../worker/tb/tenant';
import { fakeKV } from '../../worker/tb/testing/fake-kv';
import { AppEnv, HelpPayload } from '../../worker/tb/types';
import { TBApiError } from '../client';
import { Transport } from '../transport';
import { createToolBridgeHost, HostMount } from './index';

type Bridge = ReturnType<typeof createBridge>;
type WorkerRequest = Parameters<Bridge['fetch']>[0];

async function hostTestEnv(): Promise<AppEnv> {
  const kv = fakeKV({
    [`apikey:${await sha256Hex('tbk_admin')}`]: JSON.stringify({ principal: 'admin', label: 'root-admin' }),
  });
  return { TENANTS: kv, TENANT_MODE: 'true', MCP_SERVERS_JSON: '{}' } as unknown as AppEnv;
}

function transportFor(bridge: Bridge, env: AppEnv): Transport {
  return {
    fetch: (path, init) =>
      bridge.fetch(new Request(`https://bridge.example.com${path}`, init) as unknown as WorkerRequest, env),
  };
}

async function registerHost(bridge: Bridge, env: AppEnv): Promise<string> {
  const raw = (path: string, body: unknown) =>
    bridge.fetch(
      new Request(`https://bridge.example.com${path}`, {
        method: 'POST',
        headers: { Authorization: 'Bearer tbk_admin', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }) as unknown as WorkerRequest,
      env
    );
  const created = await raw('/api/hosts', { id: 'watt', confirmDelegated: true });
  expect(created.status).toBe(201);
  const keyRes = await raw('/api/hosts/watt/keys', { label: 'watt-gateway' });
  expect(keyRes.status).toBe(201);
  const { key } = (await keyRes.json()) as { key: string };
  expect(key.startsWith('tbk_')).toBe(true);
  return key;
}

const WEBSEARCH_MOUNT: HostMount = {
  path: 'watt/websearch',
  binding: {
    type: 'builtin',
    description: 'Watt websearch',
    tools: [
      { name: 'search', handler: 'websearch', description: 'web search', effect: 'read', scope: 'net:search' },
    ],
  },
};

afterEach(() => vi.restoreAllMocks());

describe('Watt-style host profile', () => {
  it('builtin injection + mounts.sync + tree.help/call through the normal HTBP tree', async () => {
    const env = await hostTestEnv();

    // Deploy-time: the host builds its bridge with its handlers injected.
    const seen: unknown[] = [];
    const preTb = createToolBridgeHost({ transport: { fetch: async () => new Response() } });
    preTb.builtins.register('websearch', (input) => {
      seen.push(input);
      return { results: [`hit for ${JSON.stringify(input)}`] };
    });
    const bridge = createBridge({ builtinHandlers: preTb.builtins.registry() });

    const hostKey = await registerHost(bridge, env);
    const tb = createToolBridgeHost({ transport: transportFor(bridge, env), credential: hostKey, hostId: 'watt' });
    tb.builtins.register('websearch', preTb.builtins.registry().websearch);

    // Sync the host registry into Provider/Publication/Placement records.
    const sync = await tb.mounts.sync([WEBSEARCH_MOUNT]);
    expect(sync.applied).toBe(1);

    // The mount is now a normal HTBP subtree for the host principal.
    const help = (await tb.tree.help('watt/websearch')) as HelpPayload;
    expect(help.kind).toBe('builtin');
    expect(help.resources?.map((r) => r.name)).toEqual(['search']);

    // Declared semantics surface at the end-path.
    const toolHelp = (await tb.tree.help('watt/websearch/search')) as HelpPayload;
    expect(toolHelp.endpoint?.effect).toBe('read');
    expect(toolHelp.endpoint?.scope).toBe('net:search');

    // Call through the same resolve path; the injected handler runs.
    const call = await tb.tree.call('watt/websearch/search', { arguments: { q: 'htbp' } }, { as: 'watt-user-42' });
    expect(call.resource).toBe('/htbp/watt/websearch/search');
    expect(call.result).toEqual({ results: ['hit for {"q":"htbp"}'] });
    expect(seen).toEqual([{ q: 'htbp' }]);

    // curl equivalence: the same call as one raw HTTP request.
    const rawCall = await bridge.fetch(
      new Request('https://bridge.example.com/htbp/watt/websearch/search', {
        method: 'POST',
        headers: { Authorization: `Bearer ${hostKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: { q: 'htbp' } }),
      }) as unknown as WorkerRequest,
      env
    );
    expect(rawCall.status).toBe(200);
    expect(((await rawCall.json()) as { result: unknown }).result).toEqual({ results: ['hit for {"q":"htbp"}'] });

    // Declarative re-sync prunes mounts that were removed host-side.
    const resync = await tb.mounts.sync([]);
    expect(resync.removed).toBe(1);
    await expect(tb.tree.help('watt/websearch')).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });

  it('hidden tools stay invisible in ~help and uncallable through the host path', async () => {
    const env = await hostTestEnv();
    const bridge = createBridge();
    const hostKey = await registerHost(bridge, env);
    const tb = createToolBridgeHost({ transport: transportFor(bridge, env), credential: hostKey, hostId: 'watt' });

    // Mock the upstream MCP server with two tools.
    const sse = (body: unknown) =>
      new Response(`event: message\ndata: ${JSON.stringify(body)}\n\n`, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const payload = JSON.parse(String(init?.body ?? '{}'));
        if (payload.method === 'initialize') {
          return sse({ jsonrpc: '2.0', id: payload.id, result: {} });
        }
        if (payload.method === 'tools/list') {
          return sse({ jsonrpc: '2.0', id: payload.id, result: { tools: [{ name: 'safe' }, { name: 'secret' }] } });
        }
        if (payload.method === 'tools/call') {
          return sse({ jsonrpc: '2.0', id: payload.id, result: { ok: true } });
        }
        return new Response('', { status: 202 });
      })
    );

    await tb.mounts.sync([
      {
        path: 'watt/ext',
        binding: { type: 'mcp', endpoint: 'https://mcp.example.com/mcp' },
        shaping: { toolOverrides: { secret: { hide: true } } },
      },
    ]);

    const help = (await tb.tree.help('watt/ext')) as HelpPayload;
    expect(help.resources?.map((r) => r.name)).toEqual(['safe']);
    await expect(tb.tree.call('watt/ext/secret', {})).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });

  it('maps platform errors to the host dialect without inspecting adapter internals', async () => {
    const env = await hostTestEnv();
    const bridge = createBridge();
    const hostKey = await registerHost(bridge, env);
    const tb = createToolBridgeHost({ transport: transportFor(bridge, env), credential: hostKey, hostId: 'watt' });
    const toWatt = tb.adapters.wattError();

    // 404 not_found -> not_found (not retryable).
    const notFound = await tb.tree.call('watt/nope', {}).catch((e) => e as TBApiError);
    expect(toWatt(notFound)).toMatchObject({ code: 'not_found', retryable: false });

    // 502 UpstreamError -> unavailable (retryable): mcp upstream unreachable.
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('ECONNREFUSED'))));
    await tb.mounts.sync([{ path: 'watt/ext', binding: { type: 'mcp', endpoint: 'https://mcp.example.com/mcp' } }]);
    const upstream = await tb.tree.call('watt/ext/anything', {}).catch((e) => e as TBApiError);
    expect(upstream).toMatchObject({ code: 'UpstreamError', status: 502, retryable: true });
    expect(toWatt(upstream)).toMatchObject({ code: 'unavailable', retryable: true });
    vi.restoreAllMocks();

    // 401 without a credential -> unauthenticated.
    const anon = createToolBridgeHost({ transport: transportFor(bridge, env) });
    const unauthorized = await anon.tree.help('watt').catch((e) => e as TBApiError);
    expect(toWatt(unauthorized)).toMatchObject({ code: 'unauthenticated', retryable: false });
  });

  it('effectMap converts the platform effect dialect (external -> destructive)', () => {
    const tb = createToolBridgeHost({ transport: { fetch: async () => new Response() } });
    const map = tb.adapters.effectMap({ external: 'destructive' });
    const mapped = map({
      htbp: 'draft',
      kind: 'mcp',
      title: 't',
      endpoint: { method: 'POST', tools: [{ name: 'a' }, { name: 'b', effect: 'read' }] },
    });
    // Undeclared effect defaults to `external`, then maps conservatively.
    expect(mapped.endpoint?.tools?.[0].effect).toBe('destructive');
    expect(mapped.endpoint?.tools?.[1].effect).toBe('read');
  });
});
