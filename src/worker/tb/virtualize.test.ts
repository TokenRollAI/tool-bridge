import { describe, expect, it } from 'vitest';
import { McpNode, ToolSpec } from './types';
import { resolveUpstreamTool, virtualizeTools } from './virtualize';

function mcpNode(overrides: Partial<McpNode> = {}): McpNode {
  return { kind: 'mcp', id: 'ctx7', title: 'Context7', endpoint: 'https://x/mcp', ...overrides };
}

const upstream: ToolSpec[] = [
  { name: 'query-docs', description: 'query the docs' },
  { name: 'resolve-library-id', description: 'resolve a name' },
  { name: 'internal-debug', description: 'do not expose' },
];

describe('virtualizeTools', () => {
  it('passes tools through unchanged when there is no config', () => {
    const { exposed, reverse } = virtualizeTools(mcpNode(), upstream);
    expect(exposed.map((t) => t.name)).toEqual(['query-docs', 'resolve-library-id', 'internal-debug']);
    expect(reverse.get('query-docs')).toBe('query-docs');
  });

  it('applies a namespace prefix to every exposed tool', () => {
    const { exposed, reverse } = virtualizeTools(mcpNode({ namespace: 'ctx7' }), upstream);
    expect(exposed.map((t) => t.name)).toContain('ctx7__query-docs');
    expect(reverse.get('ctx7__query-docs')).toBe('query-docs');
  });

  it('hides tools and renames/overrides description', () => {
    const node = mcpNode({
      toolOverrides: {
        'internal-debug': { hide: true },
        'query-docs': { rename: 'docs', description: 'short' },
      },
    });
    const { exposed, reverse } = virtualizeTools(node, upstream);
    const names = exposed.map((t) => t.name);
    expect(names).not.toContain('internal-debug');
    expect(names).toContain('docs');
    expect(exposed.find((t) => t.name === 'docs')?.description).toBe('short');
    expect(reverse.get('docs')).toBe('query-docs');
  });

  it('combines namespace prefix with rename', () => {
    const node = mcpNode({ namespace: 'c7', toolOverrides: { 'query-docs': { rename: 'docs' } } });
    const { reverse } = virtualizeTools(node, upstream);
    expect(reverse.get('c7__docs')).toBe('query-docs');
  });
});

describe('resolveUpstreamTool', () => {
  it('maps a virtual name back to the upstream name', () => {
    const node = mcpNode({ namespace: 'c7', toolOverrides: { 'query-docs': { rename: 'docs' } } });
    expect(resolveUpstreamTool(node, upstream, 'c7__docs')).toBe('query-docs');
  });

  it('rejects a hidden tool', () => {
    const node = mcpNode({ toolOverrides: { 'internal-debug': { hide: true } } });
    expect(() => resolveUpstreamTool(node, upstream, 'internal-debug')).toThrow(/not exposed/);
  });

  it('rejects an unknown tool', () => {
    expect(() => resolveUpstreamTool(mcpNode(), upstream, 'nope')).toThrow(/not exposed/);
  });
});
