// @tokenroll/tb-host (alpha) — TASK-M1, SPEC-001 §8.3.
//
// The host platform's calling surface for tool-bridge. Everything here is a
// convenience over public wire contracts (§8.1 no SDK lock-in): each method is
// one documented HTTP request, reproducible with curl (see README), and the
// SDK performs NO authorization or confirmation decisions of its own — the
// server already does (§8.2).
//
// Integration model (shallow tier, §6.6):
//   - transport: service binding or HTTPS (a channel is not a credential);
//   - credential: one S2S key (principal=host, tenant-bound) minted by
//     POST /api/hosts/{id}/keys;
//   - `as` caller context becomes the X-TB-On-Behalf-Of audit annotation —
//     it is NOT a credential and grants nothing;
//   - builtin handler *implementations* are injected at deploy time by
//     embedding the bridge (`createBridge({ builtinHandlers })`); mounts:sync
//     declares the tree shape that routes to them.

import { errorFrom, rawRequest, requestJson, TBApiError } from '../client';
import { Transport } from '../transport';
import type { BuiltinHandler, BuiltinHandlerRegistry, HelpPayload, ToolEffect, ToolSpec } from '../../worker/tb/types';
import type { Placement } from '../../worker/tb/entities';

export interface HostOptions {
  transport: Transport;
  // S2S host key (shallow tier). Optional so a same-worker embedding that
  // runs without tenant mode can operate credential-less.
  credential?: string;
  // Required for mounts.sync: the registered host id.
  hostId?: string;
}

export interface CallContext {
  // Host-side caller identity, forwarded as X-TB-On-Behalf-Of (audit
  // annotation only — same semantics as HTBP X-Agent-Id, never a credential).
  as?: string;
  traceId?: string;
  reason?: string;
}

export interface HostMount {
  // Placement path inside the host's tenant tree, e.g. "watt/websearch".
  path: string;
  // Node config: { type: 'builtin'|'mcp'|'http'|'mount'|'remote', ... }.
  binding: Record<string, unknown>;
  version?: string;
  shaping?: Record<string, unknown>;
  semantics?: Record<string, unknown>;
}

export interface MountSyncResult {
  ok: true;
  applied: number;
  removed: number;
  placements: Placement[];
}

// Watt's error dialect for the wattError() adapter.
export interface WattError {
  code:
    | 'invalid_argument'
    | 'unauthenticated'
    | 'permission_denied'
    | 'not_found'
    | 'confirmation_required'
    | 'unavailable'
    | 'internal';
  message: string;
  retryable: boolean;
  cause?: { code: string; status: number; details?: unknown };
}

export function createToolBridgeHost(options: HostOptions) {
  const { transport, credential, hostId } = options;
  const handlers: BuiltinHandlerRegistry = {};

  const contextHeaders = (ctx: CallContext = {}): Record<string, string> => {
    const headers: Record<string, string> = {};
    if (ctx.as) {
      headers['X-TB-On-Behalf-Of'] = ctx.as;
    }
    if (ctx.traceId) {
      headers['X-TB-Trace-Id'] = ctx.traceId;
    }
    if (ctx.reason) {
      headers['X-TB-Reason'] = ctx.reason;
    }
    return headers;
  };

  const htbpPath = (path: string): string => `/htbp/${path.replace(/^\/+/, '').replace(/\/+$/, '')}`;

  return {
    // 1) Builtin injection: collect handler implementations for deploy-time
    // embedding — pass `builtins.registry()` to createBridge().
    builtins: {
      register(name: string, handler: BuiltinHandler): void {
        handlers[name] = handler;
      },
      registry(): BuiltinHandlerRegistry {
        return handlers;
      },
    },

    // 2) Mount sync: the host registry (e.g. Watt's D1 ToolRegistry) becomes
    // Provider/Publication/Placement records in the host's tenant tree.
    mounts: {
      async sync(mounts: HostMount[], opts: { prune?: boolean } = {}): Promise<MountSyncResult> {
        if (!hostId) {
          throw new TBApiError('bad_request', 400, 'mounts.sync requires a hostId in createToolBridgeHost options.');
        }
        return requestJson<MountSyncResult>(
          transport,
          credential,
          `/api/hosts/${encodeURIComponent(hostId)}/mounts:sync`,
          { method: 'POST', body: { mounts, prune: opts.prune } }
        );
      },
    },

    // 3) Tree consumption: the SAME resolve/grant path as any direct agent —
    // unauthorized resources are already invisible/uncallable server-side.
    tree: {
      async help(path: string, ctx: CallContext & { accept?: 'json' | 'text' } = {}): Promise<HelpPayload | string> {
        const response = await rawRequest(transport, credential, `${htbpPath(path)}/~help`, {
          headers: contextHeaders(ctx),
          accept: ctx.accept === 'text' ? 'text/plain' : 'application/json',
        });
        if (!response.ok) {
          throw await errorFrom(response);
        }
        return ctx.accept === 'text' ? response.text() : ((await response.json()) as HelpPayload);
      },
      async call(path: string, body: unknown, ctx: CallContext = {}): Promise<{ resource: string; result: unknown }> {
        return requestJson<{ resource: string; result: unknown }>(transport, credential, htbpPath(path), {
          method: 'POST',
          body: body ?? {},
          headers: contextHeaders(ctx),
        });
      },
    },

    // 4) Contract adapters: map the platform dialect to the host's, so the
    // host never inspects adapter internals (M0 acceptance).
    adapters: {
      wattError(): (error: unknown) => WattError {
        return (error: unknown): WattError => {
          if (!(error instanceof TBApiError)) {
            const message = error instanceof Error ? error.message : String(error);
            return { code: 'internal', message, retryable: false };
          }
          return {
            code: wattCodeFor(error),
            message: error.message,
            retryable: error.retryable,
            cause: { code: error.code, status: error.status, details: error.details },
          };
        };
      },
      // Map platform effect values into the host's enum. The platform default
      // (`external`, the most conservative tier) maps by table — e.g. Watt's
      // three-value model uses { external: 'destructive' }.
      effectMap(map: Partial<Record<ToolEffect, string>>): (payload: HelpPayload) => HelpPayload {
        const mapEffect = (effect: ToolEffect | undefined): string | undefined => {
          const key = effect ?? 'external';
          return map[key] ?? key;
        };
        return (payload: HelpPayload): HelpPayload => {
          const mapped: HelpPayload = { ...payload };
          if (payload.endpoint) {
            mapped.endpoint = {
              ...payload.endpoint,
              effect: mapEffect(payload.endpoint.effect) as ToolEffect,
              tools: payload.endpoint.tools?.map((tool: ToolSpec) => ({
                ...tool,
                effect: mapEffect(tool.effect) as ToolEffect,
              })),
            };
          }
          return mapped;
        };
      },
    },
  };
}

function wattCodeFor(error: TBApiError): WattError['code'] {
  switch (error.status) {
    case 400:
      return 'invalid_argument';
    case 401:
      return 'unauthenticated';
    case 403:
      return 'permission_denied';
    case 404:
      return 'not_found';
    case 409:
      return 'confirmation_required';
    case 502:
    case 503:
      return 'unavailable';
    default:
      return 'internal';
  }
}

export type ToolBridgeHost = ReturnType<typeof createToolBridgeHost>;
export { https, serviceBinding } from '../transport';
export type { Transport } from '../transport';
export { TBApiError } from '../client';

// Named for symmetry with the spec's `credential: s2sKey(env.TB_HOST_KEY)`
// example; the credential is just the raw key string.
export function s2sKey(key: string): string {
  return key;
}
