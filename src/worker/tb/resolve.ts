// Resolve URL path segments to a node and serve its help or invoke its endpoint.

import { adapterFor } from './adapters';
import { buildTextHelp } from './help';
import { findNode, nodePath } from './registry';
import { AdapterContext, AppEnv, AuthMode, DirectoryNode, HelpPayload } from './types';
import { json, text } from './util';

export interface ResolvedHelp {
  payload: HelpPayload;
  resourcePath: string;
}

// `root` is the tree to resolve against — the tenant's tree (multi-tenant) or
// the global env tree (fallback). Resolving against a single per-request root is
// the tenant isolation boundary: findNode only descends root.children.
async function describe(
  env: AppEnv,
  root: DirectoryNode,
  segments: string[],
  authMode: AuthMode
): Promise<ResolvedHelp> {
  const found = findNode(root, segments);
  if (!found) {
    throw new NotFoundError(`No TB resource at '/${segments.join('/')}'.`);
  }
  const resourcePath = nodePath(found.node);
  const ctx: AdapterContext = { env, authMode, basePath: resourcePath };
  const payload = await adapterFor(found.node).describe(found.node, ctx, found.sub);
  return { payload, resourcePath };
}

// GET {path}/~help with content negotiation: JSON by default, text DSL on
// `Accept: text/plain`.
export async function resolveHelp(
  env: AppEnv,
  root: DirectoryNode,
  segments: string[],
  authMode: AuthMode,
  accept: string
): Promise<Response> {
  const { payload, resourcePath } = await describe(env, root, segments, authMode);

  if (prefersText(accept)) {
    const auth = authMode === 'none' ? 'none' : 'bearer';
    return text(buildTextHelp(payload, resourcePath, auth), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': cacheControl(payload, authMode) },
    });
  }
  return json(payload, { headers: { 'Cache-Control': cacheControl(payload, authMode) } });
}

// POST {path} — invoke an end-path resource.
export async function resolveCall(
  env: AppEnv,
  root: DirectoryNode,
  segments: string[],
  authMode: AuthMode,
  input: unknown
): Promise<Response> {
  const found = findNode(root, segments);
  if (!found) {
    throw new NotFoundError(`No TB resource at '/${segments.join('/')}'.`);
  }
  const resourcePath = nodePath(found.node);
  const ctx: AdapterContext = { env, authMode, basePath: resourcePath };
  const result = await adapterFor(found.node).call(found.node, ctx, found.sub, input);
  return json({ resource: resourcePath, result });
}

export class NotFoundError extends Error {}

function prefersText(accept: string): boolean {
  const value = accept.toLowerCase();
  if (value.includes('application/json')) {
    return false;
  }
  return value.includes('text/plain') || value.includes('text/markdown');
}

function cacheControl(payload: HelpPayload, authMode: AuthMode): string {
  const scope = authMode === 'none' ? 'public' : 'private';
  return payload.cachable === false ? 'no-store' : `${scope}, max-age=300`;
}
