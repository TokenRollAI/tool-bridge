// Tunnel Agent Kit skeleton (TASK-M2).
//
// This kit only speaks the placeholder M2 control-plane shape:
// connect, heartbeat, capability report, request dispatch, cancel/deadline.
// It deliberately does not implement bootstrap token rotation, mTLS, OAuth,
// credential storage, or a persistent streaming transport.

import { requestJson } from '../client';
import { Transport } from '../transport';
import type { DeviceTool, TunnelDispatchRequest } from '../../worker/tb/device';

export interface TunnelAgentOptions {
  transport: Transport;
  endpointId: string;
  // Placeholder bootstrap/session credential. M2 does not define lifecycle.
  credential?: string;
  dispatch: (request: TunnelDispatchRequest) => Promise<unknown> | unknown;
}

export interface ConnectResult {
  ok: true;
  endpointId: string;
  sessionId: string;
  capabilities: DeviceTool[];
}

export function createTunnelAgent(options: TunnelAgentOptions) {
  let sessionId: string | undefined;

  return {
    async connect(): Promise<ConnectResult> {
      const result = await requestJson<ConnectResult>(options.transport, options.credential, '/tunnel/connect', {
        method: 'POST',
        body: { endpointId: options.endpointId },
      });
      sessionId = result.sessionId;
      return result;
    },

    async heartbeat(): Promise<{ ok: true; endpointId: string }> {
      return requestJson(options.transport, options.credential, '/tunnel/heartbeat', {
        method: 'POST',
        body: requireSessionBody(options.endpointId, sessionId),
      });
    },

    async reportCapabilities(capabilities: DeviceTool[]): Promise<{ ok: true; endpointId: string; capabilities: DeviceTool[] }> {
      return requestJson(options.transport, options.credential, '/tunnel/capabilities', {
        method: 'POST',
        body: { ...requireSessionBody(options.endpointId, sessionId), capabilities },
      });
    },

    async dispatch(request: TunnelDispatchRequest): Promise<unknown> {
      if (request.endpointId !== options.endpointId) {
        throw new Error(`Dispatch target '${request.endpointId}' does not match endpoint '${options.endpointId}'.`);
      }
      return options.dispatch(request);
    },

    async cancel(_requestId: string): Promise<void> {
      // Reserved for the streaming broker shape. No local state to tear down in
      // the M2 skeleton.
    },
  };
}

function requireSessionBody(endpointId: string, sessionId: string | undefined): { endpointId: string; sessionId: string } {
  if (!sessionId) {
    throw new Error('Tunnel agent is not connected.');
  }
  return { endpointId, sessionId };
}

export type TunnelAgent = ReturnType<typeof createTunnelAgent>;
