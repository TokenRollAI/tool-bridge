import { afterEach, describe, expect, it, vi } from 'vitest';
import { mcpAdapter } from './adapters/mcp';
import { AdapterContext, AppEnv, McpNode } from './types';

const node: McpNode = { kind: 'mcp', id: 'ctx7', title: 'Context7', endpoint: 'https://mcp.example.com/mcp' };
const ctx: AdapterContext = { env: {} as unknown as AppEnv, authMode: 'none', basePath: '/htbp/ctx7' };

function sse(body: unknown): Response {
  return new Response(`event: message\ndata: ${JSON.stringify(body)}\n\n`, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

// Mock the MCP Streamable HTTP handshake (initialize / tools/list / tools/call).
function mockMcp(tools: { name: string; description?: string; inputSchema?: unknown }[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? '{}'));
      if (payload.method === 'initialize') {
        return sse({ jsonrpc: '2.0', id: payload.id, result: { protocolVersion: '1', capabilities: {} } });
      }
      if (payload.method === 'tools/list') {
        return sse({ jsonrpc: '2.0', id: payload.id, result: { tools } });
      }
      if (payload.method === 'tools/call') {
        return sse({ jsonrpc: '2.0', id: payload.id, result: { ok: true, calledArgs: payload.params.arguments } });
      }
      return new Response('', { status: 202 });
    })
  );
}

afterEach(() => vi.restoreAllMocks());

describe('mcp adapter: tools are the leaves', () => {
  const tools = [
    { name: 'resolve', description: 'resolve a name', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } },
    { name: 'query', description: 'query docs' },
  ];

  it('describe([]) lists tools as relative resources (no endpoint)', async () => {
    mockMcp(tools);
    const payload = await mcpAdapter.describe(node, ctx, []);
    expect(payload.endpoint).toBeUndefined();
    expect(payload.resources?.map((r) => r.path)).toEqual(['./resolve', './query']);
    expect(payload.resources?.[0].description).toBe('resolve a name');
  });

  it('describe([tool]) is an end-path with that tool inputSchema', async () => {
    mockMcp(tools);
    const payload = await mcpAdapter.describe(node, ctx, ['resolve']);
    expect(payload.resources).toBeUndefined();
    expect(payload.endpoint?.method).toBe('POST');
    expect(payload.endpoint?.inputSchema).toEqual(tools[0].inputSchema);
  });

  it('call([tool], args) forwards args as the tool arguments', async () => {
    mockMcp(tools);
    const result = (await mcpAdapter.call(node, ctx, ['query'], { topic: 'react' })) as { calledArgs: unknown };
    expect(result.calledArgs).toEqual({ topic: 'react' });
  });

  it('call([]) without a tool is rejected', async () => {
    mockMcp(tools);
    await expect(mcpAdapter.call(node, ctx, [], {})).rejects.toThrow(/requires a tool/);
  });
});
