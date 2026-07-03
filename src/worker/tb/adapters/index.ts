// Adapter registry: maps a NodeKind to its TBAdapter implementation.

import { NodeKind, TBAdapter, TreeNode } from '../types';
import { builtinAdapter } from './builtin';
import { directoryAdapter } from './directory';
import { httpAdapter } from './http';
import { mcpAdapter } from './mcp';
import { mountAdapter } from './mount';
import { remoteAdapter } from './remote';

const ADAPTERS: Record<NodeKind, TBAdapter<TreeNode>> = {
  directory: directoryAdapter as TBAdapter<TreeNode>,
  mcp: mcpAdapter as TBAdapter<TreeNode>,
  http: httpAdapter as TBAdapter<TreeNode>,
  remote: remoteAdapter as TBAdapter<TreeNode>,
  mount: mountAdapter as TBAdapter<TreeNode>,
  builtin: builtinAdapter as TBAdapter<TreeNode>,
};

export function adapterFor(node: TreeNode): TBAdapter<TreeNode> {
  const adapter = ADAPTERS[node.kind];
  if (!adapter) {
    throw new Error(`No adapter registered for node kind '${node.kind}'.`);
  }
  return adapter;
}
