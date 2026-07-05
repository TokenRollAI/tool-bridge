// Legacy /api/servers compatibility layer (TASK-M3, SPEC-001 §9 兼容层).
//
// POST /api/servers historically wrote a `dynamic-server:` KV record consumed
// only by the legacy /api/servers + /mcp/* surface. M3 translates the same
// registration into first-class entities: an anonymous compat Provider
// ("dynamic") + one published mcp Publication per server + a global Placement
// at the server's slug. Registration therefore now ALSO appears in the /htbp
// global tree via placement materialization, while every legacy read keeps
// working:
//   - listDynamicServers() returns entity-backed servers plus any pre-existing
//     legacy records (entity wins on id collision);
//   - putDynamicServer() writes entities and removes the legacy record;
//   - deleteDynamicServer() removes both representations.

import {
  getProvider,
  getPublication,
  deletePlacement,
  deletePublication,
  listPublications,
  putPlacement,
  putProvider,
  putPublication,
} from './entities';
import { AppEnv } from './types';
import { isRecord, stringField } from './util';

const LEGACY_PREFIX = 'dynamic-server:';

// The anonymous provider every compat registration hangs off. Reserved id;
// admins should not reuse it for a real provider.
export const COMPAT_PROVIDER_ID = 'dynamic';

export interface DynamicServer {
  id: string;
  name: string;
  endpoint: string;
  description?: string;
}

export function dynamicServersEnabled(env: AppEnv): boolean {
  return !!env.TENANTS;
}

export async function listDynamicServers(env: AppEnv): Promise<DynamicServer[]> {
  if (!env.TENANTS) {
    return [];
  }
  const fromEntities = await listCompatServers(env);
  const seen = new Set(fromEntities.map((server) => server.id));
  const legacy = (await listLegacyServers(env)).filter((server) => !seen.has(server.id));
  return [...fromEntities, ...legacy];
}

export async function putDynamicServer(env: AppEnv, server: DynamicServer): Promise<void> {
  if (!env.TENANTS) {
    throw new Error('Dynamic servers require the TENANTS KV binding.');
  }
  const nowIso = new Date().toISOString();
  if (!(await getProvider(env, COMPAT_PROVIDER_ID))) {
    await putProvider(env, {
      id: COMPAT_PROVIDER_ID,
      displayName: 'Dynamic Servers (compat)',
      trustTier: 'community',
      status: 'active',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }
  const existing = await getPublication(env, COMPAT_PROVIDER_ID, server.id);
  await putPublication(env, {
    providerId: COMPAT_PROVIDER_ID,
    pubId: server.id,
    version: existing?.version ?? '0.0.0',
    binding: {
      type: 'mcp',
      name: server.name,
      endpoint: server.endpoint,
      description: server.description,
    },
    status: 'published',
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  });
  await putPlacement(env, {
    id: compatPlacementId(server.id),
    tenantId: null,
    path: server.id,
    pubRef: { providerId: COMPAT_PROVIDER_ID, pubId: server.id },
    enabled: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  // The entity records are now the source of truth for this id.
  await env.TENANTS.delete(`${LEGACY_PREFIX}${server.id}`);
}

export async function deleteDynamicServer(env: AppEnv, id: string): Promise<void> {
  if (!env.TENANTS) {
    throw new Error('Dynamic servers require the TENANTS KV binding.');
  }
  await env.TENANTS.delete(`${LEGACY_PREFIX}${id}`);
  await deletePublication(env, COMPAT_PROVIDER_ID, id);
  await deletePlacement(env, null, compatPlacementId(id));
}

function compatPlacementId(serverId: string): string {
  return `dyn_${serverId}`;
}

async function listCompatServers(env: AppEnv): Promise<DynamicServer[]> {
  const pubs = await listPublications(env, COMPAT_PROVIDER_ID);
  const out: DynamicServer[] = [];
  for (const pub of pubs) {
    const binding = isRecord(pub.binding) ? pub.binding : {};
    const endpoint = stringField(binding, 'endpoint');
    if (!endpoint) {
      continue;
    }
    out.push({
      id: pub.pubId,
      name: stringField(binding, 'name') ?? pub.pubId,
      endpoint,
      description: stringField(binding, 'description'),
    });
  }
  return out;
}

async function listLegacyServers(env: AppEnv): Promise<DynamicServer[]> {
  const kv = env.TENANTS;
  if (!kv) {
    return [];
  }
  const out: DynamicServer[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: LEGACY_PREFIX, cursor });
    for (const key of page.keys) {
      const raw = await kv.get(key.name);
      if (raw) {
        try {
          out.push(JSON.parse(raw) as DynamicServer);
        } catch {
          // skip malformed entry
        }
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}
