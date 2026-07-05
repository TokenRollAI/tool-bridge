import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../worker';
import { createToolBridgeAdmin } from '.';
import { sha256Hex } from '../../worker/tb/tenant';
import { fakeKV } from '../../worker/tb/testing/fake-kv';
import type { AppEnv } from '../../worker/tb/types';
import type { Transport } from '../transport';

type WorkerRequest = Parameters<typeof worker.fetch>[0];

async function envWithAdmin(): Promise<AppEnv> {
  const kv = fakeKV({
    'tenant:a': JSON.stringify({ type: 'directory', id: 'root', title: 'Tenant A', children: [] }),
    [`apikey:${await sha256Hex('tbk_admin')}`]: JSON.stringify({ principal: 'admin', label: 'root-admin' }),
    [`apikey:${await sha256Hex('tbk_agent_a')}`]: JSON.stringify({ tenantId: 'a', label: 'agent-a' }),
  });
  return { TENANTS: kv, TENANT_MODE: 'true', MCP_SERVERS_JSON: '{}' } as unknown as AppEnv;
}

function inProcessTransport(env: AppEnv): Transport {
  return {
    fetch: (path, init) =>
      worker.fetch(new Request(`https://bridge.example.com${path}`, init) as unknown as WorkerRequest, env),
  };
}

function stubMcp(): void {
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
        return sse({
          jsonrpc: '2.0',
          id: payload.id,
          result: {
            tools: [
              {
                name: 'lookup',
                description: 'Lookup a record',
                inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
              },
            ],
          },
        });
      }
      if (payload.method === 'tools/call') {
        return sse({
          jsonrpc: '2.0',
          id: payload.id,
          result: { called: payload.params?.name, args: payload.params?.arguments },
        });
      }
      return new Response('', { status: 202 });
    })
  );
}

afterEach(() => vi.restoreAllMocks());

describe('Admin SDK full public API coverage', () => {
  it('manages hosts, endpoints, command policies, audit, and tree discovery', async () => {
    const env = await envWithAdmin();
    const admin = createToolBridgeAdmin({ transport: inProcessTransport(env), credential: 'tbk_admin' });

    await expect(admin.auth.config()).resolves.toMatchObject({ mode: 'none' });

    const host = await admin.hosts.create({ id: 'watt', confirmDelegated: true });
    expect(host.providerId).toBe('watt');
    expect(await admin.hosts.get('watt')).toMatchObject({ id: 'watt', tenantId: 'watt' });
    const hostKey = await admin.hosts.createKey('watt', { label: 'watt-gateway' });
    expect(hostKey.key.startsWith('tbk_')).toBe(true);

    const policy = await admin.commandPolicies.create({
      id: 'safe-node',
      defaultMode: 'deny',
      allowCommands: ['npm'],
      maxTimeoutMs: 30_000,
    });
    expect(policy.allowCommands).toEqual(['npm']);
    await expect(admin.commandPolicies.get('safe-node')).resolves.toMatchObject({ defaultMode: 'deny' });
    await admin.commandPolicies.update('safe-node', { allowCommands: ['npm', 'pnpm'] });
    expect((await admin.commandPolicies.list()).map((p) => p.id)).toContain('safe-node');

    const endpoint = await admin.endpoints.create({
      id: 'sbx_1',
      tenantId: 'a',
      kind: 'sandbox',
      label: 'Sandbox',
      capabilities: ['exec.run', 'fs.read'],
      commandPolicyId: 'safe-node',
    });
    expect(endpoint.status).toBe('offline');
    expect((await admin.endpoints.list()).map((e) => e.id)).toContain('sbx_1');
    await admin.endpoints.update('sbx_1', { label: 'Sandbox One' });
    expect(await admin.endpoints.get('sbx_1')).toMatchObject({ label: 'Sandbox One' });

    const deviceHelp = await admin.tree.help('~device/sbx_1');
    expect(deviceHelp.resources?.map((r) => r.name)).toEqual(['exec.run', 'fs.read']);
    const events = await admin.audit.events({ tenant: 'a', limit: 10 });
    expect(events.events.some((e) => e.path === '/htbp/~device/sbx_1/~help')).toBe(true);

    const revoked = await admin.endpoints.revoke('sbx_1');
    expect(revoked.status).toBe('revoked');
    await admin.commandPolicies.delete('safe-node');
    expect((await admin.commandPolicies.list()).map((p) => p.id)).not.toContain('safe-node');
  });

  it('manages legacy MCP servers, ad-hoc bridge calls, and tree crawl through SDK', async () => {
    stubMcp();
    const env = await envWithAdmin();
    const admin = createToolBridgeAdmin({ transport: inProcessTransport(env), credential: 'tbk_admin' });

    const created = await admin.servers.create({
      name: 'Context Tools',
      endpoint: 'https://mcp.example.com/mcp',
      description: 'MCP demo',
    });
    expect(created.id).toBe('context-tools');

    const listed = await admin.servers.list();
    expect(listed.dynamicEnabled).toBe(true);
    expect(listed.servers.map((s) => s.id)).toContain('context-tools');
    await expect(admin.servers.get('context-tools')).resolves.toMatchObject({
      server: { endpoint: 'https://mcp.example.com/mcp' },
    });

    const tools = await admin.servers.tools('context-tools');
    expect(tools.tools.map((t) => t.name)).toEqual(['lookup']);
    await expect(admin.servers.help('context-tools')).resolves.toContain('cmd lookup POST');
    await expect(admin.servers.skill('context-tools')).resolves.toContain('Available Tools');
    await expect(admin.servers.call('context-tools', 'lookup', { q: 'sdk' })).resolves.toMatchObject({
      result: { called: 'lookup', args: { q: 'sdk' } },
    });

    await expect(
      admin.bridge.tools({ name: 'adhoc', endpoint: 'https://mcp.example.com/mcp' })
    ).resolves.toMatchObject({ tools: [{ name: 'lookup' }] });
    await expect(
      admin.bridge.call({ name: 'adhoc', endpoint: 'https://mcp.example.com/mcp' }, 'lookup', { q: 'adhoc' })
    ).resolves.toMatchObject({ result: { called: 'lookup', args: { q: 'adhoc' } } });

    const tree = await admin.tree.get();
    expect(tree.children.map((child) => child.path)).toContain('/htbp/context-tools');
    const crawled = await admin.tree.crawl({ start: { path: 'context-tools' }, maxDepth: 1 });
    expect(crawled.path).toBe('/htbp/context-tools');

    await admin.servers.delete('context-tools');
    expect((await admin.servers.list()).servers.map((s) => s.id)).not.toContain('context-tools');
  });
});
