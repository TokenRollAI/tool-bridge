// M2 Tunnel / Device conformance. This stays on the isolated M2 boundary:
// endpoint metadata, minimal broker shape, /tunnel/connect, /htbp/~device/{id},
// structured exec policy, offline EndpointUnavailable, and capability reports.

import { describe, expect, it } from 'vitest';
import { createBridge } from '../index';
import { sha256Hex } from './tenant';
import { fakeKV } from './testing/fake-kv';
import { AppEnv, HelpPayload } from './types';
import { ExecutionDriverRegistry, TunnelBroker, TunnelDispatchRequest } from './device';

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
  return {
    TENANTS: kv,
    TENANT_MODE: 'true',
    MCP_SERVERS_JSON: '{}',
    SSH_BOX_PRIVATE_KEY: 'test-private-key',
    SSH_BOX_PASSWORD: 'test-password',
    K8S_SERVER: 'https://k8s.example.com',
    K8S_TOKEN: 'test-token',
    K8S_CA_CERT: 'test-ca',
    SANDBOX_API_URL: 'https://sandbox.example.com',
    SANDBOX_API_KEY: 'test-sandbox-key',
  } as unknown as AppEnv;
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
  it('accepts KV admin Secret Keys for endpoint management outside tenant mode', async () => {
    const kv = fakeKV({
      [`apikey:${await sha256Hex('tbk_admin')}`]: JSON.stringify({ principal: 'admin', label: 'root-admin' }),
    });
    const env = { TENANTS: kv, MCP_SERVERS_JSON: '{}', SSH_BOX_PASSWORD: 'test-password' } as unknown as AppEnv;
    const bridge = createBridge();
    const request = call(bridge, env);
    const payload = {
      id: 'ssh_admin',
      kind: 'ssh-host',
      driver: 'ssh',
      capabilities: ['exec.run'],
      ssh: {
        host: '203.0.113.20',
        username: 'ubuntu',
        passwordEnv: 'SSH_BOX_PASSWORD',
      },
    };

    const anonymous = await request('/api/endpoints', { method: 'POST', body: JSON.stringify(payload) });
    expect(anonymous.status).toBe(403);

    const created = await request('/api/endpoints', { method: 'POST', body: JSON.stringify(payload) }, 'tbk_admin');
    expect(created.status).toBe(201);
  });

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

  it('routes ssh driver endpoints through an execution driver without a tunnel session', async () => {
    const env = await m2Env();
    const dispatched: unknown[] = [];
    const executionDrivers: ExecutionDriverRegistry = {
      ssh: {
        async dispatch(request) {
          dispatched.push(request);
          return { exitCode: 0, stdout: 'ok\n', stderr: '' };
        },
      },
    };
    const bridge = createBridge({ executionDrivers });
    const request = call(bridge, env);

    const created = await request(
      '/api/endpoints',
      {
        method: 'POST',
        body: JSON.stringify({
          id: 'sandbox_ssh',
          tenantId: 'a',
          kind: 'sandbox',
          driver: 'ssh',
          capabilities: ['exec.run', 'fs.read'],
          ssh: {
            host: '203.0.113.10',
            username: 'ubuntu',
            privateKeyEnv: 'SSH_BOX_PRIVATE_KEY',
          },
        }),
      },
      'tbk_admin'
    );
    expect(created.status).toBe(201);
    expect(((await created.json()) as { endpoint: { status: string; driver: string } }).endpoint).toMatchObject({
      driver: 'ssh',
      status: 'online',
    });

    const run = await request(
      '/htbp/~device/sandbox_ssh/exec.run',
      { method: 'POST', body: JSON.stringify({ argv: ['bash', '-lc', 'pwd'], cwd: '/workspace' }) },
      'tbk_agent_a'
    );
    expect(run.status).toBe(200);
    expect(((await run.json()) as { result: unknown }).result).toEqual({ exitCode: 0, stdout: 'ok\n', stderr: '' });
    expect(dispatched[0]).toMatchObject({
      tool: 'exec.run',
      input: { argv: ['bash', '-lc', 'pwd'], cwd: '/workspace' },
      endpoint: { id: 'sandbox_ssh', driver: 'ssh', kind: 'sandbox' },
    });
    expect((dispatched[0] as { env?: AppEnv }).env).toBe(env);
  });

  it('fails closed when a direct execution driver is not configured', async () => {
    const env = await m2Env();
    const bridge = createBridge();
    const request = call(bridge, env);
    const created = await request(
      '/api/endpoints',
      {
        method: 'POST',
        body: JSON.stringify({
          id: 'ssh_missing_driver',
          tenantId: 'a',
          kind: 'ssh-host',
          driver: 'ssh',
          capabilities: ['exec.run'],
          ssh: {
            host: '203.0.113.11',
            username: 'ubuntu',
            privateKeyEnv: 'SSH_BOX_PRIVATE_KEY',
          },
        }),
      },
      'tbk_admin'
    );
    expect(created.status).toBe(201);

    const run = await request(
      '/htbp/~device/ssh_missing_driver/exec.run',
      { method: 'POST', body: JSON.stringify({ argv: ['bash', '-lc', 'pwd'] }) },
      'tbk_agent_a'
    );
    expect(run.status).toBe(503);
    expect(((await run.json()) as { error: { code: string } }).error.code).toBe('EndpointUnavailable');
  });

  it('validates direct driver endpoint configuration and secret references', async () => {
    const env = await m2Env();
    const bridge = createBridge();
    const request = call(bridge, env);

    const missingSshSecret = await request(
      '/api/endpoints',
      {
        method: 'POST',
        body: JSON.stringify({
          id: 'bad_ssh',
          tenantId: 'a',
          kind: 'ssh-host',
          driver: 'ssh',
          capabilities: ['exec.run'],
          ssh: {
            host: '203.0.113.12',
            username: 'ubuntu',
            privateKeyEnv: 'MISSING_KEY',
          },
        }),
      },
      'tbk_admin'
    );
    expect(missingSshSecret.status).toBe(400);

    const noSshCredential = await request(
      '/api/endpoints',
      {
        method: 'POST',
        body: JSON.stringify({
          id: 'no_ssh_credential',
          tenantId: 'a',
          kind: 'ssh-host',
          driver: 'ssh',
          capabilities: ['exec.run'],
          ssh: {
            host: '203.0.113.13',
            username: 'ubuntu',
          },
        }),
      },
      'tbk_admin'
    );
    expect(noSshCredential.status).toBe(400);

    const passwordOnly = await request(
      '/api/endpoints',
      {
        method: 'POST',
        body: JSON.stringify({
          id: 'password_ssh',
          tenantId: 'a',
          kind: 'ssh-host',
          driver: 'ssh',
          capabilities: ['exec.run'],
          ssh: {
            host: '203.0.113.15',
            username: 'ubuntu',
            passwordEnv: 'SSH_BOX_PASSWORD',
          },
        }),
      },
      'tbk_admin'
    );
    expect(passwordOnly.status).toBe(201);
    expect(((await passwordOnly.json()) as { endpoint: { ssh: { passwordEnv: string; privateKeyEnv?: string } } }).endpoint.ssh).toMatchObject({
      passwordEnv: 'SSH_BOX_PASSWORD',
    });

    const missingPasswordSecret = await request(
      '/api/endpoints',
      {
        method: 'POST',
        body: JSON.stringify({
          id: 'bad_password_ssh',
          tenantId: 'a',
          kind: 'ssh-host',
          driver: 'ssh',
          capabilities: ['exec.run'],
          ssh: {
            host: '203.0.113.14',
            username: 'ubuntu',
            passwordEnv: 'MISSING_PASSWORD',
          },
        }),
      },
      'tbk_admin'
    );
    expect(missingPasswordSecret.status).toBe(400);

    const k8s = await request(
      '/api/endpoints',
      {
        method: 'POST',
        body: JSON.stringify({
          id: 'pod_1',
          tenantId: 'a',
          kind: 'k8s-pod',
          driver: 'k8s-pod',
          capabilities: ['exec.run', 'logs.tail'],
          k8s: {
            serverEnv: 'K8S_SERVER',
            tokenEnv: 'K8S_TOKEN',
            caCertEnv: 'K8S_CA_CERT',
            namespace: 'default',
            pod: 'worker-abc',
            container: 'app',
          },
        }),
      },
      'tbk_admin'
    );
    expect(k8s.status).toBe(201);
    expect(((await k8s.json()) as { endpoint: { driver: string; k8s: { pod: string } } }).endpoint).toMatchObject({
      driver: 'k8s-pod',
      k8s: { pod: 'worker-abc' },
    });

    const cloudflareSandbox = await request(
      '/api/endpoints',
      {
        method: 'POST',
        body: JSON.stringify({
          id: 'cf_sandbox_1',
          tenantId: 'a',
          kind: 'sandbox',
          driver: 'cloudflare-sandbox',
          capabilities: ['exec.run', 'fs.read'],
          cloudflareSandbox: {
            baseUrlEnv: 'SANDBOX_API_URL',
            apiKeyEnv: 'SANDBOX_API_KEY',
            sandboxId: 'sbx_123',
          },
        }),
      },
      'tbk_admin'
    );
    expect(cloudflareSandbox.status).toBe(201);
    expect(
      ((await cloudflareSandbox.json()) as { endpoint: { driver: string; cloudflareSandbox: { sandboxId: string } } }).endpoint
    ).toMatchObject({
      driver: 'cloudflare-sandbox',
      cloudflareSandbox: { sandboxId: 'sbx_123' },
    });
  });
});
