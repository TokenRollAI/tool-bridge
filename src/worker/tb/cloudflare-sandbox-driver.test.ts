import { describe, expect, it } from 'vitest';
import { createCloudflareSandboxExecutionDriver } from './cloudflare-sandbox-driver';

describe('cloudflare sandbox execution driver', () => {
  it('executes argv through the sandbox bridge and decodes SSE output', async () => {
    const requests: Request[] = [];
    const driver = createCloudflareSandboxExecutionDriver({
      async fetch(input, init) {
        const request = new Request(input, init);
        requests.push(request);
        return new Response(
          [
            `event: stdout`,
            `data: ${Buffer.from('hello\n').toString('base64')}`,
            ``,
            `event: stderr`,
            `data: ${Buffer.from('warn\n').toString('base64')}`,
            ``,
            `event: exit`,
            `data: {"exit_code":0}`,
            ``,
          ].join('\n'),
          { headers: { 'Content-Type': 'text/event-stream' } }
        );
      },
    });

    const result = await driver.dispatch({
      env: { SANDBOX_API_URL: 'https://sandbox.example.com', SANDBOX_API_KEY: 'secret' } as never,
      endpoint: {
        id: 'cf_sbx',
        kind: 'sandbox',
        driver: 'cloudflare-sandbox',
        status: 'online',
        capabilities: ['exec.run', 'fs.read'],
        cloudflareSandbox: {
          baseUrlEnv: 'SANDBOX_API_URL',
          apiKeyEnv: 'SANDBOX_API_KEY',
          sandboxId: 'sbx_123',
        },
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
      tool: 'exec.run',
      traceId: 'trc_test',
      input: { argv: ['sh', '-lc', 'echo hello'], cwd: '/workspace' },
      deadlineMs: 1000,
      maxOutputBytes: 1024,
    });

    expect(requests[0].url).toBe('https://sandbox.example.com/v1/sandbox/sbx_123/exec');
    expect(requests[0].headers.get('Authorization')).toBe('Bearer secret');
    expect(await requests[0].json()).toMatchObject({ argv: ['sh', '-lc', 'echo hello'], cwd: '/workspace' });
    expect(result).toMatchObject({ exitCode: 0, stdout: 'hello\n', stderr: 'warn\n' });
  });

  it('reads workspace files through the sandbox bridge file API', async () => {
    const requests: Request[] = [];
    const driver = createCloudflareSandboxExecutionDriver({
      async fetch(input, init) {
        const request = new Request(input, init);
        requests.push(request);
        return new Response('file-content');
      },
    });

    const result = await driver.dispatch({
      env: { SANDBOX_API_URL: 'https://sandbox.example.com/', SANDBOX_API_KEY: 'secret' } as never,
      endpoint: {
        id: 'cf_sbx',
        kind: 'sandbox',
        driver: 'cloudflare-sandbox',
        status: 'online',
        capabilities: ['fs.read'],
        cloudflareSandbox: {
          baseUrlEnv: 'SANDBOX_API_URL',
          apiKeyEnv: 'SANDBOX_API_KEY',
          sandboxId: 'sbx_123',
        },
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
      tool: 'fs.read',
      traceId: 'trc_test',
      input: { path: '/workspace/hello.txt' },
      deadlineMs: 1000,
      maxOutputBytes: 1024,
    });

    expect(requests[0].url).toBe('https://sandbox.example.com/v1/sandbox/sbx_123/file/workspace/hello.txt');
    expect(result).toEqual({ path: '/workspace/hello.txt', content: 'file-content', bytes: 12 });
  });
});
