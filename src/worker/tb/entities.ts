// Control-plane entities (SPEC-001 §5.1/§5.2/§7, TASK-M3).
//
// Provider ──1:N──> Publication ──1:N──> Placement ──> a path in a tenant tree.
// The three entities are the control-plane source of truth; at request time
// enabled placements are *compiled* into the existing runtime TreeNode tree
// (decision D-1), so resolve/crawl/adapters stay untouched and grant checks
// remain path-based and deny-by-default (decision D-2).
//
// KV layout (SPEC-001 §7):
//   provider:{providerId}            -> Provider
//   pub:{providerId}:{pubId}         -> Publication
//   placement:{tenantId|_global}:{id}-> Placement
//
// Placement scoping: tenantId=null ("_global") materializes into the env tree
// used by non-tenant requests; a tenant's placements materialize only into that
// tenant's root. A global placement never leaks into a tenant tree.

import { BadRequestError, NotFoundError } from './errors';
import { linkParents, normalizeNodeConfig } from './registry';
import { AppEnv, DirectoryNode, ToolEffect, TreeNode } from './types';
import { isRecord, stringField } from './util';

export type TrustTier = 'builtin' | 'first-party' | 'verified' | 'community' | 'federated';
export type ProviderStatus = 'active' | 'suspended' | 'retired';
export type PublicationStatus = 'draft' | 'published' | 'deprecated' | 'retired';

export interface Provider {
  id: string; // Globally unique; the top-level namespace IS ownership.
  displayName: string;
  contact?: string;
  trustTier: TrustTier;
  status: ProviderStatus;
  createdAt: string;
  updatedAt: string;
}

// Per-tool call semantics declared by a Publication (SPEC-001 §5.8).
export interface ToolSemantics {
  effect?: ToolEffect;
  scope?: string;
  confirm?: boolean;
}

export interface Publication {
  providerId: string;
  pubId: string;
  version: string; // Semantic version; placements can pin the major.
  // Typed node config: `{ type: 'mcp'|'http'|'builtin'|'mount'|'remote', ... }`.
  // Validated with the exact normalization the env tree uses.
  binding: Record<string, unknown>;
  shaping?: { namespace?: string; toolOverrides?: Record<string, unknown> };
  semantics?: Record<string, ToolSemantics>; // keyed by upstream tool name
  status: PublicationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Placement {
  id: string;
  tenantId: string | null; // null = the global (env) tree
  path: string; // "/"-joined segments under /htbp, e.g. "tools/search"
  pubRef: { providerId: string; pubId: string; version?: string };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

const GLOBAL_SCOPE = '_global';

export function placementScope(tenantId: string | null): string {
  return tenantId ?? GLOBAL_SCOPE;
}

function now(): string {
  return new Date().toISOString();
}

function requireKV(env: AppEnv): KVNamespace {
  if (!env.TENANTS) {
    throw new BadRequestError('Provider entities require the TENANTS KV binding.');
  }
  return env.TENANTS;
}

export function entitiesEnabled(env: AppEnv): boolean {
  return !!env.TENANTS;
}

// ---- Provider store ----

const TRUST_TIERS: TrustTier[] = ['builtin', 'first-party', 'verified', 'community', 'federated'];
const PROVIDER_STATUSES: ProviderStatus[] = ['active', 'suspended', 'retired'];
const PUBLICATION_STATUSES: PublicationStatus[] = ['draft', 'published', 'deprecated', 'retired'];

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function assertEntityId(value: string | undefined, label: string): string {
  if (!value || !ID_PATTERN.test(value)) {
    throw new BadRequestError(`${label} must match ${ID_PATTERN} (lowercase alphanumeric, ".", "_", "-").`);
  }
  return value;
}

export async function getProvider(env: AppEnv, id: string): Promise<Provider | null> {
  return (await requireKV(env).get(`provider:${id}`, 'json')) as Provider | null;
}

export async function putProvider(env: AppEnv, provider: Provider): Promise<void> {
  await requireKV(env).put(`provider:${provider.id}`, JSON.stringify(provider));
}

export async function deleteProvider(env: AppEnv, id: string): Promise<void> {
  await requireKV(env).delete(`provider:${id}`);
}

export async function listProviders(env: AppEnv): Promise<Provider[]> {
  return listJson<Provider>(env, 'provider:');
}

export function normalizeProviderInput(value: unknown, existing?: Provider): Provider {
  if (!isRecord(value)) {
    throw new BadRequestError('Provider must be a JSON object.');
  }
  const id = existing?.id ?? assertEntityId(stringField(value, 'id'), 'provider id');
  const trustTier = (stringField(value, 'trustTier') ?? existing?.trustTier ?? 'community') as TrustTier;
  if (!TRUST_TIERS.includes(trustTier)) {
    throw new BadRequestError(`trustTier must be one of ${TRUST_TIERS.join(', ')}.`);
  }
  const status = (stringField(value, 'status') ?? existing?.status ?? 'active') as ProviderStatus;
  if (!PROVIDER_STATUSES.includes(status)) {
    throw new BadRequestError(`status must be one of ${PROVIDER_STATUSES.join(', ')}.`);
  }
  return {
    id,
    displayName: stringField(value, 'displayName') ?? existing?.displayName ?? id,
    contact: stringField(value, 'contact') ?? existing?.contact,
    trustTier,
    status,
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
  };
}

// ---- Publication store ----

export async function getPublication(env: AppEnv, providerId: string, pubId: string): Promise<Publication | null> {
  return (await requireKV(env).get(`pub:${providerId}:${pubId}`, 'json')) as Publication | null;
}

export async function putPublication(env: AppEnv, pub: Publication): Promise<void> {
  await requireKV(env).put(`pub:${pub.providerId}:${pub.pubId}`, JSON.stringify(pub));
}

export async function deletePublication(env: AppEnv, providerId: string, pubId: string): Promise<void> {
  await requireKV(env).delete(`pub:${providerId}:${pubId}`);
}

export async function listPublications(env: AppEnv, providerId: string): Promise<Publication[]> {
  return listJson<Publication>(env, `pub:${providerId}:`);
}

export function normalizePublicationInput(value: unknown, providerId: string, existing?: Publication): Publication {
  if (!isRecord(value)) {
    throw new BadRequestError('Publication must be a JSON object.');
  }
  const pubId = existing?.pubId ?? assertEntityId(stringField(value, 'pubId') ?? stringField(value, 'id'), 'pubId');
  const status = (stringField(value, 'status') ?? existing?.status ?? 'draft') as PublicationStatus;
  if (!PUBLICATION_STATUSES.includes(status)) {
    throw new BadRequestError(`status must be one of ${PUBLICATION_STATUSES.join(', ')}.`);
  }
  const binding = isRecord(value.binding) ? value.binding : existing?.binding;
  if (!binding) {
    throw new BadRequestError('Publication binding is required.');
  }
  const shaping = isRecord(value.shaping) ? (value.shaping as Publication['shaping']) : existing?.shaping;
  const semantics = parseSemantics(value.semantics) ?? existing?.semantics;
  const pub: Publication = {
    providerId,
    pubId,
    version: stringField(value, 'version') ?? existing?.version ?? '0.1.0',
    binding,
    shaping,
    semantics,
    status,
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
  };
  // Fail fast on invalid bindings: compile once with a placeholder id so a bad
  // publication is rejected at write time, not silently dropped at resolve time.
  compilePlacementNode(pub, 'binding-check');
  return pub;
}

function parseSemantics(value: unknown): Record<string, ToolSemantics> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const result: Record<string, ToolSemantics> = {};
  for (const [tool, raw] of Object.entries(value)) {
    if (!isRecord(raw)) {
      continue;
    }
    const effect = raw.effect;
    result[tool] = {
      effect:
        effect === 'read' || effect === 'write' || effect === 'destructive' || effect === 'external'
          ? effect
          : undefined,
      scope: stringField(raw, 'scope'),
      confirm: raw.confirm === true ? true : undefined,
    };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

// ---- Placement store ----

export async function getPlacement(env: AppEnv, tenantId: string | null, id: string): Promise<Placement | null> {
  return (await requireKV(env).get(`placement:${placementScope(tenantId)}:${id}`, 'json')) as Placement | null;
}

export async function putPlacement(env: AppEnv, placement: Placement): Promise<void> {
  await requireKV(env).put(
    `placement:${placementScope(placement.tenantId)}:${placement.id}`,
    JSON.stringify(placement)
  );
}

export async function deletePlacement(env: AppEnv, tenantId: string | null, id: string): Promise<void> {
  await requireKV(env).delete(`placement:${placementScope(tenantId)}:${id}`);
}

export async function listPlacements(env: AppEnv, tenantId: string | null): Promise<Placement[]> {
  return listJson<Placement>(env, `placement:${placementScope(tenantId)}:`);
}

// Placement paths are plain tree segments: no "~" control namespace, no empty
// or dot segments. The last segment becomes the materialized node id.
export function parsePlacementPath(path: string | undefined): string[] {
  const segments = (path ?? '')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new BadRequestError('Placement path is required.');
  }
  for (const segment of segments) {
    if (segment.startsWith('~') || segment === '.' || segment === '..' || !ID_PATTERN.test(segment)) {
      throw new BadRequestError(`Placement path segment '${segment}' is not allowed.`);
    }
  }
  return segments;
}

export function newPlacementId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `plc_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// ---- Materialization (D-1: compile placements into the runtime tree) ----

// Compile a Publication into the raw node-config shape the registry already
// validates, then normalize it into a TreeNode. Shaping and per-tool semantics
// are merged into the binding config (namespace / toolOverrides for mcp,
// endpoint or tool fields for http/builtin).
export function compilePlacementNode(pub: Publication, nodeId: string): TreeNode {
  const raw: Record<string, unknown> = { ...structuredCloneish(pub.binding), id: nodeId };
  delete raw.name; // `id` decides the path segment; binding `name` must not override it.
  if (pub.shaping?.namespace) {
    raw.namespace = pub.shaping.namespace;
  }
  if (pub.shaping?.toolOverrides) {
    raw.toolOverrides = { ...(isRecord(raw.toolOverrides) ? raw.toolOverrides : {}), ...pub.shaping.toolOverrides };
  }
  applySemantics(raw, pub.semantics);
  return normalizeNodeConfig(raw, `pub:${pub.providerId}:${pub.pubId}`);
}

function structuredCloneish<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// Merge Publication.semantics into the binding config where each kind carries
// tool semantics: mcp -> toolOverrides, http -> endpoints[], builtin -> tools[].
function applySemantics(raw: Record<string, unknown>, semantics: Record<string, ToolSemantics> | undefined): void {
  if (!semantics) {
    return;
  }
  const kind = raw.type ?? 'mcp';
  if (kind === 'mcp') {
    const overrides = isRecord(raw.toolOverrides) ? { ...raw.toolOverrides } : {};
    for (const [tool, spec] of Object.entries(semantics)) {
      overrides[tool] = { ...(isRecord(overrides[tool]) ? (overrides[tool] as object) : {}), ...spec };
    }
    raw.toolOverrides = overrides;
    return;
  }
  const items = kind === 'http' ? raw.endpoints : kind === 'builtin' ? raw.tools : undefined;
  if (Array.isArray(items)) {
    for (const item of items) {
      if (isRecord(item) && typeof item.name === 'string' && semantics[item.name]) {
        Object.assign(item, semantics[item.name]);
      }
    }
  }
}

export interface MaterializeResult {
  applied: number;
  skipped: Array<{ placementId: string; reason: string }>;
}

// Compile the scope's enabled placements into `root` (mutates the per-request
// tree). Config-tree nodes always win path conflicts; a placement whose target
// already exists is skipped, never overwritten.
export async function materializePlacements(
  env: AppEnv,
  root: DirectoryNode,
  tenantId: string | null
): Promise<MaterializeResult> {
  const result: MaterializeResult = { applied: 0, skipped: [] };
  if (!entitiesEnabled(env)) {
    return result;
  }
  const placements = await listPlacements(env, tenantId);
  if (placements.length === 0) {
    return result;
  }
  const providers = new Map<string, Provider | null>();
  const pubs = new Map<string, Publication | null>();

  for (const placement of placements) {
    if (!placement.enabled) {
      result.skipped.push({ placementId: placement.id, reason: 'disabled' });
      continue;
    }
    const { providerId, pubId, version } = placement.pubRef;
    if (!providers.has(providerId)) {
      providers.set(providerId, await getProvider(env, providerId));
    }
    const provider = providers.get(providerId);
    if (!provider || provider.status !== 'active') {
      result.skipped.push({ placementId: placement.id, reason: `provider ${provider ? provider.status : 'missing'}` });
      continue;
    }
    const pubKey = `${providerId}:${pubId}`;
    if (!pubs.has(pubKey)) {
      pubs.set(pubKey, await getPublication(env, providerId, pubId));
    }
    const pub = pubs.get(pubKey);
    if (!pub || (pub.status !== 'published' && pub.status !== 'deprecated')) {
      result.skipped.push({ placementId: placement.id, reason: `publication ${pub ? pub.status : 'missing'}` });
      continue;
    }
    if (version && majorOf(version) !== majorOf(pub.version)) {
      result.skipped.push({ placementId: placement.id, reason: `version pin ${version} != ${pub.version}` });
      continue;
    }
    let segments: string[];
    let node: TreeNode;
    try {
      segments = parsePlacementPath(placement.path);
      node = compilePlacementNode(pub, segments[segments.length - 1]);
    } catch (error) {
      result.skipped.push({ placementId: placement.id, reason: error instanceof Error ? error.message : 'invalid' });
      continue;
    }
    if (insertNode(root, segments.slice(0, -1), node)) {
      result.applied += 1;
    } else {
      result.skipped.push({ placementId: placement.id, reason: 'path conflict' });
    }
  }
  if (result.applied > 0) {
    linkParents(root);
  }
  return result;
}

function majorOf(version: string): string {
  return version.split('.')[0] ?? version;
}

// Descend (creating synthetic directories as needed) and append the node.
// Returns false on conflict: a non-directory blocks the parent chain, or a
// sibling with the same id already exists.
function insertNode(root: DirectoryNode, parents: string[], node: TreeNode): boolean {
  let dir = root;
  for (const segment of parents) {
    let child = dir.children.find((item) => item.id === segment);
    if (!child) {
      child = { kind: 'directory', id: segment, title: segment, children: [] };
      dir.children.push(child);
    }
    if (child.kind !== 'directory') {
      return false;
    }
    dir = child;
  }
  if (dir.children.some((item) => item.id === node.id)) {
    return false;
  }
  dir.children.push(node);
  return true;
}

// ---- Shared KV list helper ----

async function listJson<T>(env: AppEnv, prefix: string): Promise<T[]> {
  const kv = requireKV(env);
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix, cursor });
    for (const key of page.keys) {
      const value = (await kv.get(key.name, 'json')) as T | null;
      if (value) {
        out.push(value);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

export async function requirePlacement(env: AppEnv, tenantId: string | null, id: string): Promise<Placement> {
  const placement = await getPlacement(env, tenantId, id);
  if (!placement) {
    throw new NotFoundError(`Placement '${id}' not found in scope '${placementScope(tenantId)}'.`);
  }
  return placement;
}
