import { describe, expect, it } from 'vitest';
import { crawlTree } from './crawl';
import { parseTree } from './registry';
import { resolveCall, resolveHelp, NotFoundError } from './resolve';
import { resolveTenant, sha256Hex, tenantModeEnabled } from './tenant';
import { AppEnv, CrawlNode } from './types';

// Fake KV mirroring the fake-bucket pattern used by the mount adapter test.
function fakeKV(store: Record<string, string>) {
  return {
    async get(key: string, type?: 'json' | 'text') {
      const raw = store[key];
      if (raw == null) {
        return null;
      }
      return type === 'json' ? JSON.parse(raw) : raw;
    },
  };
}

const treeA = { type: 'directory', id: 'root', title: 'Tenant A', children: [{ type: 'http', id: 'alpha', endpoints: [{ name: 'a1', method: 'GET', url: 'https://a.example.com/1' }] }] };
const treeB = { type: 'directory', id: 'root', title: 'Tenant B', children: [{ type: 'http', id: 'bravo', endpoints: [{ name: 'b1', method: 'GET', url: 'https://b.example.com/1' }] }] };

async function seededEnv(): Promise<AppEnv> {
  const store: Record<string, string> = {
    'tenant:a': JSON.stringify(treeA),
    'tenant:b': JSON.stringify(treeB),
    [`apikey:${await sha256Hex('key-A')}`]: JSON.stringify({ tenantId: 'a' }),
    [`apikey:${await sha256Hex('key-B')}`]: JSON.stringify({ tenantId: 'b' }),
  };
  return { TENANTS: fakeKV(store) } as unknown as AppEnv;
}

function flatten(node: CrawlNode, out: CrawlNode[] = []): CrawlNode[] {
  out.push(node);
  node.children.forEach((child) => flatten(child, out));
  return out;
}

describe('tenant resolution', () => {
  it('reports tenant mode from the TENANTS binding', () => {
    expect(tenantModeEnabled({} as AppEnv)).toBe(false);
    // KV presence alone is not enough; TENANT_MODE must be explicitly enabled.
    expect(tenantModeEnabled({ TENANTS: fakeKV({}) } as unknown as AppEnv)).toBe(false);
    expect(tenantModeEnabled({ TENANTS: fakeKV({}), TENANT_MODE: 'true' } as unknown as AppEnv)).toBe(true);
  });

  it('resolves a Secret Key to its tenant tree by hash (raw key never stored)', async () => {
    const env = await seededEnv();
    const store = (env.TENANTS as unknown as { get: (k: string) => Promise<unknown> });
    // The raw key is never a KV key — only its hash is.
    expect(await store.get('apikey:key-A')).toBeNull();

    const tenant = await resolveTenant(env, 'key-A');
    expect(tenant?.tenantId).toBe('a');
    expect(tenant?.root.children[0].id).toBe('alpha');
  });

  it('returns null for an unknown key (host turns this into 401)', async () => {
    expect(await resolveTenant(await seededEnv(), 'bogus')).toBeNull();
  });

  it('returns null when tenant mode is off (fallback to env tree)', async () => {
    expect(await resolveTenant({} as AppEnv, 'anything')).toBeNull();
  });
});

describe('tenant isolation', () => {
  it('tenant A can resolve its own node but not tenant B-only nodes', async () => {
    const env = await seededEnv();
    const rootA = (await resolveTenant(env, 'key-A'))!.root;

    const ownHelp = await resolveHelp(env, rootA, ['alpha'], 'none', 'application/json');
    expect(ownHelp.status).toBe(200);

    // 'bravo' only exists in tenant B's tree → not found in A's root.
    await expect(resolveHelp(env, rootA, ['bravo'], 'none', 'application/json')).rejects.toBeInstanceOf(NotFoundError);
    await expect(resolveCall(env, rootA, ['bravo'], 'none', {})).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a crawl only enumerates the requesting tenant tree', async () => {
    const env = await seededEnv();
    const rootA = (await resolveTenant(env, 'key-A'))!.root;
    const rootB = (await resolveTenant(env, 'key-B'))!.root;

    const crawlA = flatten(await crawlTree(env, rootA, { path: '' }, 'none')).map((n) => n.path);
    const crawlB = flatten(await crawlTree(env, rootB, { path: '' }, 'none')).map((n) => n.path);

    expect(crawlA.some((p) => p.includes('alpha'))).toBe(true);
    expect(crawlA.some((p) => p.includes('bravo'))).toBe(false);
    expect(crawlB.some((p) => p.includes('bravo'))).toBe(true);
    expect(crawlB.some((p) => p.includes('alpha'))).toBe(false);
  });
});

describe('fallback to env tree', () => {
  it('parseTree(env) drives requests when no tenant root is present', () => {
    const env = { MCP_SERVERS_JSON: JSON.stringify(treeA) } as unknown as AppEnv;
    const root = parseTree(env);
    expect(root.children[0].id).toBe('alpha');
  });
});
