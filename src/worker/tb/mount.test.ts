import { describe, expect, it } from 'vitest';
import { mountAdapter } from './adapters/mount';
import { AdapterContext, AppEnv, MountNode } from './types';

// Minimal in-memory R2 bucket fake implementing the subset r2Provider uses
// (list with delimiter, get). Keys use "/" as the folder delimiter.
function fakeBucket(objects: Record<string, string>) {
  return {
    async list({ prefix = '', delimiter = '/' }: { prefix?: string; delimiter?: string }) {
      const keys = Object.keys(objects);
      const delimitedPrefixes = new Set<string>();
      const objs: { key: string; size: number }[] = [];
      for (const key of keys) {
        if (!key.startsWith(prefix)) {
          continue;
        }
        const rest = key.slice(prefix.length);
        const idx = rest.indexOf(delimiter);
        if (idx >= 0) {
          delimitedPrefixes.add(prefix + rest.slice(0, idx + 1));
        } else {
          objs.push({ key, size: objects[key].length });
        }
      }
      return { objects: objs, delimitedPrefixes: [...delimitedPrefixes] };
    },
    async get(key: string) {
      if (!(key in objects)) {
        return null;
      }
      const body = objects[key];
      return {
        size: body.length,
        httpMetadata: { contentType: 'text/plain' },
        async text() {
          return body;
        },
      };
    },
  };
}

const node: MountNode = { kind: 'mount', id: 'files', title: 'Files', bucket: 'TB_FILES' };

function ctxWith(objects: Record<string, string>): AdapterContext {
  const env = { TB_FILES: fakeBucket(objects) } as unknown as AppEnv;
  return { env, authMode: 'none', basePath: '/htbp/files' };
}

const tree = {
  'docs/intro.md': '# intro',
  'docs/guide/setup.md': 'setup',
  'readme.txt': 'hello',
};

describe('mount adapter describe', () => {
  it('lists the root level as relative resources (folders + files)', async () => {
    const payload = await mountAdapter.describe(node, ctxWith(tree), []);
    const names = (payload.resources ?? []).map((r) => r.path);
    expect(names).toContain('./docs');
    expect(names).toContain('./readme.txt');
    // All resource paths must be relative (mount invariant).
    for (const ref of payload.resources ?? []) {
      expect(ref.path.startsWith('./')).toBe(true);
    }
  });

  it('lists a sub-folder one level deep', async () => {
    const payload = await mountAdapter.describe(node, ctxWith(tree), ['docs']);
    const names = (payload.resources ?? []).map((r) => r.path);
    expect(names).toContain('./intro.md');
    expect(names).toContain('./guide');
  });

  it('describes an object as a read-only GET end-path', async () => {
    const payload = await mountAdapter.describe(node, ctxWith(tree), ['readme.txt']);
    expect(payload.endpoint?.method).toBe('GET');
    expect(payload.resources).toBeUndefined();
  });
});

describe('mount adapter call', () => {
  it('returns the object contents when reading a file leaf', async () => {
    const result = (await mountAdapter.call(node, ctxWith(tree), ['readme.txt'], {})) as { content: string };
    expect(result.content).toBe('hello');
  });

  it('throws when reading a missing file', async () => {
    await expect(mountAdapter.call(node, ctxWith(tree), ['nope.txt'], {})).rejects.toThrow(/not found/);
  });

  it('honors a mount prefix when building the storage key', async () => {
    const prefixed: MountNode = { ...node, prefix: 'docs' };
    const result = (await mountAdapter.call(prefixed, ctxWith(tree), ['intro.md'], {})) as { content: string };
    expect(result.content).toBe('# intro');
  });
});
