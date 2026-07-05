// Host plane (TASK-M1, SPEC-001 §6.6 shallow tier + §9 宿主平面).
//
// A host (e.g. Watt) is a platform-type consumer: it holds one S2S key
// (principal=host, tenant-bound) and is modeled as a special first-party
// Provider (§5.2). Registration wires three things together:
//   host:{hostId}  -> host record (confirmDelegated flag, sync bookkeeping)
//   provider:{hostId} -> first-party provider owning everything the host syncs
//   tenant:{tenantId} -> the host's tree (created empty when absent)
//
// mounts:sync is declarative: the submitted mount list becomes Publications
// (pubId `mnt-{slug}`) + Placements (id `mnt_{slug}`) in the host's tenant
// scope, and host-owned entities missing from the list are pruned. Everything
// runs through the SAME resolve/grant path as any other placement — a host
// mount is not a bypass.
//
// Deep identity bridging (token verifier) is deliberately NOT here (M1 out of
// scope); the record reserves the `confirmDelegated` passthrough only.

import {
  deletePlacement,
  deletePublication,
  entitiesEnabled,
  getProvider,
  listPlacements,
  normalizePublicationInput,
  Placement,
  putPlacement,
  putProvider,
  putPublication,
  listPublications,
} from './entities';
import { BadRequestError, errorResponse, ForbiddenError, NotFoundError } from './errors';
import { ApiPrincipal } from './provider-api';
import { generateKey, storeApiKey } from './tenant';
import { AppEnv } from './types';
import { isRecord, json, stringField } from './util';

export interface HostRecord {
  id: string;
  tenantId: string;
  providerId: string;
  // §6.7 让位规则 passthrough: the host runs its own confirmation loop.
  confirmDelegated?: boolean;
  createdAt: string;
  updatedAt: string;
}

const HOST_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MOUNT_PUB_PREFIX = 'mnt-';
const MOUNT_PLACEMENT_PREFIX = 'mnt_';

function kv(env: AppEnv): KVNamespace {
  if (!env.TENANTS) {
    throw new BadRequestError('Hosts require the TENANTS KV binding.');
  }
  return env.TENANTS;
}

export async function getHost(env: AppEnv, id: string): Promise<HostRecord | null> {
  return (await kv(env).get(`host:${id}`, 'json')) as HostRecord | null;
}

// Routes /api/hosts/**. Returns undefined when the path is not a host route.
export async function routeHostApi(
  request: Request,
  env: AppEnv,
  principal: ApiPrincipal
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith('/api/hosts')) {
    return undefined;
  }
  if (!entitiesEnabled(env)) {
    return errorResponse(501, 'not_supported', 'Host registration requires the TENANTS KV binding.');
  }

  if (path === '/api/hosts' && request.method === 'POST') {
    requireAdmin(principal, 'Registering hosts');
    return createHost(request, env);
  }

  const match = /^\/api\/hosts\/([^/]+)(?:\/(.*))?$/.exec(path);
  if (!match) {
    return errorResponse(404, 'not_found', 'API route not found.');
  }
  const hostId = decodeURIComponent(match[1] ?? '');
  const rest = match[2] ?? '';

  if (!principal.isAdmin && !(principal.principal === 'host' && principal.hostId === hostId)) {
    throw new ForbiddenError(`Not allowed to access host '${hostId}'.`);
  }
  const host = await getHost(env, hostId);
  if (!host) {
    throw new NotFoundError(`Host '${hostId}' not found.`);
  }

  if (rest === '' && request.method === 'GET') {
    return json({ host });
  }
  if (rest === 'keys' && request.method === 'POST') {
    requireAdmin(principal, 'Minting host keys');
    const body = await readJson(request);
    const key = generateKey('tbk');
    const record = {
      principal: 'host' as const,
      hostId,
      tenantId: host.tenantId,
      providerId: host.providerId,
      label: stringField(body, 'label'),
      createdAt: new Date().toISOString(),
      expiresAt: stringField(body, 'expiresAt'),
    };
    await storeApiKey(env, key, record);
    // The raw S2S key is returned exactly once and never stored.
    return json({ key, record }, { status: 201 });
  }
  if (rest === 'mounts:sync' && request.method === 'POST') {
    return syncMounts(request, env, host);
  }

  return errorResponse(404, 'not_found', 'API route not found.');
}

function requireAdmin(principal: ApiPrincipal, what: string): void {
  if (!principal.isAdmin) {
    throw new ForbiddenError(`${what} requires an admin key.`);
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const value = (await request.json().catch(() => undefined)) as unknown;
  if (!isRecord(value)) {
    throw new BadRequestError('Request body must be a JSON object.');
  }
  return value;
}

async function createHost(request: Request, env: AppEnv): Promise<Response> {
  const body = await readJson(request);
  const id = stringField(body, 'id');
  if (!id || !HOST_ID_PATTERN.test(id)) {
    throw new BadRequestError(`Host id must match ${HOST_ID_PATTERN}.`);
  }
  if (await getHost(env, id)) {
    return errorResponse(409, 'conflict', `Host '${id}' already exists.`);
  }
  const tenantId = stringField(body, 'tenantId') ?? id;
  const nowIso = new Date().toISOString();
  const host: HostRecord = {
    id,
    tenantId,
    providerId: id,
    confirmDelegated: body.confirmDelegated === true ? true : undefined,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  // The host IS a first-party provider; its synced mounts publish under it.
  if (!(await getProvider(env, id))) {
    await putProvider(env, {
      id,
      displayName: stringField(body, 'displayName') ?? id,
      trustTier: 'first-party',
      status: 'active',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }
  // Give the host's tenant an (empty) tree so its S2S key resolves a root;
  // synced mounts materialize into it as placements.
  if (!(await kv(env).get(`tenant:${tenantId}`))) {
    await kv(env).put(
      `tenant:${tenantId}`,
      JSON.stringify({ type: 'directory', id: 'root', title: host.id, children: [] })
    );
  }
  await kv(env).put(`host:${id}`, JSON.stringify(host));
  return json({ host }, { status: 201 });
}

// ---- mounts:sync ----

interface MountInput {
  path: string;
  binding: Record<string, unknown>;
  version?: string;
  shaping?: Record<string, unknown>;
  semantics?: Record<string, unknown>;
}

function mountSlug(path: string): string {
  return path.replace(/\//g, '-');
}

async function syncMounts(request: Request, env: AppEnv, host: HostRecord): Promise<Response> {
  const body = await readJson(request);
  if (!Array.isArray(body.mounts)) {
    throw new BadRequestError('mounts must be an array of {path, binding}.');
  }
  const prune = body.prune !== false;
  const nowIso = new Date().toISOString();
  const applied: Placement[] = [];
  const keepPlacementIds = new Set<string>();
  const keepPubIds = new Set<string>();

  for (const raw of body.mounts) {
    if (!isRecord(raw)) {
      throw new BadRequestError('Each mount must be an object.');
    }
    const mount = raw as unknown as MountInput;
    if (typeof mount.path !== 'string' || !isRecord(mount.binding)) {
      throw new BadRequestError('Each mount needs a path and a binding object.');
    }
    const slug = mountSlug(mount.path);
    const pubId = `${MOUNT_PUB_PREFIX}${slug}`;
    const pub = normalizePublicationInput(
      {
        pubId,
        version: mount.version ?? '0.1.0',
        binding: mount.binding,
        shaping: mount.shaping,
        semantics: mount.semantics,
        status: 'published',
      },
      host.providerId
    );
    await putPublication(env, pub);
    keepPubIds.add(pubId);

    const placement: Placement = {
      id: `${MOUNT_PLACEMENT_PREFIX}${slug}`,
      tenantId: host.tenantId,
      path: mount.path,
      pubRef: { providerId: host.providerId, pubId },
      enabled: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await putPlacement(env, placement);
    keepPlacementIds.add(placement.id);
    applied.push(placement);
  }

  let removed = 0;
  if (prune) {
    // Declarative sync: host-owned entities absent from this submission go away.
    for (const placement of await listPlacements(env, host.tenantId)) {
      if (placement.id.startsWith(MOUNT_PLACEMENT_PREFIX) && !keepPlacementIds.has(placement.id)) {
        await deletePlacement(env, host.tenantId, placement.id);
        removed += 1;
      }
    }
    for (const pub of await listPublications(env, host.providerId)) {
      if (pub.pubId.startsWith(MOUNT_PUB_PREFIX) && !keepPubIds.has(pub.pubId)) {
        await deletePublication(env, host.providerId, pub.pubId);
      }
    }
  }

  await kv(env).put(`host:${host.id}`, JSON.stringify({ ...host, updatedAt: nowIso }));
  return json({ ok: true, applied: applied.length, removed, placements: applied });
}
