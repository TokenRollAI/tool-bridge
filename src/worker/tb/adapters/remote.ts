// Remote adapter (other TB Instance): federates to another TB Server by
// fetching its JSON `~help`. The remote help is treated as untrusted,
// provider-scoped navigation metadata only — we surface it, but never execute
// a remote endpoint from here and never forward the bridge bearer token.
//
//   describe(node, [])  -> fetch the remote node's ~help and pass it through
//   call(...)           -> rejected; recursive remote calls are out of scope

import { AdapterContext, HelpPayload, RemoteNode, TBAdapter } from '../types';
import { fetchRemoteHelp } from '../remote-client';

export const remoteAdapter: TBAdapter<RemoteNode> = {
  kind: 'remote',

  async describe(node, ctx): Promise<HelpPayload> {
    const payload = await fetchRemoteHelp(ctx.env, node.helpUrl, node.headers);
    // Mark provenance so callers / UI can render the trust boundary.
    return { ...payload, kind: 'remote', title: payload.title || node.title };
  },

  async call(node): Promise<unknown> {
    throw new Error(
      `Remote node '${node.id}' is a federation pointer; call the remote TB Server directly at its own endpoint.`
    );
  },
};
