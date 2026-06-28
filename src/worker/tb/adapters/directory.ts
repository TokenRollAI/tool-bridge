// Directory adapter: a pure intermediate node. Its help lists child nodes as
// relative resources so an agent can descend one level at a time.

import { AdapterContext, DirectoryNode, HelpPayload, ResourceRef, TBAdapter, TreeNode } from '../types';

export const directoryAdapter: TBAdapter<DirectoryNode> = {
  kind: 'directory',

  async describe(node, _ctx: AdapterContext, sub): Promise<HelpPayload> {
    if (sub.length > 0) {
      // findNode would have descended into a real child; leftover segments here
      // mean the child id does not exist.
      throw new Error(`No child '${sub[0]}' under directory '${node.id}'.`);
    }
    return {
      htbp: 'draft',
      kind: 'directory',
      title: node.title,
      description: node.summary,
      cachable: true,
      resources: node.children.map(toResource),
    };
  },

  async call(node): Promise<unknown> {
    throw new Error(`Directory '${node.id}' is not callable; descend to an end-path resource.`);
  },
};

function toResource(child: TreeNode): ResourceRef {
  return {
    name: child.title,
    path: `./${encodeURIComponent(child.id)}`,
    description: childSummary(child),
  };
}

function childSummary(child: TreeNode): string | undefined {
  if (child.kind === 'directory' || child.kind === 'http' || child.kind === 'remote') {
    return child.summary;
  }
  return child.description;
}
