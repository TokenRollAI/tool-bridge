// Server-side recursive crawler.
//
// Walks the TB tree starting from a local path or a remote help URL, following
// each node's `resources[].path` links until reaching end-path leaves. Local
// nodes are walked directly against the in-memory tree (no self-HTTP); remote
// nodes are fetched and parsed. Bounded by depth, node count, cycle detection,
// and per-fetch size/time caps.

import { adapterFor } from './adapters';
import { findNode, nodePath, TREE_PREFIX } from './registry';
import { fetchRemoteHelp } from './remote-client';
import { AdapterContext, AppEnv, AuthMode, CrawlNode, DirectoryNode, HelpPayload } from './types';

export interface CrawlOptions {
  maxDepth: number;
  maxNodes: number;
}

export const DEFAULT_CRAWL_OPTIONS: CrawlOptions = { maxDepth: 8, maxNodes: 200 };
const HARD_MAX_DEPTH = 8;
const HARD_MAX_NODES = 200;

export function clampCrawlOptions(opts: Partial<CrawlOptions> | undefined): CrawlOptions {
  return {
    maxDepth: clamp(opts?.maxDepth ?? DEFAULT_CRAWL_OPTIONS.maxDepth, 1, HARD_MAX_DEPTH),
    maxNodes: clamp(opts?.maxNodes ?? DEFAULT_CRAWL_OPTIONS.maxNodes, 1, HARD_MAX_NODES),
  };
}

interface CrawlState {
  env: AppEnv;
  root: DirectoryNode;
  authMode: AuthMode;
  opts: CrawlOptions;
  visited: Set<string>;
  count: number;
}

export async function crawlTree(
  env: AppEnv,
  root: DirectoryNode,
  start: { path?: string; url?: string },
  authMode: AuthMode,
  opts: CrawlOptions = DEFAULT_CRAWL_OPTIONS
): Promise<CrawlNode> {
  const state: CrawlState = { env, root, authMode, opts, visited: new Set(), count: 0 };
  if (start.url) {
    return crawlRemote(state, start.url, 0);
  }
  return crawlLocal(state, segmentsOf(start.path ?? ''), 0);
}

// ---- Local tree walking (no self-HTTP) ----

async function crawlLocal(state: CrawlState, segments: string[], depth: number): Promise<CrawlNode> {
  // Walk the request's single resolved root (tenant tree or global env tree).
  // Reusing one root for every recursion is what keeps a crawl tenant-scoped.
  const found = findNode(state.root, segments);
  const path = segments.length === 0 ? TREE_PREFIX : `${TREE_PREFIX}/${segments.join('/')}`;
  if (!found) {
    return { kind: 'directory', path, helpUrl: `${path}/~help`, children: [], error: 'Resource not found.' };
  }

  // The full request path (node + adapter sub-path) addresses this resource;
  // nodePath(node) alone would collapse sibling leaves (e.g. two MCP tools)
  // onto the same path.
  const resourcePath = path;
  const ctx: AdapterContext = { env: state.env, authMode: state.authMode, basePath: nodePath(found.node) };

  // Remote nodes punch out to HTTP crawling.
  if (found.node.kind === 'remote') {
    return crawlRemote(state, found.node.helpUrl, depth, resourcePath);
  }

  let payload: HelpPayload;
  try {
    payload = await adapterFor(found.node).describe(found.node, ctx, found.sub);
  } catch (error) {
    return { kind: found.node.kind, path: resourcePath, helpUrl: `${resourcePath}/~help`, children: [], error: messageOf(error) };
  }

  const node = baseNode(payload, resourcePath, `${resourcePath}/~help`);
  return descend(state, node, payload, depth, (childSegments) => crawlLocal(state, childSegments, depth + 1), resourcePath);
}

// ---- Remote HTTP crawling ----

async function crawlRemote(state: CrawlState, helpUrl: string, depth: number, localPath?: string): Promise<CrawlNode> {
  const canonical = canonicalRemote(helpUrl);
  const path = localPath ?? helpUrl;
  let payload: HelpPayload;
  try {
    payload = await fetchRemoteHelp(state.env, helpUrl, undefined);
  } catch (error) {
    return { kind: 'remote', path, helpUrl, children: [], error: messageOf(error) };
  }
  const node = baseNode(payload, path, helpUrl);
  node.kind = 'remote';
  return descend(
    state,
    node,
    payload,
    depth,
    (_childSegments, childHelpUrl) => crawlRemote(state, childHelpUrl, depth + 1),
    canonical,
    helpUrl
  );
}

// ---- Shared descent logic ----

async function descend(
  state: CrawlState,
  node: CrawlNode,
  payload: HelpPayload,
  depth: number,
  recurse: (childSegments: string[], childHelpUrl: string) => Promise<CrawlNode>,
  cycleKey: string,
  remoteBaseUrl?: string
): Promise<CrawlNode> {
  if (payload.endpoint) {
    node.endpoint = payload.endpoint;
    return node;
  }
  if (state.visited.has(cycleKey)) {
    node.truncated = true;
    return node;
  }
  state.visited.add(cycleKey);

  if (depth >= state.opts.maxDepth) {
    node.truncated = true;
    return node;
  }

  for (const resource of payload.resources ?? []) {
    if (state.count >= state.opts.maxNodes) {
      node.truncated = true;
      break;
    }
    state.count += 1;
    if (remoteBaseUrl) {
      const childHelpUrl = resolveRemoteChild(remoteBaseUrl, resource.path);
      node.children.push(await recurse([], childHelpUrl));
    } else {
      const childSegments = resolveLocalChild(node.path, resource.path);
      node.children.push(await recurse(childSegments, ''));
    }
  }
  return node;
}

// ---- Helpers ----

function baseNode(payload: HelpPayload, path: string, helpUrl: string): CrawlNode {
  return {
    kind: payload.kind,
    path,
    title: payload.title,
    description: payload.description,
    helpUrl,
    children: [],
  };
}

function segmentsOf(path: string): string[] {
  return path
    .replace(/^\/?htbp\/?/, '')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// "/htbp/docs" + "./context7" -> ["docs", "context7"]
function resolveLocalChild(parentPath: string, relative: string): string[] {
  const parent = segmentsOf(parentPath);
  if (relative.startsWith('../')) {
    return [...parent.slice(0, -1), ...trimRelative(relative.slice(3))];
  }
  if (relative.startsWith('./')) {
    return [...parent, ...trimRelative(relative.slice(2))];
  }
  return [...parent, ...trimRelative(relative)];
}

function trimRelative(value: string): string[] {
  return value.split('/').filter((s) => s.length > 0);
}

// Resolve a relative resource path against a remote help URL.
// "https://x/docs/~help" + "./context7" -> "https://x/docs/context7/~help"
function resolveRemoteChild(remoteHelpUrl: string, relative: string): string {
  const base = remoteHelpUrl.replace(/\/~help$/, '/');
  const resolved = new URL(relative.endsWith('/~help') ? relative : `${stripTrailingSlash(relative)}/~help`, base);
  return resolved.toString();
}

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function canonicalRemote(helpUrl: string): string {
  try {
    return new URL(helpUrl).toString();
  } catch {
    return helpUrl;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}
