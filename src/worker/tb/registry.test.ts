import { describe, expect, it } from 'vitest';
import { findNode, nodePath, parseTree } from './registry';
import { AppEnv } from './types';

function envWith(json: unknown): AppEnv {
  return { MCP_SERVERS_JSON: JSON.stringify(json) } as unknown as AppEnv;
}

describe('parseTree', () => {
  it('wraps the legacy flat object form as a root directory of mcp nodes', () => {
    const root = parseTree(
      envWith({
        context7: { name: 'Context7', endpoint: 'https://mcp.context7.com/mcp' },
      })
    );
    expect(root.kind).toBe('directory');
    expect(root.children).toHaveLength(1);
    expect(root.children[0]).toMatchObject({ kind: 'mcp', id: 'context7', endpoint: 'https://mcp.context7.com/mcp' });
  });

  it('parses a nested tree with parent links and node paths', () => {
    const root = parseTree(
      envWith({
        type: 'directory',
        id: 'root',
        children: [
          {
            type: 'directory',
            id: 'docs',
            children: [{ type: 'mcp', id: 'context7', endpoint: 'https://mcp.context7.com/mcp' }],
          },
        ],
      })
    );
    const docs = root.children[0];
    expect(docs.kind).toBe('directory');
    const leaf = docs.kind === 'directory' ? docs.children[0] : undefined;
    expect(leaf?.parent).toBe(docs);
    expect(nodePath(leaf!)).toBe('/htbp/docs/context7');
  });

  it('throws on duplicate sibling ids', () => {
    expect(() =>
      parseTree(
        envWith({
          type: 'directory',
          id: 'root',
          children: [
            { type: 'mcp', id: 'a', endpoint: 'https://x/mcp' },
            { type: 'mcp', id: 'a', endpoint: 'https://y/mcp' },
          ],
        })
      )
    ).toThrow(/Duplicate sibling id/);
  });

  it('rejects an mcp node missing its endpoint', () => {
    expect(() =>
      parseTree(envWith({ type: 'directory', id: 'root', children: [{ type: 'mcp', id: 'broken' }] }))
    ).toThrow(/missing endpoint/);
  });
});

describe('findNode', () => {
  const root = parseTree({
    MCP_SERVERS_JSON: JSON.stringify({
      type: 'directory',
      id: 'root',
      children: [
        { type: 'directory', id: 'docs', children: [{ type: 'mcp', id: 'context7', endpoint: 'https://x/mcp' }] },
      ],
    }),
  } as unknown as AppEnv);

  it('resolves a directory path with no leftover sub-path', () => {
    const found = findNode(root, ['docs']);
    expect(found?.node.id).toBe('docs');
    expect(found?.sub).toEqual([]);
  });

  it('resolves a leaf plus its adapter sub-path (tool name)', () => {
    const found = findNode(root, ['docs', 'context7', 'search']);
    expect(found?.node.id).toBe('context7');
    expect(found?.sub).toEqual(['search']);
  });

  it('returns undefined for an unknown child', () => {
    expect(findNode(root, ['docs', 'nope'])).toBeUndefined();
  });
});
