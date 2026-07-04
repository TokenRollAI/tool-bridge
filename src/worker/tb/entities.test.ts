// M3 entity materialization (D-1 compile) unit tests.

import { describe, expect, it } from 'vitest';
import {
  compilePlacementNode,
  materializePlacements,
  parsePlacementPath,
  Placement,
  Provider,
  Publication,
} from './entities';
import { parseTreeFromJson } from './registry';
import { fakeKV } from './testing/fake-kv';
import { AppEnv, HttpNode, McpNode } from './types';

const nowIso = '2026-07-04T00:00:00.000Z';

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'acme',
    displayName: 'Acme',
    trustTier: 'community',
    status: 'active',
    createdAt: nowIso,
    updatedAt: nowIso,
    ...overrides,
  };
}

function publication(overrides: Partial<Publication> = {}): Publication {
  return {
    providerId: 'acme',
    pubId: 'search',
    version: '1.2.0',
    binding: {
      type: 'http',
      endpoints: [{ name: 'query', method: 'POST', url: 'https://api.acme.dev/q' }],
    },
    status: 'published',
    createdAt: nowIso,
    updatedAt: nowIso,
    ...overrides,
  };
}

function placement(overrides: Partial<Placement> = {}): Placement {
  return {
    id: 'plc_1',
    tenantId: 'a',
    path: 'tools/search',
    pubRef: { providerId: 'acme', pubId: 'search' },
    enabled: true,
    createdAt: nowIso,
    updatedAt: nowIso,
    ...overrides,
  };
}

function envWith(records: Record<string, unknown>): AppEnv {
  const seed: Record<string, string> = {};
  for (const [key, value] of Object.entries(records)) {
    seed[key] = JSON.stringify(value);
  }
  return { TENANTS: fakeKV(seed) } as unknown as AppEnv;
}

const emptyRoot = () => parseTreeFromJson('{"type":"directory","id":"root","children":[]}');

describe('compilePlacementNode', () => {
  it('produces the existing TreeNode shape from a binding', () => {
    const node = compilePlacementNode(publication(), 'search') as HttpNode;
    expect(node.kind).toBe('http');
    expect(node.id).toBe('search');
    expect(node.endpoints[0].name).toBe('query');
  });

  it('merges per-tool semantics into http endpoints', () => {
    const pub = publication({ semantics: { query: { effect: 'read', scope: 'search:query' } } });
    const node = compilePlacementNode(pub, 'search') as HttpNode;
    expect(node.endpoints[0].effect).toBe('read');
    expect(node.endpoints[0].scope).toBe('search:query');
  });

  it('merges semantics + shaping into an mcp binding via toolOverrides', () => {
    const pub = publication({
      binding: { type: 'mcp', endpoint: 'https://mcp.acme.dev/mcp' },
      shaping: { namespace: 'acme', toolOverrides: { internal: { hide: true } } },
      semantics: { query: { effect: 'write', confirm: true } },
    });
    const node = compilePlacementNode(pub, 'search') as McpNode;
    expect(node.namespace).toBe('acme');
    expect(node.toolOverrides?.internal?.hide).toBe(true);
    expect(node.toolOverrides?.query).toMatchObject({ effect: 'write', confirm: true });
  });
});

describe('parsePlacementPath', () => {
  it('rejects control namespaces and traversal', () => {
    expect(() => parsePlacementPath('~device/x')).toThrow();
    expect(() => parsePlacementPath('a/../b')).toThrow();
    expect(() => parsePlacementPath('')).toThrow();
    expect(parsePlacementPath('tools/search')).toEqual(['tools', 'search']);
  });
});

describe('materializePlacements', () => {
  it('compiles enabled placements into the tenant tree with synthetic directories', async () => {
    const env = envWith({
      'provider:acme': provider(),
      'pub:acme:search': publication(),
      'placement:a:plc_1': placement(),
    });
    const root = emptyRoot();
    const result = await materializePlacements(env, root, 'a');
    expect(result.applied).toBe(1);
    const tools = root.children.find((c) => c.id === 'tools');
    expect(tools?.kind).toBe('directory');
    const search = tools?.kind === 'directory' ? tools.children.find((c) => c.id === 'search') : undefined;
    expect(search?.kind).toBe('http');
    // parent links restored so nodePath() works for materialized nodes
    expect(search?.parent).toBe(tools);
  });

  it('deny-by-default scoping: tenant placements never leak across scopes', async () => {
    const env = envWith({
      'provider:acme': provider(),
      'pub:acme:search': publication(),
      'placement:a:plc_1': placement(),
    });
    const globalRoot = emptyRoot();
    expect((await materializePlacements(env, globalRoot, null)).applied).toBe(0);
    const tenantB = emptyRoot();
    expect((await materializePlacements(env, tenantB, 'b')).applied).toBe(0);
    expect(globalRoot.children).toHaveLength(0);
    expect(tenantB.children).toHaveLength(0);
  });

  it('skips draft publications, suspended providers, disabled placements', async () => {
    const env = envWith({
      'provider:acme': provider({ status: 'suspended' }),
      'provider:beta': provider({ id: 'beta' }),
      'pub:acme:search': publication(),
      'pub:beta:draft': publication({ providerId: 'beta', pubId: 'draft', status: 'draft' }),
      'pub:beta:ok': publication({ providerId: 'beta', pubId: 'ok' }),
      'placement:a:p1': placement({ id: 'p1' }),
      'placement:a:p2': placement({ id: 'p2', path: 'd', pubRef: { providerId: 'beta', pubId: 'draft' } }),
      'placement:a:p3': placement({ id: 'p3', path: 'off', pubRef: { providerId: 'beta', pubId: 'ok' }, enabled: false }),
    });
    const root = emptyRoot();
    const result = await materializePlacements(env, root, 'a');
    expect(result.applied).toBe(0);
    expect(result.skipped.map((s) => s.reason).sort()).toEqual([
      'disabled',
      'provider suspended',
      'publication draft',
    ]);
  });

  it('skips on major-version pin mismatch', async () => {
    const env = envWith({
      'provider:acme': provider(),
      'pub:acme:search': publication({ version: '2.0.0' }),
      'placement:a:p1': placement({ pubRef: { providerId: 'acme', pubId: 'search', version: '1' } }),
    });
    const result = await materializePlacements(env, emptyRoot(), 'a');
    expect(result.applied).toBe(0);
    expect(result.skipped[0].reason).toContain('version pin');
  });

  it('config tree wins path conflicts; placements never overwrite', async () => {
    const env = envWith({
      'provider:acme': provider(),
      'pub:acme:search': publication(),
      'placement:a:p1': placement({ path: 'existing' }),
    });
    const root = parseTreeFromJson(
      JSON.stringify({
        type: 'directory',
        id: 'root',
        children: [{ type: 'http', id: 'existing', endpoints: [{ name: 'x', method: 'GET', url: 'https://x.dev/1' }] }],
      })
    );
    const result = await materializePlacements(env, root, 'a');
    expect(result.applied).toBe(0);
    expect(result.skipped[0].reason).toBe('path conflict');
    const existing = root.children.find((c) => c.id === 'existing');
    expect(existing?.kind).toBe('http');
  });
});
