// @tokenroll/tool-bridge/admin (management plane, TASK-M1/M2/M3/M4 / SPEC-001 §8.5).
//
// Thin typed wrapper over the public /api/** and /htbp/** management surfaces.
// Principles (§8.5): every method is one documented REST call (curl equivalents
// in docs/sdk.md), placements support dry-run impact reports, and secrets are
// write-only (a minted key is returned once, never readable back).

import { errorFrom, rawRequest, requestJson } from '../client';
import { Transport } from '../transport';
import type { Placement, Provider, Publication } from '../../worker/tb/entities';
import type { AuditEvent } from '../../worker/tb/audit';
import type { CommandPolicy, DeviceTool, EndpointRecord } from '../../worker/tb/device';
import type { HostRecord } from '../../worker/tb/host-api';
import type { CrawlNode, HelpPayload } from '../../worker/tb/types';

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

export interface ServerSummary {
  id: string;
  name: string;
  endpoint: string;
  description?: string;
  allowedTools?: string[];
  source?: 'static' | 'dynamic';
}

export interface AdhocServerInput {
  name?: string;
  endpoint: string;
  headers?: Record<string, string>;
  bearerToken?: string;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: unknown;
}

export interface EndpointInput {
  id: string;
  tenantId?: string;
  providerId?: string;
  kind?: EndpointRecord['kind'];
  driver?: EndpointRecord['driver'];
  label?: string;
  capabilities?: DeviceTool[];
  status?: EndpointRecord['status'];
  commandPolicyId?: string;
  ssh?: EndpointRecord['ssh'];
  k8s?: EndpointRecord['k8s'];
}

export type CommandPolicyInput = Partial<CommandPolicy> & { id: string };

export function createToolBridgeAdmin(options: AdminOptions) {
  const { transport, credential } = options;
  const call = <T>(path: string, init?: Parameters<typeof requestJson>[3]) =>
    requestJson<T>(transport, credential, path, init);

  return {
    auth: {
      config: () =>
        requestJson<{ mode: 'none' | 'bearer' | 'oauth'; oauthIssuer?: string; oauthAudience?: string }>(
          transport,
          undefined,
          '/api/auth/config'
        ),
    },
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
    hosts: {
      create: (host: { id: string; tenantId?: string; displayName?: string; confirmDelegated?: boolean }) =>
        call<{ host: HostRecord }>('/api/hosts', { method: 'POST', body: host }).then((r) => r.host),
      get: (id: string) => call<{ host: HostRecord }>(`/api/hosts/${encodeURIComponent(id)}`).then((r) => r.host),
      createKey: (id: string, opts: { label?: string; expiresAt?: string } = {}) =>
        call<{ key: string; record: { principal: 'host'; hostId: string; tenantId: string; providerId: string } }>(
          `/api/hosts/${encodeURIComponent(id)}/keys`,
          { method: 'POST', body: opts }
        ),
    },
    endpoints: {
      list: () => call<{ endpoints: EndpointRecord[] }>('/api/endpoints').then((r) => r.endpoints),
      create: (endpoint: EndpointInput) =>
        call<{ endpoint: EndpointRecord }>('/api/endpoints', { method: 'POST', body: endpoint }).then((r) => r.endpoint),
      get: (id: string) => call<{ endpoint: EndpointRecord }>(`/api/endpoints/${encodeURIComponent(id)}`).then((r) => r.endpoint),
      update: (id: string, patch: Partial<EndpointInput>) =>
        call<{ endpoint: EndpointRecord }>(`/api/endpoints/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: patch,
        }).then((r) => r.endpoint),
      revoke: (id: string) =>
        call<{ endpoint: EndpointRecord }>(`/api/endpoints/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(
          (r) => r.endpoint
        ),
    },
    commandPolicies: {
      list: () => call<{ policies: CommandPolicy[] }>('/api/command-policies').then((r) => r.policies),
      create: (policy: CommandPolicyInput) =>
        call<{ policy: CommandPolicy }>('/api/command-policies', { method: 'POST', body: policy }).then((r) => r.policy),
      get: (id: string) =>
        call<{ policy: CommandPolicy }>(`/api/command-policies/${encodeURIComponent(id)}`).then((r) => r.policy),
      update: (id: string, patch: Partial<CommandPolicyInput>) =>
        call<{ policy: CommandPolicy }>(`/api/command-policies/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: patch,
        }).then((r) => r.policy),
      delete: (id: string) =>
        call<{ ok: true }>(`/api/command-policies/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    },
    audit: {
      events: (opts: { tenant?: string; limit?: number } = {}) => {
        const query = new URLSearchParams();
        if (opts.tenant) query.set('tenant', opts.tenant);
        if (opts.limit !== undefined) query.set('limit', String(opts.limit));
        return call<{ scope: string; events: AuditEvent[] }>(
          `/api/audit/events${query.size > 0 ? `?${query.toString()}` : ''}`
        );
      },
    },
    servers: {
      list: () =>
        call<{ servers: ServerSummary[]; dynamicEnabled?: boolean }>('/api/servers').then((r) => ({
          servers: r.servers,
          dynamicEnabled: r.dynamicEnabled === true,
        })),
      create: (server: { name?: string; endpoint: string; description?: string }) =>
        call<{ ok: true; id: string }>('/api/servers', { method: 'POST', body: server }),
      delete: (id: string) => call<{ ok: true }>(`/api/servers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
      get: (id: string) =>
        call<{ server: ServerSummary; links: { help: string; skill: string } }>(`/api/servers/${encodeURIComponent(id)}`),
      tools: (id: string) =>
        call<{ server: ServerSummary; tools: McpTool[] }>(`/api/servers/${encodeURIComponent(id)}/tools`),
      help: async (id: string): Promise<string> => {
        const response = await rawRequest(transport, credential, `/api/servers/${encodeURIComponent(id)}/~help`, {
          accept: 'text/plain',
        });
        if (!response.ok) throw await errorFrom(response);
        return response.text();
      },
      skill: async (id: string): Promise<string> => {
        const response = await rawRequest(transport, credential, `/api/servers/${encodeURIComponent(id)}/~skill`, {
          accept: 'text/markdown',
        });
        if (!response.ok) throw await errorFrom(response);
        return response.text();
      },
      call: (id: string, tool: string, args: unknown = {}) =>
        call<{ server: ServerSummary; tool: string; result: unknown }>(
          `/api/servers/${encodeURIComponent(id)}/tools/${encodeURIComponent(tool)}`,
          { method: 'POST', body: { arguments: args } }
        ),
    },
    bridge: {
      tools: (server: AdhocServerInput) =>
        call<{ server: ServerSummary; tools: McpTool[] }>('/api/bridge/tools', {
          method: 'POST',
          body: { server },
        }),
      call: (server: AdhocServerInput, tool: string, args: unknown = {}) =>
        call<{ server: ServerSummary; tool: string; result: unknown }>('/api/bridge/call', {
          method: 'POST',
          body: { server, tool, arguments: args },
        }),
    },
    tree: {
      get: () => call<{ tree: CrawlNode }>('/api/tree').then((r) => r.tree),
      crawl: (opts: { start?: { path?: string; url?: string }; maxDepth?: number; maxNodes?: number } = {}) =>
        call<{ tree: CrawlNode }>('/api/crawl', { method: 'POST', body: opts }).then((r) => r.tree),
      help: (path = '') =>
        call<HelpPayload>(`/htbp/${path.replace(/^\/+/, '').replace(/\/+$/, '')}/~help`.replace('/htbp//', '/htbp/')),
      call: (path: string, body: unknown = {}) =>
        call<{ resource: string; result: unknown }>(`/htbp/${path.replace(/^\/+/, '')}`, {
          method: 'POST',
          body,
        }),
    },
  };
}

export type ToolBridgeAdmin = ReturnType<typeof createToolBridgeAdmin>;
export { https, serviceBinding } from '../transport';
export { TBApiError } from '../client';
