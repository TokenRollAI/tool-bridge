import { describe, expect, it } from 'vitest';
import { directoryAdapter } from './adapters/directory';
import { buildTextHelp } from './help';
import { parseTree } from './registry';
import { AdapterContext, AppEnv, DirectoryNode, ResourceRef } from './types';

const env = { MCP_SERVERS_JSON: '{}' } as unknown as AppEnv;
const ctx: AdapterContext = { env, authMode: 'none', basePath: '/htbp/docs' };

function directoryFixture(): DirectoryNode {
  return parseTree({
    MCP_SERVERS_JSON: JSON.stringify({
      type: 'directory',
      id: 'root',
      children: [
        { type: 'directory', id: 'docs', children: [{ type: 'mcp', id: 'context7', endpoint: 'https://x/mcp' }] },
        { type: 'remote', id: 'partner', helpUrl: 'https://partner.example.com/~help' },
      ],
    }),
  } as unknown as AppEnv);
}

function isRelative(ref: ResourceRef): boolean {
  return ref.path.startsWith('./') || ref.path.startsWith('../');
}

describe('directory help payload', () => {
  it('emits relative-only resource paths (mount invariant)', async () => {
    const root = directoryFixture();
    const payload = await directoryAdapter.describe(root, ctx, []);
    expect(payload.resources?.length).toBe(2);
    for (const ref of payload.resources ?? []) {
      expect(isRelative(ref), `path '${ref.path}' must be relative`).toBe(true);
    }
  });
});

describe('buildTextHelp content negotiation', () => {
  it('renders link child lines for a directory payload', async () => {
    const root = directoryFixture();
    const payload = await directoryAdapter.describe(root, ctx, []);
    const textHelp = buildTextHelp(payload, '/htbp', 'none');
    expect(textHelp).toContain('htbp draft');
    expect(textHelp).toContain('resource /htbp');
    expect(textHelp).toContain('link child /htbp/docs/~help');
    expect(textHelp).toContain('link child /htbp/partner/~help');
  });

  it('renders a cmd line for an end-path endpoint payload', () => {
    const textHelp = buildTextHelp(
      { htbp: 'draft', kind: 'mcp', title: 'search', endpoint: { method: 'POST', inputSchema: {} } },
      '/htbp/docs/context7/search',
      'bearer'
    );
    expect(textHelp).toContain('cmd call POST /htbp/docs/context7/search');
    expect(textHelp).toContain('auth bearer');
  });
});
