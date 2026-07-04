// M0 error-contract conformance (TASK-M0, SPEC-001 §6.8/§10).
//
// Asserts the three things the contract fixes: the HTTP status, the error
// code string, and the envelope body shape {error:{code,message,details?}} —
// end-to-end through the worker's fetch handler, the same surface curl sees.

import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../index';
import {
  EndpointUnavailableError,
  ForbiddenError,
  NotFoundError,
  UpstreamError,
  errorResponseOf,
  isRetryable,
} from './errors';
import { AppEnv } from './types';

function envWith(tree: unknown): AppEnv {
  return { MCP_SERVERS_JSON: JSON.stringify(tree) } as unknown as AppEnv;
}

const HTTP_TREE = {
  type: 'directory',
  id: 'root',
  children: [
    {
      type: 'http',
      id: 'svc',
      endpoints: [{ name: 'run', method: 'POST', url: 'https://upstream.example.com/run' }],
    },
  ],
};

const MCP_TREE = {
  type: 'directory',
  id: 'root',
  children: [{ type: 'mcp', id: 'ctx', endpoint: 'https://mcp.example.com/mcp' }],
};

function request(path: string, init?: RequestInit): Request {
  return new Request(`https://bridge.example.com${path}`, init);
}

async function envelopeOf(response: Response): Promise<{ code: string; message: string; details?: unknown }> {
  const body = (await response.json()) as { error?: { code?: unknown; message?: unknown; details?: unknown } };
  // Envelope shape: a single `error` object with string code + message.
  expect(body.error).toBeDefined();
  expect(typeof body.error?.code).toBe('string');
  expect(typeof body.error?.message).toBe('string');
  return body.error as { code: string; message: string; details?: unknown };
}

afterEach(() => vi.restoreAllMocks());

describe('upstream failures map to UpstreamError → 502', () => {
  it('http adapter: upstream non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const res = await worker.fetch(
      request('/htbp/svc/run', { method: 'POST', body: '{}' }),
      envWith(HTTP_TREE)
    );
    expect(res.status).toBe(502);
    const error = await envelopeOf(res);
    expect(error.code).toBe('UpstreamError');
  });

  it('http adapter: upstream unreachable (fetch rejects)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('connect ECONNREFUSED'))));
    const res = await worker.fetch(
      request('/htbp/svc/run', { method: 'POST', body: '{}' }),
      envWith(HTTP_TREE)
    );
    expect(res.status).toBe(502);
    expect((await envelopeOf(res)).code).toBe('UpstreamError');
  });

  it('mcp adapter: handshake failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('connect ECONNREFUSED'))));
    const res = await worker.fetch(request('/htbp/ctx/~help'), envWith(MCP_TREE));
    expect(res.status).toBe(502);
    expect((await envelopeOf(res)).code).toBe('UpstreamError');
  });
});

describe('existing wire behavior is preserved', () => {
  it('unknown path → 404 not_found', async () => {
    const res = await worker.fetch(request('/htbp/nope/~help'), envWith(HTTP_TREE));
    expect(res.status).toBe(404);
    expect((await envelopeOf(res)).code).toBe('not_found');
  });

  it('unknown endpoint under a node → 404 not_found (deny == not found)', async () => {
    const res = await worker.fetch(
      request('/htbp/svc/hidden', { method: 'POST', body: '{}' }),
      envWith(HTTP_TREE)
    );
    expect(res.status).toBe(404);
    expect((await envelopeOf(res)).code).toBe('not_found');
  });

  it('non-POST call → 405 method_not_allowed', async () => {
    const res = await worker.fetch(request('/htbp/svc/run', { method: 'PUT' }), envWith(HTTP_TREE));
    expect(res.status).toBe(405);
    expect((await envelopeOf(res)).code).toBe('method_not_allowed');
  });

  it('tenant mode without a Secret Key → 401 unauthorized', async () => {
    const env = {
      ...envWith(HTTP_TREE),
      TENANTS: { get: async () => null },
      TENANT_MODE: 'true',
    } as unknown as AppEnv;
    const res = await worker.fetch(request('/htbp/svc/run/~help'), env);
    expect(res.status).toBe(401);
    expect((await envelopeOf(res)).code).toBe('unauthorized');
  });

  it('successful call keeps the {resource, result} wire shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    );
    const res = await worker.fetch(
      request('/htbp/svc/run', { method: 'POST', body: '{}' }),
      envWith(HTTP_TREE)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ resource: '/htbp/svc/run', result: { ok: true } });
  });
});

describe('reserved codes (Tunnel/Device alignment, not implemented here)', () => {
  it('EndpointUnavailable → 503', async () => {
    const res = errorResponseOf(new EndpointUnavailableError('endpoint sbx_1 is offline'));
    expect(res.status).toBe(503);
    expect((await envelopeOf(res)).code).toBe('EndpointUnavailable');
  });

  it('Forbidden → 403', async () => {
    const res = errorResponseOf(new ForbiddenError('provider key cannot write outside its namespace'));
    expect(res.status).toBe(403);
    expect((await envelopeOf(res)).code).toBe('Forbidden');
  });
});

describe('retryable semantics are code-based (no wire change)', () => {
  it('transient transport codes are retryable', () => {
    expect(isRetryable('UpstreamError')).toBe(true);
    expect(isRetryable('EndpointUnavailable')).toBe(true);
    expect(new UpstreamError('x').retryable).toBe(true);
  });

  it('caller and internal errors are not', () => {
    for (const code of ['not_found', 'Forbidden', 'bad_request', 'unauthorized', 'internal_error']) {
      expect(isRetryable(code)).toBe(false);
    }
    expect(new NotFoundError('x').retryable).toBe(false);
  });
});
