import { afterEach, describe, expect, it, vi } from 'vitest';
import { clampCrawlOptions, crawlTree } from './crawl';
import { AppEnv, CrawlNode } from './types';

function env(json: unknown, extra: Partial<AppEnv> = {}): AppEnv {
  return { MCP_SERVERS_JSON: JSON.stringify(json), ...extra } as unknown as AppEnv;
}

function flatten(node: CrawlNode, out: CrawlNode[] = []): CrawlNode[] {
  out.push(node);
  for (const child of node.children) {
    flatten(child, out);
  }
  return out;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('clampCrawlOptions', () => {
  it('clamps depth and node ceilings to hard maximums', () => {
    expect(clampCrawlOptions({ maxDepth: 999, maxNodes: 9999 })).toEqual({ maxDepth: 8, maxNodes: 200 });
    expect(clampCrawlOptions({ maxDepth: 0, maxNodes: 0 })).toEqual({ maxDepth: 1, maxNodes: 1 });
  });
});

describe('crawlTree (local)', () => {
  it('walks a directory tree down to http end-path leaves', async () => {
    const tree = await crawlTree(
      env({
        type: 'directory',
        id: 'root',
        children: [
          {
            type: 'http',
            id: 'weather',
            endpoints: [{ name: 'current', method: 'GET', url: 'https://api.example.com/w', inputSchema: {} }],
          },
        ],
      }),
      { path: '' },
      'none'
    );
    const nodes = flatten(tree);
    const leaf = nodes.find((n) => n.endpoint);
    expect(leaf?.endpoint?.method).toBe('GET');
  });

  it('respects the maxDepth ceiling by marking truncation', async () => {
    const tree = await crawlTree(
      env({
        type: 'directory',
        id: 'root',
        children: [
          { type: 'directory', id: 'a', children: [{ type: 'directory', id: 'b', children: [] }] },
        ],
      }),
      { path: '' },
      'none',
      { maxDepth: 1, maxNodes: 200 }
    );
    expect(flatten(tree).some((n) => n.truncated)).toBe(true);
  });
});

describe('crawlTree (remote)', () => {
  it('follows a remote node and parses its JSON help, with cycle detection', async () => {
    const helpByUrl: Record<string, unknown> = {
      'https://partner.example.com/~help': {
        htbp: 'draft',
        kind: 'directory',
        title: 'Partner',
        resources: [{ name: 'loop', path: './loop' }],
      },
      // Child points back at the parent → must terminate via visited-set.
      'https://partner.example.com/loop/~help': {
        htbp: 'draft',
        kind: 'directory',
        title: 'Loop',
        resources: [{ name: 'back', path: '../' }],
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = String(input);
        const body = helpByUrl[url];
        if (!body) {
          return new Response('not found', { status: 404 });
        }
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      })
    );

    const tree = await crawlTree(
      env({ type: 'directory', id: 'root', children: [{ type: 'remote', id: 'partner', helpUrl: 'https://partner.example.com/~help' }] }),
      { path: '' },
      'none'
    );
    const remote = flatten(tree).find((n) => n.kind === 'remote');
    expect(remote?.title).toBe('Partner');
    // The crawl terminates (does not hang) and the loop is bounded.
    expect(flatten(tree).length).toBeLessThan(20);
  });

  it('captures a failing remote fetch as a per-node error without aborting siblings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 }))
    );
    const tree = await crawlTree(
      env({
        type: 'directory',
        id: 'root',
        children: [
          { type: 'remote', id: 'broken', helpUrl: 'https://bad.example.com/~help' },
          {
            type: 'http',
            id: 'ok',
            endpoints: [{ name: 'ping', method: 'GET', url: 'https://api.example.com/p' }],
          },
        ],
      }),
      { path: '' },
      'none'
    );
    const nodes = flatten(tree);
    expect(nodes.find((n) => n.kind === 'remote')?.error).toBeTruthy();
    expect(nodes.find((n) => n.title === 'ok' || n.path.endsWith('/ok'))).toBeTruthy();
  });

  it('rejects an http remote help URL unless ALLOW_INSECURE_MCP_HTTP is set', async () => {
    const tree = await crawlTree(
      env({ type: 'directory', id: 'root', children: [{ type: 'remote', id: 'insecure', helpUrl: 'http://plain.example.com/~help' }] }),
      { path: '' },
      'none'
    );
    expect(flatten(tree).find((n) => n.kind === 'remote')?.error).toMatch(/https/i);
  });
});
