// Runtime-added MCP servers, persisted in the TENANTS KV namespace under the
// `dynamic-server:` prefix. These augment the read-only env MCP_SERVERS_JSON for
// the legacy /api/servers + /mcp/* surface only (they do NOT enter the /htbp
// tree or tenant isolation, which have their own configured roots).

import { AppEnv } from './types';

const PREFIX = 'dynamic-server:';

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
  const out: DynamicServer[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.TENANTS.list({ prefix: PREFIX, cursor });
    for (const key of page.keys) {
      const raw = await env.TENANTS.get(key.name);
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

export async function putDynamicServer(env: AppEnv, server: DynamicServer): Promise<void> {
  if (!env.TENANTS) {
    throw new Error('Dynamic servers require the TENANTS KV binding.');
  }
  await env.TENANTS.put(`${PREFIX}${server.id}`, JSON.stringify(server));
}

export async function deleteDynamicServer(env: AppEnv, id: string): Promise<void> {
  if (!env.TENANTS) {
    throw new Error('Dynamic servers require the TENANTS KV binding.');
  }
  await env.TENANTS.delete(`${PREFIX}${id}`);
}
