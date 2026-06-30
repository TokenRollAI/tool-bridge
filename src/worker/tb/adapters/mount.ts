// Mount adapter (FS as TB / S3 as TB): maps an object-storage prefix tree onto
// TB nodes. A sub-prefix is a directory (~help lists its immediate children);
// an object is a read-only end-path leaf (~help describes GET; call returns the
// object's contents). Children are listed lazily per level — large buckets stay
// cheap because only the visited level is fetched.

import { AdapterContext, HelpPayload, MountNode, ResourceRef, StorageProvider, TBAdapter } from '../types';
import { r2Provider } from '../storage-r2';

export const mountAdapter: TBAdapter<MountNode> = {
  kind: 'mount',

  async describe(node, ctx, sub): Promise<HelpPayload> {
    const provider = providerFor(ctx, node);
    const key = keyFor(node, sub);

    // An object at this exact key -> read-only leaf.
    const object = await provider.get(key);
    if (object) {
      return {
        htbp: 'draft',
        kind: 'mount',
        title: sub[sub.length - 1] ?? node.title,
        description: `File ${key} (${object.contentType ?? 'application/octet-stream'})`,
        cachable: true,
        endpoint: {
          method: 'GET',
          inputSchema: {},
          outputSchema: { type: 'string' },
          example: {},
        },
      };
    }

    // Otherwise treat it as a directory and list its immediate children.
    const entries = await provider.list(key);
    if (entries.length === 0 && sub.length > 0) {
      throw new Error(`No file or folder at '${key}'.`);
    }
    return {
      htbp: 'draft',
      kind: 'mount',
      title: sub.length === 0 ? node.title : (sub[sub.length - 1] ?? node.title),
      description: node.description,
      cachable: true,
      resources: entries.map(toResource),
    };
  },

  async call(node, ctx, sub): Promise<unknown> {
    const provider = providerFor(ctx, node);
    const key = keyFor(node, sub);
    const object = await provider.get(key);
    if (!object) {
      throw new Error(`File '${key}' not found.`);
    }
    return { key: object.key, contentType: object.contentType, content: object.body };
  },
};

function providerFor(ctx: AdapterContext, node: MountNode): StorageProvider {
  // Only R2 is wired today; the StorageProvider seam lets other backends plug in.
  return r2Provider(ctx.env, node.bucket);
}

// Join the mount's root prefix with the requested sub-path into a storage key.
function keyFor(node: MountNode, sub: string[]): string {
  const root = node.prefix ? trimSlashes(node.prefix) : '';
  const rest = sub.map((segment) => decodeURIComponent(segment)).join('/');
  return [root, rest].filter((part) => part.length > 0).join('/');
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function toResource(entry: { name: string; isDir: boolean }): ResourceRef {
  return {
    name: entry.name,
    path: `./${encodeURIComponent(entry.name)}`,
    description: entry.isDir ? 'folder' : 'file',
  };
}
