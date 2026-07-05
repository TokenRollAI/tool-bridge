// Principal resolution: resolve a Secret Key to its principal record (D-3
// unified subject record) and, when the record is tenant-bound, that tenant's
// TB tree.
//
// When the TENANTS KV binding is present, the bearer token is treated as a
// Secret Key. We look it up by its sha256 hash (raw keys are never stored).
// Legacy records carry only { tenantId } and default to the `agent` principal;
// M3 adds `provider` (tbp_ keys scoped to one provider namespace), `admin`
// (control-plane), and `host` (M1 S2S host keys, tenant-bound).
//
// The resolved root replaces the global env tree for the whole request, which
// is the tenant isolation boundary (see resolve.ts / crawl.ts — both walk only
// this root).

import { parseTreeFromJson } from './registry';
import { BadRequestError } from './errors';
import { AppEnv, DirectoryNode } from './types';
import { isRecord } from './util';

export type PrincipalKind = 'agent' | 'provider' | 'host' | 'admin' | 'service';

export interface PrincipalRecord {
  principal: PrincipalKind;
  tenantId?: string;
  providerId?: string;
  hostId?: string;
  label?: string;
  createdAt?: string;
  expiresAt?: string;
}

export interface PrincipalContext extends PrincipalRecord {
  // Present when the record is tenant-bound and that tenant has a tree config.
  root?: DirectoryNode;
}

export interface TenantContext {
  tenantId: string;
  root: DirectoryNode;
}

// Tenant mode is opt-in via TENANT_MODE=true (not merely the presence of the
// TENANTS KV binding, which is also used for non-tenant features like dynamic
// servers). This keeps a KV-backed deployment usable without forcing every
// request to carry a Secret Key.
export function tenantModeEnabled(env: AppEnv): boolean {
  return !!env.TENANTS && env.TENANT_MODE === 'true';
}

// Hex-encoded sha256 of the value. Used as the KV key for an API key so the raw
// secret never touches storage and lookup is by hash (no plaintext compare).
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const PRINCIPAL_KINDS: PrincipalKind[] = ['agent', 'provider', 'host', 'admin', 'service'];

// Resolve a Secret Key to its principal record + (for tenant-bound principals)
// the parsed tenant tree. Returns null when: KV is absent, the key is unknown,
// the key is expired, or an agent key's tenant config is missing (an agent
// without a tree can see nothing, so the key is treated as invalid).
export async function resolvePrincipal(env: AppEnv, token: string): Promise<PrincipalContext | null> {
  if (!env.TENANTS) {
    return null;
  }
  const hash = await sha256Hex(token);
  const raw = (await env.TENANTS.get(`apikey:${hash}`, 'json')) as Record<string, unknown> | null;
  if (!isRecord(raw)) {
    return null;
  }
  const principal = PRINCIPAL_KINDS.includes(raw.principal as PrincipalKind)
    ? (raw.principal as PrincipalKind)
    : 'agent'; // Legacy records ({ tenantId }) predate D-3 and are agent keys.
  const record: PrincipalContext = {
    principal,
    tenantId: typeof raw.tenantId === 'string' ? raw.tenantId : undefined,
    providerId: typeof raw.providerId === 'string' ? raw.providerId : undefined,
    hostId: typeof raw.hostId === 'string' ? raw.hostId : undefined,
    label: typeof raw.label === 'string' ? raw.label : undefined,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
    expiresAt: typeof raw.expiresAt === 'string' ? raw.expiresAt : undefined,
  };
  if (record.expiresAt && Date.parse(record.expiresAt) < Date.now()) {
    return null;
  }
  if (record.tenantId) {
    const config = await env.TENANTS.get(`tenant:${record.tenantId}`);
    if (config) {
      record.root = parseTreeFromJson(config);
    } else if (principal === 'agent') {
      return null;
    }
  } else if (principal === 'agent') {
    return null;
  }
  return record;
}

// Legacy helper kept for existing callers/tests: agent-key → tenant tree.
export async function resolveTenant(env: AppEnv, token: string): Promise<TenantContext | null> {
  const record = await resolvePrincipal(env, token);
  if (!record || !record.tenantId || !record.root) {
    return null;
  }
  return { tenantId: record.tenantId, root: record.root };
}

// ---- Key minting (control plane) ----

// Generate a platform key: `{prefix}_{32 hex chars}` (128 bits of entropy).
// tbk_ = agent/host Secret Key, tbp_ = provider key, tbs_ = service token.
export function generateKey(prefix: 'tbk' | 'tbp' | 'tbs'): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `${prefix}_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// Persist a key's principal record under its hash. The raw key is returned to
// the caller exactly once at mint time and never stored.
export async function storeApiKey(env: AppEnv, rawKey: string, record: PrincipalRecord): Promise<void> {
  if (!env.TENANTS) {
    throw new Error('API keys require the TENANTS KV binding.');
  }
  if (record.expiresAt && Number.isNaN(Date.parse(record.expiresAt))) {
    throw new BadRequestError('expiresAt must be a valid date string.');
  }
  await env.TENANTS.put(`apikey:${await sha256Hex(rawKey)}`, JSON.stringify(record));
}

// Enumerate stored key records (admin/dry-run use). Returns the hash suffix of
// each KV key so records can be revoked without ever knowing the raw secret.
export async function listApiKeyRecords(
  env: AppEnv
): Promise<Array<{ hash: string; record: PrincipalRecord }>> {
  if (!env.TENANTS) {
    return [];
  }
  const out: Array<{ hash: string; record: PrincipalRecord }> = [];
  let cursor: string | undefined;
  do {
    const page = await env.TENANTS.list({ prefix: 'apikey:', cursor });
    for (const key of page.keys) {
      const record = (await env.TENANTS.get(key.name, 'json')) as PrincipalRecord | null;
      if (record) {
        out.push({ hash: key.name.slice('apikey:'.length), record });
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}
