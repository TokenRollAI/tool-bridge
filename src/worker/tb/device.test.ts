// M2 Tunnel / Device conformance. This stays on the isolated M2 boundary:
// endpoint metadata, minimal broker shape, /tunnel/connect, /htbp/~device/{id},
// structured exec policy, offline EndpointUnavailable, and capability reports.

import { describe, expect, it } from 'vitest';
import { createBridge } from '../index';
import { sha256Hex } from './tenant';
import { fakeKV } from './testing/fake-kv';
import { AppEnv, HelpPayload } from './types';
import { TunnelBroker, TunnelDispatchRequest } from './device';

type Bridge = ReturnType<typeof createBridge>;
type WorkerRequest = Parameters<Bridge['fetch']>[0];

async function m2Env(): Promise<AppEnv> {
  const kv = fakeKV({
    'tenant:a': JSON.stringify({ type: 'directory', id: 'root', title: 'Tenant A', children: [] }),
    'tenant:b': JSON.stringify({ type: 'directory', id: 'root', title: 'Tenant B', children: [] }),
    [`apikey:${await sha256Hex('tbk_admin')}`]: JSON.stringify({ principal: 'admin', label: 'root-admin' }),
    [`apikey:${await sha256Hex('tbk_agent_a')}`]: JSON.stringify({ tenantId: 'a', label: 'agent-a' }),
    [`apikey:${await sha256Hex('tbk_agent_b')}`]: JSON.stringify({ tenantId: 'b', label: 'agent-b' }),
  });
  return { TENANTS: kv, TENANT_MODE: 'true', MCP_SERVERS_JSON: '{}' } as unknown as AppEnv;
}

function call(bridge: Bridge, env: AppEnv) {
  return (path: string, init?: RequestInit, token?: string) => {
    const headers = new Headers(init?.headers);
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (init?.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    return bridge.fetch(
      new Request(`https://bridge.example.com${path}`, { ...init, headers }) as unknown as WorkerRequest,
      env
    );
  };
}

async function registerEndpoint(request: ReturnType<typeof call>, overrides: Record<string, unknown> = {}) {
  const res = await request(
    '/api/endpoints',
    {
      method: 'POST',
      body: JSON.stringify({
        id: 'sbx_1',
        tenantId: 'a',
        providerId: 'sandbox',
        kind: 'sandbox',
        capabilities: ['exec.run', 'fs.read', 'logs.tail'],
        ...overrides,
      }),
    },
    'tbk_admin'
  );
  expect(res.status).toBe(201);
}

describe('Tunnel / Device M2', () => {
  it('registered endpoint connects and routes authorized ~device calls through the broker', async () => {
    const env = await m2Env();
    const dispatched: TunnelDispatchRequest[] = [];
    const broker: TunnelBroker = {
      async dispatch(_endpoint, request) {
        dispatched.push(request);
        return { ok: true, argv: request.input.argv };
      },
    };
    const bridge = createBridge({ tunnelBroker: broker });
    const request = call(bridge, env);
    await registerEndpoint(request);

    const connected = await request('/tunnel/connect', { method: 'POST', body: JSON.stringify({ endpointId: 'sbx_1' }) });
    expect(connected.status).toBe(200);
    const connectBody = (await connected.json()) as { sessionId: string };
    expect(connectBody.sessionId).toBeTruthy();

    const help = await request('/htbp/~device/sbx_1/~help', {}, 'tbk_agent_a');
    expect(help.status).toBe(200);
    const payload = (await help.json()) as HelpPayload;
    expect(payload.resources?.map((resource) => resource.name)).toEqual(['exec.run', 'fs.read', 'logs.tail']);

    const toolHelp = await request('/htbp/~device/sbx_1/exec.run/~help', {}, 'tbk_agent_a');
    expect(((await toolHelp.json()) as HelpPayload).endpoint?.effect).toBe('destructive');

    const run = await request(
      '/htbp/~device/sbx_1/exec.run',
      { method: 'POST', body: JSON.stringify({ argv: ['npm', 'test'], timeoutMs: 1000 }) },
      'tbk_agent_a'
    );
    expect(run.status).toBe(200);
    expect(((await run.json()) as { result: unknown }).result).toEqual({ ok: true, argv: ['npm', 'test'] });
    expect(dispatched[0]).toMatchObject({
      endpointId: 'sbx_1',
      tool: 'exec.run',
      input: { argv: ['npm', 'test'], timeoutMs: 1000 },
    });
  });

  it('rejects dangerous commands before dispatch and keeps shell.run unexposed', async () => {
    const env = await m2Env();
    let dispatchCount = 0;
    const bridge = createBridge({
      tunnelBroker: {
        async dispatch() {
          dispatchCount += 1;
          return {};
        },
      },
    });
    const request = call(bridge, env);
    await registerEndpoint(request);
    await request('/tunnel/connect', { method: 'POST', body: JSON.stringify({ endpointId: 'sbx_1' }) });

    const dangerous = await request(
      '/htbp/~device/sbx_1/exec.run',
      { method: 'POST', body: JSON.stringify({ argv: ['rm', '-rf', '/'] }) },
      'tbk_agent_a'
    );
    expect(dangerous.status).toBe(403);
    expect(((await dangerous.json()) as { error: { code: string } }).error.code).toBe('Forbidden');
    expect(dispatchCount).toBe(0);

    const shellHelp = await request('/htbp/~device/sbx_1/shell.run/~help', {}, 'tbk_agent_a');
    expect(shellHelp.status).toBe(404);
  });

  it('fails closed when command policy restrictions cannot be enforced', async () => {
    const env = await m2Env();
    let dispatchCount = 0;
    const bridge = createBridge({
      tunnelBroker: {
        async dispatch() {
          dispatchCount += 1;
          return {};
        },
      },
    });
    const request = call(bridge, env);

    await registerEndpoint(request, { commandPolicyId: 'missing-policy' });
    await request('/tunnel/connect', { method: 'POST', body: JSON.stringify({ endpointId: 'sbx_1' }) });
    const missingPolicy = await request(
      '/htbp/~device/sbx_1/exec.run',
      { method: 'POST', body: JSON.stringify({ argv: ['npm', 'test'] }) },
      'tbk_agent_a'
    );
    expect(missingPolicy.status).toBe(403);
    expect(((await missingPolicy.json()) as { error: { code: string } }).error.code).toBe('Forbidden');

    await request(
      '/api/command-policies',
      {
        method: 'POST',
        body: JSON.stringify({
          id: 'workspace-only',
          defaultMode: 'allow',
          allowedCwdPrefixes: ['/workspace/project'],
        }),
      },
      'tbk_admin'
    );
    await request(
      '/api/endpoints/sbx_1',
      { method: 'PUT', body: JSON.stringify({ commandPolicyId: 'workspace-only' }) },
      'tbk_admin'
    );

    const noCwd = await request(
      '/htbp/~device/sbx_1/exec.run',
      { method: 'POST', body: JSON.stringify({ argv: ['npm', 'test'] }) },
      'tbk_agent_a'
    );
    expect(noCwd.status).toBe(403);

    const badCwd = await request(
      '/htbp/~device/sbx_1/exec.run',
      { method: 'POST', body: JSON.stringify({ argv: ['npm', 'test'], cwd: '/tmp' }) },
      'tbk_agent_a'
    );
    expect(badCwd.status).toBe(403);
    expect(dispatchCount).toBe(0);
  });

  it('returns EndpointUnavailable for offline endpoints', async () => {
    const env = await m2Env();
    const bridge = createBridge({
      tunnelBroker: {
        async dispatch() {
          return {};
        },
      },
    });
    const request = call(bridge, env);
    await registerEndpoint(request);

    const res = await request(
      '/htbp/~device/sbx_1/exec.run',
      { method: 'POST', body: JSON.stringify({ argv: ['npm', 'test'] }) },
      'tbk_agent_a'
    );
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('EndpointUnavailable');
  });

  it('hides another tenant endpoint and refuses capability self-elevation reports', async () => {
    const env = await m2Env();
    const bridge = createBridge();
    const request = call(bridge, env);
    await registerEndpoint(request, { capabilities: ['exec.run'] });

    const crossTenant = await request('/htbp/~device/sbx_1/~help', {}, 'tbk_agent_b');
    expect(crossTenant.status).toBe(404);

    const connected = await request('/tunnel/connect', { method: 'POST', body: JSON.stringify({ endpointId: 'sbx_1' }) });
    const { sessionId } = (await connected.json()) as { sessionId: string };
    const report = await request(
      '/tunnel/capabilities',
      { method: 'POST', body: JSON.stringify({ endpointId: 'sbx_1', sessionId, capabilities: ['exec.run', 'fs.read'] }) }
    );
    expect(report.status).toBe(403);
    expect(((await report.json()) as { error: { code: string } }).error.code).toBe('Forbidden');
  });
});
