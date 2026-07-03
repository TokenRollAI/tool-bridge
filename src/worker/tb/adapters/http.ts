// HTTP adapter (Custom HTTP handler): exposes declared HTTP endpoints as TB
// resources and forwards calls to the upstream URL.
//
//   describe(node, [])         -> mid-path: list endpoints as relative resources
//   describe(node, [name])     -> end-path: declared method + input schema
//   call(node, [name], input)  -> forward to the endpoint's url

import { AdapterContext, HelpPayload, HttpEndpointConfig, HttpNode, ResourceRef, TBAdapter } from '../types';
import { assertRemoteHostAllowed, materializeHeaders, requireSecureUrl } from '../materialize';
import { MAX_JSON_BYTES, REMOTE_FETCH_TIMEOUT_MS, oneLine, readBoundedText, safeErrorText } from '../util';

export const httpAdapter: TBAdapter<HttpNode> = {
  kind: 'http',

  async describe(node, _ctx, sub): Promise<HelpPayload> {
    if (sub.length === 0) {
      return {
        htbp: 'draft',
        kind: 'http',
        title: node.title,
        description: node.summary,
        cachable: true,
        resources: node.endpoints.map(toResource),
      };
    }
    const endpoint = findEndpoint(node, sub[0]);
    return {
      htbp: 'draft',
      kind: 'http',
      title: endpoint.name,
      description: endpoint.description,
      cachable: true,
      endpoint: {
        method: endpoint.method,
        inputSchema: endpoint.inputSchema ?? {},
        outputSchema: endpoint.outputSchema,
        example: endpoint.example,
        effect: endpoint.effect,
        scope: endpoint.scope,
        confirm: endpoint.confirm,
      },
    };
  },

  async call(node, ctx, sub, input): Promise<unknown> {
    if (sub.length === 0) {
      throw new Error(`HTTP node '${node.id}' requires an endpoint name to call.`);
    }
    const endpoint = findEndpoint(node, sub[0]);
    const url = requireSecureUrl(ctx.env, endpoint.url, `HTTP endpoint '${endpoint.name}'`);
    assertRemoteHostAllowed(ctx.env, url);

    const headers = new Headers(materializeHeaders(ctx.env, endpoint.headers));
    const hasBody = endpoint.method !== 'GET' && endpoint.method !== 'HEAD';
    if (hasBody && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    headers.set('Accept', headers.get('Accept') ?? 'application/json');
    // Many APIs (e.g. GitHub) reject requests without a User-Agent.
    if (!headers.has('User-Agent')) {
      headers.set('User-Agent', 'tool-bridge');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: endpoint.method,
        headers,
        body: hasBody ? JSON.stringify(input ?? {}) : undefined,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP endpoint '${endpoint.name}' returned ${response.status}: ${await safeErrorText(response)}`);
      }
      const body = await readBoundedText(response, MAX_JSON_BYTES);
      const contentType = response.headers.get('Content-Type') ?? '';
      return contentType.includes('application/json') && body ? JSON.parse(body) : body;
    } finally {
      clearTimeout(timer);
    }
  },
};

function toResource(endpoint: HttpEndpointConfig): ResourceRef {
  return {
    name: endpoint.name,
    path: `./${encodeURIComponent(endpoint.name)}`,
    description: endpoint.description ? oneLine(endpoint.description) : undefined,
  };
}

function findEndpoint(node: HttpNode, name: string): HttpEndpointConfig {
  const endpoint = node.endpoints.find((item) => item.name === name);
  if (!endpoint) {
    throw new Error(`Endpoint '${name}' not found on HTTP node '${node.id}'.`);
  }
  return endpoint;
}
