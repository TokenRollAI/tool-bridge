// Directory adapter: a pure intermediate node. Its help lists child nodes as
// relative resources so an agent can descend one level at a time.
//
// For `remote` children we fetch the federated server's own root ~help and use
// its self-declared title/description, so this listing stays in sync with the
// remote server automatically. Fetches run concurrently and fall back to the
// local config values if the remote is slow or unreachable.

import { AdapterContext, DirectoryNode, HelpPayload, ResourceRef, RemoteNode, TreeNode } from '../types';
import { fetchRemoteHelp } from '../remote-client';

export const directoryAdapter = {
  kind: 'directory' as const,

  async describe(node: DirectoryNode, ctx: AdapterContext, sub: string[]): Promise<HelpPayload> {
    if (sub.length > 0) {
      // findNode would have descended into a real child; leftover segments here
      // mean the child id does not exist.
      throw new Error(`No child '${sub[0]}' under directory '${node.id}'.`);
    }
    const resources = await Promise.all(node.children.map((child) => toResource(child, ctx)));
    return {
      htbp: 'draft',
      kind: 'directory',
      title: node.title,
      description: node.summary,
      cachable: true,
      resources,
    };
  },

  async call(node: DirectoryNode): Promise<unknown> {
    throw new Error(`Directory '${node.id}' is not callable; descend to an end-path resource.`);
  },
};

async function toResource(child: TreeNode, ctx: AdapterContext): Promise<ResourceRef> {
  const ref: ResourceRef = {
    name: child.title,
    path: `./${encodeURIComponent(child.id)}`,
    description: childSummary(child),
  };
  if (child.kind === 'remote') {
    await enrichFromRemote(child, ctx, ref);
  }
  return ref;
}

// Overlay the federated server's self-declared name/description onto the
// listing. Best-effort: any failure leaves the config-provided values intact.
async function enrichFromRemote(child: RemoteNode, ctx: AdapterContext, ref: ResourceRef): Promise<void> {
  try {
    const remote = await fetchRemoteHelp(ctx.env, child.helpUrl, child.headers);
    if (remote.title) {
      ref.name = remote.title;
    }
    if (remote.description) {
      ref.description = remote.description;
    }
  } catch {
    // keep config-provided name/description
  }
}

function childSummary(child: TreeNode): string | undefined {
  if (child.kind === 'directory' || child.kind === 'http' || child.kind === 'remote') {
    return child.summary;
  }
  return child.description;
}
