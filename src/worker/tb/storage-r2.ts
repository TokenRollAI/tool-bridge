// R2-backed StorageProvider for the mount adapter.
//
// Wraps a Cloudflare R2 bucket binding behind the storage-agnostic
// StorageProvider interface. Uses delimiter-based listing so each level returns
// only its immediate sub-folders (delimitedPrefixes) and files (objects).

import { AppEnv, StorageEntry, StorageObject, StorageProvider } from './types';

const DELIMITER = '/';
const MAX_OBJECT_BYTES = 1_000_000;

// Cloudflare R2 binding surface (subset we use). Declared locally to avoid
// depending on the full @cloudflare/workers-types R2 surface at call sites.
interface R2ListResult {
  objects: { key: string; size?: number }[];
  delimitedPrefixes: string[];
}
interface R2ObjectBody {
  text(): Promise<string>;
  size?: number;
  httpMetadata?: { contentType?: string };
}
interface R2Bucket {
  list(options: { prefix?: string; delimiter?: string }): Promise<R2ListResult>;
  get(key: string): Promise<R2ObjectBody | null>;
}

export function r2Provider(env: AppEnv, bucketBinding: string): StorageProvider {
  const bucket = (env as unknown as Record<string, unknown>)[bucketBinding] as R2Bucket | undefined;
  if (!bucket || typeof bucket.list !== 'function') {
    throw new Error(`R2 bucket binding '${bucketBinding}' is not configured on this Worker.`);
  }
  return {
    async list(prefix: string): Promise<StorageEntry[]> {
      const normalized = prefix && !prefix.endsWith(DELIMITER) ? `${prefix}${DELIMITER}` : prefix;
      const result = await bucket.list({ prefix: normalized, delimiter: DELIMITER });
      const dirs: StorageEntry[] = result.delimitedPrefixes.map((full) => ({
        name: stripPrefix(full.replace(/\/$/, ''), normalized),
        key: full,
        isDir: true,
      }));
      const files: StorageEntry[] = result.objects
        // R2 returns the prefix placeholder object itself; skip exact matches.
        .filter((obj) => obj.key !== normalized)
        .map((obj) => ({ name: stripPrefix(obj.key, normalized), key: obj.key, isDir: false }));
      return [...dirs, ...files];
    },

    async get(key: string): Promise<StorageObject | null> {
      const object = await bucket.get(key);
      if (!object) {
        return null;
      }
      if (typeof object.size === 'number' && object.size > MAX_OBJECT_BYTES) {
        throw new Error(`Object '${key}' exceeds the maximum readable size.`);
      }
      const body = await object.text();
      return { key, body, contentType: object.httpMetadata?.contentType, size: object.size };
    },
  };
}

function stripPrefix(value: string, prefix: string): string {
  return prefix && value.startsWith(prefix) ? value.slice(prefix.length) : value;
}
