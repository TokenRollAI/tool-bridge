import { describe, expect, it } from 'vitest';
import { builtinAdapter, builtinToolSpecs, echoHandler } from './adapters/builtin';
import { parseTree } from './registry';
import { AdapterContext, AppEnv, BuiltinNode } from './types';

function builtinNode(): BuiltinNode {
  return {
    kind: 'builtin',
    id: 'tools',
    title: 'Builtins',
    description: 'Host-implemented tools',
    tools: [
      {
        name: 'echo',
        description: 'Echo the arguments back',
        handler: 'echo',
        inputSchema: { type: 'object', properties: { msg: { type: 'string' } } },
        effect: 'read',
      },
      {
        name: 'websearch',
        description: 'Search the web',
        handler: 'websearch',
        effect: 'external',
        scope: 'net.search',
        confirm: true,
      },
    ],
  };
}

const ctx: AdapterContext = {
  env: {} as unknown as AppEnv,
  authMode: 'none',
  basePath: '/htbp/tools',
  builtinHandlers: { echo: echoHandler },
};

describe('builtin adapter: tools are host-implemented leaves', () => {
  it('describe([]) lists tools as relative resources (no endpoint)', async () => {
    const payload = await builtinAdapter.describe(builtinNode(), ctx, []);
    expect(payload.kind).toBe('builtin');
    expect(payload.endpoint).toBeUndefined();
    expect(payload.resources?.map((r) => r.path)).toEqual(['./echo', './websearch']);
    expect(payload.resources?.[0].description).toBe('Echo the arguments back');
  });

  it('describe([tool]) is an end-path carrying schema + call semantics', async () => {
    const payload = await builtinAdapter.describe(builtinNode(), ctx, ['websearch']);
    expect(payload.resources).toBeUndefined();
    expect(payload.endpoint?.method).toBe('POST');
    expect(payload.endpoint?.effect).toBe('external');
    expect(payload.endpoint?.scope).toBe('net.search');
    expect(payload.endpoint?.confirm).toBe(true);
  });

  it('describe([tool]) defaults inputSchema and omits absent semantics', async () => {
    const payload = await builtinAdapter.describe(builtinNode(), ctx, ['echo']);
    expect(payload.endpoint?.effect).toBe('read');
    expect(payload.endpoint?.scope).toBeUndefined();
    expect(payload.endpoint?.confirm).toBeUndefined();
  });

  it('call([tool], input) dispatches to the host handler (echo reference impl)', async () => {
    const result = (await builtinAdapter.call(builtinNode(), ctx, ['echo'], { msg: 'hi' })) as {
      echo: unknown;
    };
    expect(result.echo).toEqual({ msg: 'hi' });
  });

  it('call unwraps an {arguments:{...}} envelope like the MCP adapter', async () => {
    const result = (await builtinAdapter.call(builtinNode(), ctx, ['echo'], { arguments: { a: 1 } })) as {
      echo: unknown;
    };
    expect(result.echo).toEqual({ a: 1 });
  });

  it('call rejects when the referenced handler was not registered', async () => {
    // websearch's handler is not in ctx.builtinHandlers.
    await expect(builtinAdapter.call(builtinNode(), ctx, ['websearch'], {})).rejects.toThrow(
      /handler 'websearch', which the host did not register/
    );
  });

  it('call([]) without a tool is rejected', async () => {
    await expect(builtinAdapter.call(builtinNode(), ctx, [], {})).rejects.toThrow(/requires a tool/);
  });

  it('describe rejects an unknown tool name', async () => {
    await expect(builtinAdapter.describe(builtinNode(), ctx, ['nope'])).rejects.toThrow(/is not exposed/);
  });

  it('builtinToolSpecs carries semantic fields for whole-leaf help', () => {
    const specs = builtinToolSpecs(builtinNode());
    expect(specs.find((s) => s.name === 'websearch')).toMatchObject({
      effect: 'external',
      scope: 'net.search',
      confirm: true,
    });
  });
});

describe('parseTree: builtin nodes', () => {
  function envWith(json: unknown): AppEnv {
    return { MCP_SERVERS_JSON: JSON.stringify(json) } as unknown as AppEnv;
  }

  it('parses a builtin node with a { builtin: { tools } } block', () => {
    const root = parseTree(
      envWith({
        type: 'directory',
        id: 'root',
        children: [
          {
            type: 'builtin',
            id: 'host',
            builtin: {
              tools: [{ name: 'echo', handler: 'echo', effect: 'read' }],
            },
          },
        ],
      })
    );
    const node = root.children[0];
    expect(node.kind).toBe('builtin');
    expect(node.kind === 'builtin' && node.tools[0]).toMatchObject({
      name: 'echo',
      handler: 'echo',
      effect: 'read',
    });
  });

  it('also accepts a flat { tools } shape', () => {
    const root = parseTree(
      envWith({
        type: 'directory',
        id: 'root',
        children: [{ type: 'builtin', id: 'host', tools: [{ name: 'echo', handler: 'echo' }] }],
      })
    );
    expect(root.children[0].kind === 'builtin' && root.children[0].tools).toHaveLength(1);
  });

  it('rejects a builtin tool missing its handler', () => {
    expect(() =>
      parseTree(
        envWith({
          type: 'directory',
          id: 'root',
          children: [{ type: 'builtin', id: 'host', tools: [{ name: 'echo' }] }],
        })
      )
    ).toThrow(/is missing handler/);
  });

  it('rejects a builtin node with no tools', () => {
    expect(() =>
      parseTree(envWith({ type: 'directory', id: 'root', children: [{ type: 'builtin', id: 'host', tools: [] }] }))
    ).toThrow(/must declare at least one tool/);
  });

  it('ignores an unknown effect value (falls back to undefined)', () => {
    const root = parseTree(
      envWith({
        type: 'directory',
        id: 'root',
        children: [{ type: 'builtin', id: 'host', tools: [{ name: 'e', handler: 'echo', effect: 'bogus' }] }],
      })
    );
    expect(root.children[0].kind === 'builtin' && root.children[0].tools[0].effect).toBeUndefined();
  });
});
