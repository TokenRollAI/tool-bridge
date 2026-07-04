// Management plane for Provider/Publication/Placement (TASK-M3, SPEC-001 §9).
//
// Authorization model:
//   - admin: full access to every route here.
//   - provider principal (tbp_ key): reads/writes ONLY entities under its own
//     provider namespace (`provider:{own}`); everything else is Forbidden.
//     Providers cannot mint keys, create/delete providers, or touch placements
//     (placements are tenant-tree changes — an admin act).
//   - agent/host principals: Forbidden (control plane is not the data plane).
//
// Placement writes support dry-run (`dryRun: true` / `?dryRun=true`): the
// response reports the affected paths and grants without persisting anything
// (decision D-2: path is the permission key, so a placement move IS a
// permission change and must be previewable).

import {
  assertEntityId,
  deletePlacement,
  deleteProvider,
  deletePublication,
  entitiesEnabled,
  getPlacement,
  getProvider,
  getPublication,
  listPlacements,
  listProviders,
  listPublications,
  newPlacementId,
  normalizeProviderInput,
  normalizePublicationInput,
  parsePlacementPath,
  Placement,
  placementScope,
  putPlacement,
  putProvider,
  putPublication,
} from './entities';
import { BadRequestError, errorResponse, ForbiddenError, NotFoundError } from './errors';
import { generateKey, listApiKeyRecords, PrincipalKind, storeApiKey } from './tenant';
import { AppEnv } from './types';
import { isRecord, json, stringField } from './util';

// The authenticated caller as the control plane sees it.
export interface ApiPrincipal {
  isAdmin: boolean;
  principal?: PrincipalKind;
  providerId?: string;
  hostId?: string;
  tenantId?: string;
  subject?: string;
}

const MAX_BODY = 1_000_000;

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const length = request.headers.get('Content-Length');
  if (length && Number(length) > MAX_BODY) {
    throw new BadRequestError('Request body is too large.');
  }
  const value = (await request.json().catch(() => undefined)) as unknown;
  if (!isRecord(value)) {
    throw new BadRequestError('Request body must be a JSON object.');
  }
  return value;
}

function requireProviderAccess(principal: ApiPrincipal, providerId: string): void {
  if (principal.isAdmin) {
    return;
  }
  if (principal.principal === 'provider' && principal.providerId === providerId) {
    return;
  }
  throw new ForbiddenError(`Not allowed to access provider '${providerId}'.`);
}

function requireAdmin(principal: ApiPrincipal, what: string): void {
  if (!principal.isAdmin) {
    throw new ForbiddenError(`${what} requires an admin key.`);
  }
}

// Routes /api/providers/** and /api/placements/**. Returns undefined when the
// path belongs to neither, so the caller can fall through to other routes.
export async function routeProviderApi(
  request: Request,
  env: AppEnv,
  principal: ApiPrincipal
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith('/api/providers') && !path.startsWith('/api/placements')) {
    return undefined;
  }
  if (!entitiesEnabled(env)) {
    return errorResponse(501, 'not_supported', 'Provider entities require the TENANTS KV binding.');
  }

  // /api/placements ...
  if (path === '/api/placements' && request.method === 'GET') {
    requireAdmin(principal, 'Listing placements');
    const tenant = url.searchParams.get('tenant');
    const tenantId = !tenant || tenant === '_global' ? null : tenant;
    return json({ tenantId: placementScope(tenantId), placements: await listPlacements(env, tenantId) });
  }
  if (path === '/api/placements' && request.method === 'POST') {
    requireAdmin(principal, 'Writing placements');
    return putPlacementRoute(request, env);
  }
  const placementMatch = /^\/api\/placements\/([^/]+)$/.exec(path);
  if (placementMatch && request.method === 'DELETE') {
    requireAdmin(principal, 'Deleting placements');
    return deletePlacementRoute(request, env, decodeURIComponent(placementMatch[1] ?? ''), url);
  }

  // /api/providers ...
  if (path === '/api/providers' && request.method === 'GET') {
    if (principal.isAdmin) {
      return json({ providers: await listProviders(env) });
    }
    if (principal.principal === 'provider' && principal.providerId) {
      const own = await getProvider(env, principal.providerId);
      return json({ providers: own ? [own] : [] });
    }
    throw new ForbiddenError('Listing providers requires an admin or provider key.');
  }
  if (path === '/api/providers' && request.method === 'POST') {
    requireAdmin(principal, 'Creating providers');
    const provider = normalizeProviderInput(await readJson(request));
    if (await getProvider(env, provider.id)) {
      return errorResponse(409, 'conflict', `Provider '${provider.id}' already exists.`);
    }
    await putProvider(env, provider);
    return json({ provider }, { status: 201 });
  }

  const match = /^\/api\/providers\/([^/]+)(?:\/(.*))?$/.exec(path);
  if (!match) {
    return errorResponse(404, 'not_found', 'API route not found.');
  }
  const providerId = decodeURIComponent(match[1] ?? '');
  const rest = match[2] ?? '';
  requireProviderAccess(principal, providerId);

  const provider = await getProvider(env, providerId);
  if (!provider && !(rest === '' && request.method === 'PUT' && principal.isAdmin)) {
    throw new NotFoundError(`Provider '${providerId}' not found.`);
  }

  if (rest === '') {
    if (request.method === 'GET') {
      return json({ provider });
    }
    if (request.method === 'PUT') {
      const body = await readJson(request);
      // Owners may edit contact info only; lifecycle (status/trustTier) is
      // an admin decision — a provider must not un-suspend itself.
      const input = principal.isAdmin
        ? body
        : { displayName: body.displayName, contact: body.contact };
      const updated = normalizeProviderInput(input, provider ?? normalizeProviderInput({ id: providerId }));
      await putProvider(env, updated);
      return json({ provider: updated });
    }
    if (request.method === 'DELETE') {
      requireAdmin(principal, 'Deleting providers');
      const pubs = await listPublications(env, providerId);
      if (pubs.length > 0) {
        return errorResponse(409, 'conflict', `Provider '${providerId}' still has ${pubs.length} publication(s).`);
      }
      await deleteProvider(env, providerId);
      return json({ ok: true });
    }
  }

  if (rest === 'keys' && request.method === 'POST') {
    requireAdmin(principal, 'Minting provider keys');
    const body = await readJson(request);
    const key = generateKey('tbp');
    const record = {
      principal: 'provider' as const,
      providerId,
      label: stringField(body, 'label'),
      createdAt: new Date().toISOString(),
      expiresAt: stringField(body, 'expiresAt'),
    };
    await storeApiKey(env, key, record);
    // The raw key is returned exactly once and never stored.
    return json({ key, record }, { status: 201 });
  }

  if (rest === 'pubs') {
    if (request.method === 'GET') {
      return json({ publications: await listPublications(env, providerId) });
    }
    if (request.method === 'POST') {
      const pub = normalizePublicationInput(await readJson(request), providerId);
      if (await getPublication(env, providerId, pub.pubId)) {
        return errorResponse(409, 'conflict', `Publication '${pub.pubId}' already exists.`);
      }
      await putPublication(env, pub);
      return json({ publication: pub }, { status: 201 });
    }
  }

  const pubMatch = /^pubs\/([^/]+)(\/publish)?$/.exec(rest);
  if (pubMatch) {
    const pubId = decodeURIComponent(pubMatch[1] ?? '');
    const existing = await getPublication(env, providerId, pubId);
    if (pubMatch[2] === '/publish' && request.method === 'POST') {
      if (!existing) {
        throw new NotFoundError(`Publication '${pubId}' not found.`);
      }
      const published = { ...existing, status: 'published' as const, updatedAt: new Date().toISOString() };
      await putPublication(env, published);
      return json({ publication: published });
    }
    if (request.method === 'GET') {
      if (!existing) {
        throw new NotFoundError(`Publication '${pubId}' not found.`);
      }
      return json({ publication: existing });
    }
    if (request.method === 'PUT') {
      const pub = normalizePublicationInput({ ...(await readJson(request)), pubId }, providerId, existing ?? undefined);
      await putPublication(env, pub);
      return json({ publication: pub }, { status: existing ? 200 : 201 });
    }
    if (request.method === 'DELETE') {
      await deletePublication(env, providerId, pubId);
      return json({ ok: true });
    }
  }

  return errorResponse(404, 'not_found', 'API route not found.');
}

// ---- Placement write / dry-run ----

async function putPlacementRoute(request: Request, env: AppEnv): Promise<Response> {
  const body = await readJson(request);
  const tenantId = stringField(body, 'tenantId') ?? null;
  const segments = parsePlacementPath(stringField(body, 'path'));
  const pubRefRaw = isRecord(body.pubRef) ? body.pubRef : undefined;
  const pubRef = {
    providerId: assertEntityId(pubRefRaw && stringField(pubRefRaw, 'providerId'), 'pubRef.providerId'),
    pubId: assertEntityId(pubRefRaw && stringField(pubRefRaw, 'pubId'), 'pubRef.pubId'),
    version: pubRefRaw ? stringField(pubRefRaw, 'version') : undefined,
  };
  // Catch typos at write time: the referenced entities must exist (their
  // lifecycle state still decides whether they materialize).
  if (!(await getProvider(env, pubRef.providerId))) {
    throw new BadRequestError(`pubRef.providerId '${pubRef.providerId}' does not exist.`);
  }
  if (!(await getPublication(env, pubRef.providerId, pubRef.pubId))) {
    throw new BadRequestError(`pubRef.pubId '${pubRef.pubId}' does not exist under '${pubRef.providerId}'.`);
  }

  const id = stringField(body, 'id');
  const existing = id ? await getPlacement(env, tenantId, id) : null;
  const path = segments.join('/');
  const placement: Placement = {
    id: existing?.id ?? id ?? newPlacementId(),
    tenantId,
    path,
    pubRef,
    enabled: body.enabled !== false,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const dryRun = body.dryRun === true || new URL(request.url).searchParams.get('dryRun') === 'true';
  const action = existing ? (existing.path !== path ? 'move' : 'update') : 'create';
  const affectedPaths = existing && existing.path !== path ? [existing.path, path] : [path];
  if (dryRun) {
    return json({
      dryRun: true,
      action,
      placement,
      affected: await affectedGrants(env, tenantId, affectedPaths),
    });
  }
  await putPlacement(env, placement);
  return json({ placement, action }, { status: existing ? 200 : 201 });
}

async function deletePlacementRoute(request: Request, env: AppEnv, id: string, url: URL): Promise<Response> {
  const tenant = url.searchParams.get('tenant');
  const tenantId = !tenant || tenant === '_global' ? null : tenant;
  const existing = await getPlacement(env, tenantId, id);
  if (!existing) {
    throw new NotFoundError(`Placement '${id}' not found in scope '${placementScope(tenantId)}'.`);
  }
  if (url.searchParams.get('dryRun') === 'true') {
    return json({
      dryRun: true,
      action: 'delete',
      placement: existing,
      affected: await affectedGrants(env, tenantId, [existing.path]),
    });
  }
  await deletePlacement(env, tenantId, id);
  return json({ ok: true });
}

// The "affected grants" report (D-2). In the current grant model a Secret Key
// grants its tenant's whole tree, so the grants affected by a path change are
// exactly that tenant's keys. Only a truncated key hash is reported — never
// anything derived from the raw secret.
async function affectedGrants(
  env: AppEnv,
  tenantId: string | null,
  paths: string[]
): Promise<{ tenantId: string; paths: string[]; grants: Array<{ keyHash: string; principal: string; label?: string }>; note?: string }> {
  if (tenantId === null) {
    return {
      tenantId: placementScope(tenantId),
      paths,
      grants: [],
      note: 'Global tree: affects every non-tenant caller of /htbp.',
    };
  }
  const keys = await listApiKeyRecords(env);
  return {
    tenantId,
    paths,
    grants: keys
      .filter((entry) => entry.record.tenantId === tenantId)
      .map((entry) => ({
        keyHash: entry.hash.slice(0, 12),
        principal: entry.record.principal ?? 'agent',
        label: entry.record.label,
      })),
  };
}
