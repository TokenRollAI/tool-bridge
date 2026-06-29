// Multi-tenancy: resolve a tenant (and its TB tree) from a Secret Key.
//
// When the TENANTS KV binding is present, the bearer token is treated as a
// Secret Key. We look it up by its sha256 hash (raw keys are never stored), get
// the tenant id, then load and parse that tenant's tree config. The resolved
// root replaces the global env tree for the whole request, which is the tenant
// isolation boundary (see resolve.ts / crawl.ts — both walk only this root).

import { parseTreeFromJson } from './registry';
import { AppEnv, DirectoryNode } from './types';

export interface TenantContext {
  tenantId: string;
  root: DirectoryNode;
}

interface ApiKeyRecord {
  tenantId: string;
  label?: string;
  createdAt?: string;
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

// Resolve a Secret Key to its tenant + parsed tree.
// Returns null when: tenant mode is off (no KV), the key is unknown, or the
// tenant's config is missing. Callers distinguish "mode off" via tenantModeEnabled.
export async function resolveTenant(env: AppEnv, token: string): Promise<TenantContext | null> {
  if (!env.TENANTS) {
    return null;
  }
  const hash = await sha256Hex(token);
  const mapping = (await env.TENANTS.get(`apikey:${hash}`, 'json')) as ApiKeyRecord | null;
  if (!mapping || typeof mapping.tenantId !== 'string') {
    return null;
  }
  const config = await env.TENANTS.get(`tenant:${mapping.tenantId}`);
  if (!config) {
    return null;
  }
  return { tenantId: mapping.tenantId, root: parseTreeFromJson(config) };
}
