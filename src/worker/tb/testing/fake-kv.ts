// In-memory KVNamespace fake for tests: get/put/delete/list with prefix +
// cursor semantics, mirroring what entities/tenant/audit code relies on.
// Lives outside *.test.ts so every suite shares one implementation.

export interface FakeKV {
  get(key: string, type?: 'json' | 'text'): Promise<unknown>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    keys: Array<{ name: string }>;
    list_complete: boolean;
    cursor?: string;
  }>;
  // Test-side inspection of the raw store.
  dump(): Record<string, string>;
}

export function fakeKV(seed: Record<string, string> = {}): FakeKV {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    async get(key, type) {
      const raw = store.get(key);
      if (raw == null) {
        return null;
      }
      return type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
    async list(opts = {}) {
      const prefix = opts.prefix ?? '';
      const limit = opts.limit ?? 1000;
      const names = [...store.keys()].filter((name) => name.startsWith(prefix)).sort();
      const start = opts.cursor ? names.indexOf(opts.cursor) + 1 : 0;
      const page = names.slice(start, start + limit);
      const complete = start + page.length >= names.length;
      return {
        keys: page.map((name) => ({ name })),
        list_complete: complete,
        cursor: complete ? undefined : page[page.length - 1],
      };
    },
    dump() {
      return Object.fromEntries(store.entries());
    },
  };
}
