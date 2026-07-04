// @tokenroll/tb-admin (provider subset, TASK-M3 / SPEC-001 §8.5).
//
// Thin typed wrapper over the /api/providers/** and /api/placements management
// plane. Principles (§8.5): every method is one documented REST call (curl
// equivalents in README), placements support dry-run impact reports, and
// secrets are write-only (a minted key is returned once, never readable back).

import { requestJson } from '../client';
import { Transport } from '../transport';
import type { Placement, Provider, Publication } from '../../worker/tb/entities';

export interface AdminOptions {
  transport: Transport;
  credential: string; // admin key (tenant mode) or the deployment bearer token
}

export interface PlacementInput {
  id?: string;
  tenantId?: string;
  path: string;
  pubRef: { providerId: string; pubId: string; version?: string };
  enabled?: boolean;
}

export interface PlacementImpact {
  dryRun: true;
  action: 'create' | 'update' | 'move' | 'delete';
  placement: Placement;
  affected: {
    tenantId: string;
    paths: string[];
    grants: Array<{ keyHash: string; principal: string; label?: string }>;
    note?: string;
  };
}

export function createToolBridgeAdmin(options: AdminOptions) {
  const { transport, credential } = options;
  const call = <T>(path: string, init?: Parameters<typeof requestJson>[3]) =>
    requestJson<T>(transport, credential, path, init);

  return {
    providers: {
      list: () => call<{ providers: Provider[] }>('/api/providers').then((r) => r.providers),
      get: (id: string) => call<{ provider: Provider }>(`/api/providers/${encodeURIComponent(id)}`).then((r) => r.provider),
      create: (provider: Partial<Provider> & { id: string }) =>
        call<{ provider: Provider }>('/api/providers', { method: 'POST', body: provider }).then((r) => r.provider),
      update: (id: string, patch: Partial<Provider>) =>
        call<{ provider: Provider }>(`/api/providers/${encodeURIComponent(id)}`, { method: 'PUT', body: patch }).then(
          (r) => r.provider
        ),
      delete: (id: string) => call<{ ok: true }>(`/api/providers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
      // Mint a tbp_ provider key. The raw key appears ONLY in this response.
      createKey: (id: string, opts: { label?: string; expiresAt?: string } = {}) =>
        call<{ key: string; record: { principal: 'provider'; providerId: string } }>(
          `/api/providers/${encodeURIComponent(id)}/keys`,
          { method: 'POST', body: opts }
        ),
    },
    publications: {
      list: (providerId: string) =>
        call<{ publications: Publication[] }>(`/api/providers/${encodeURIComponent(providerId)}/pubs`).then(
          (r) => r.publications
        ),
      get: (providerId: string, pubId: string) =>
        call<{ publication: Publication }>(
          `/api/providers/${encodeURIComponent(providerId)}/pubs/${encodeURIComponent(pubId)}`
        ).then((r) => r.publication),
      create: (providerId: string, pub: Partial<Publication> & { pubId: string; binding: Record<string, unknown> }) =>
        call<{ publication: Publication }>(`/api/providers/${encodeURIComponent(providerId)}/pubs`, {
          method: 'POST',
          body: pub,
        }).then((r) => r.publication),
      update: (providerId: string, pubId: string, patch: Partial<Publication>) =>
        call<{ publication: Publication }>(
          `/api/providers/${encodeURIComponent(providerId)}/pubs/${encodeURIComponent(pubId)}`,
          { method: 'PUT', body: patch }
        ).then((r) => r.publication),
      delete: (providerId: string, pubId: string) =>
        call<{ ok: true }>(`/api/providers/${encodeURIComponent(providerId)}/pubs/${encodeURIComponent(pubId)}`, {
          method: 'DELETE',
        }),
      publish: (providerId: string, pubId: string) =>
        call<{ publication: Publication }>(
          `/api/providers/${encodeURIComponent(providerId)}/pubs/${encodeURIComponent(pubId)}/publish`,
          { method: 'POST', body: {} }
        ).then((r) => r.publication),
    },
    placements: {
      list: (tenantId?: string) =>
        call<{ placements: Placement[] }>(
          `/api/placements${tenantId ? `?tenant=${encodeURIComponent(tenantId)}` : ''}`
        ).then((r) => r.placements),
      put: (placement: PlacementInput) =>
        call<{ placement: Placement; action: string }>('/api/placements', { method: 'POST', body: placement }),
      // Impact preview (D-2): which paths/grants a placement write would touch.
      dryRun: (placement: PlacementInput) =>
        call<PlacementImpact>('/api/placements', { method: 'POST', body: { ...placement, dryRun: true } }),
      delete: (id: string, tenantId?: string, opts: { dryRun?: boolean } = {}) =>
        call<{ ok: true } | PlacementImpact>(
          `/api/placements/${encodeURIComponent(id)}?${new URLSearchParams({
            ...(tenantId ? { tenant: tenantId } : {}),
            ...(opts.dryRun ? { dryRun: 'true' } : {}),
          }).toString()}`,
          { method: 'DELETE' }
        ),
    },
  };
}

export type ToolBridgeAdmin = ReturnType<typeof createToolBridgeAdmin>;
export { https, serviceBinding } from '../transport';
export { TBApiError } from '../client';
