// Fetches and validates a remote TB Server's JSON `~help`.
// Shared by the remote adapter and the crawler. Enforces https, optional
// allowlist, size cap, and a request timeout — this is the main SSRF surface.

import { AppEnv, HelpPayload, NodeKind, ResourceRef } from './types';
import { assertRemoteHostAllowed, materializeHeaders, requireSecureUrl } from './materialize';
import { MAX_JSON_BYTES, REMOTE_FETCH_TIMEOUT_MS, isRecord, readBoundedText, safeErrorText } from './util';

const VALID_KINDS: NodeKind[] = ['directory', 'mcp', 'http', 'remote'];

export async function fetchRemoteHelp(
  env: AppEnv,
  helpUrl: string,
  headers: Record<string, string> | undefined
): Promise<HelpPayload> {
  const url = requireSecureUrl(env, helpUrl, `Remote help URL '${helpUrl}'`);
  assertRemoteHostAllowed(env, url);

  const requestHeaders = new Headers(materializeHeaders(env, headers));
  requestHeaders.set('Accept', 'application/json');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'GET', headers: requestHeaders, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Remote help '${url}' returned ${response.status}: ${await safeErrorText(response)}`);
    }
    const body = await readBoundedText(response, MAX_JSON_BYTES);
    return parseHelpPayload(body);
  } finally {
    clearTimeout(timer);
  }
}

// Tolerantly validate an untrusted JSON help payload into our shape.
export function parseHelpPayload(body: string): HelpPayload {
  const parsed = JSON.parse(body) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('Remote help payload is not a JSON object.');
  }
  const kind = typeof parsed.kind === 'string' && (VALID_KINDS as string[]).includes(parsed.kind)
    ? (parsed.kind as NodeKind)
    : 'directory';
  return {
    htbp: 'draft',
    kind,
    title: typeof parsed.title === 'string' ? parsed.title : 'Remote TB Server',
    description: typeof parsed.description === 'string' ? parsed.description : undefined,
    cachable: parsed.cachable === true,
    resources: parseResources(parsed.resources),
    endpoint: isRecord(parsed.endpoint) ? sanitizeEndpoint(parsed.endpoint) : undefined,
  };
}

function parseResources(value: unknown): ResourceRef[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const refs: ResourceRef[] = [];
  for (const item of value) {
    if (isRecord(item) && typeof item.name === 'string' && typeof item.path === 'string') {
      refs.push({
        name: item.name,
        path: item.path,
        description: typeof item.description === 'string' ? item.description : undefined,
      });
    }
  }
  return refs;
}

function sanitizeEndpoint(value: Record<string, unknown>): HelpPayload['endpoint'] {
  const rawTools = Array.isArray(value.tools) ? value.tools : undefined;
  const tools = rawTools
    ?.filter((t): t is Record<string, unknown> => isRecord(t) && typeof t.name === 'string')
    .map((t) => ({
      name: t.name as string,
      description: typeof t.description === 'string' ? t.description : undefined,
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema,
    }));
  return {
    method: typeof value.method === 'string' ? value.method : 'POST',
    inputSchema: value.inputSchema,
    outputSchema: value.outputSchema,
    example: value.example,
    tools,
  };
}
