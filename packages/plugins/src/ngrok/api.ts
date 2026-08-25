import type { z } from 'zod/v4'
import type {
  getEndpointInput,
  getReservedDomainInput,
  listEndpointsInput,
  listReservedDomainsInput,
  listTunnelSessionsInput,
  listTunnelsInput,
} from './schema'
import {
  asJsonObject,
  createProviderHttpClient,
  type JsonObject,
  messageFrom,
  nonEmptyText,
  type ProviderQuery,
} from '../_runtime/providerHttp'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'ngrok'
const http = createProviderHttpClient({ baseUrl: 'https://api.ngrok.com/', service: SERVICE })

interface ListQuery {
  before_id?: string
  filter?: string
  limit?: number
}

async function request(
  ctx: ProviderContext,
  path: string,
  query?: ProviderQuery,
): Promise<JsonObject> {
  const { data } = await http.request({
    path,
    query,
    headers: {
      'accept': 'application/json',
      'authorization': `Bearer ${requireApiKey(ctx, SERVICE)}`,
      'ngrok-version': '2',
    },
    invalidJson: 'text',
    mapError: ({ data: payload, status }) => upstreamError(
      status,
      messageFrom(payload, ['msg', 'message', 'error'], `ngrok request failed with ${status}`),
    ),
  })
  const result = asJsonObject(data)
  if (result === undefined) throw upstreamError(502, 'ngrok response was not a JSON object')
  return result
}

function listQuery(input: ListQuery): ProviderQuery {
  return [
    ['limit', input.limit],
    ['before_id', nonEmptyText(input.before_id)],
    ['filter', nonEmptyText(input.filter)],
  ]
}

export function listEndpoints(
  input: z.infer<typeof listEndpointsInput>,
  ctx: ProviderContext,
): Promise<JsonObject> {
  return request(ctx, 'endpoints', listQuery(input))
}

export function getEndpoint(
  input: z.infer<typeof getEndpointInput>,
  ctx: ProviderContext,
): Promise<JsonObject> {
  return request(ctx, `endpoints/${encodeURIComponent(input.endpoint_id)}`)
}

export function listTunnels(
  input: z.infer<typeof listTunnelsInput>,
  ctx: ProviderContext,
): Promise<JsonObject> {
  return request(ctx, 'tunnels', listQuery(input))
}

export function listTunnelSessions(
  input: z.infer<typeof listTunnelSessionsInput>,
  ctx: ProviderContext,
): Promise<JsonObject> {
  return request(ctx, 'tunnel_sessions', listQuery(input))
}

export function listReservedDomains(
  input: z.infer<typeof listReservedDomainsInput>,
  ctx: ProviderContext,
): Promise<JsonObject> {
  return request(ctx, 'reserved_domains', listQuery(input))
}

export function getReservedDomain(
  input: z.infer<typeof getReservedDomainInput>,
  ctx: ProviderContext,
): Promise<JsonObject> {
  return request(ctx, `reserved_domains/${encodeURIComponent(input.reserved_domain_id)}`)
}
