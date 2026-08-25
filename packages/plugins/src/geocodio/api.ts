import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  batchReverseGeocodeInput,
  geocodeBatchInput,
  singleGeocodeInput,
  singleReverseGeocodeInput,
} from './schema'
import {
  createProviderHttpClient,
  messageFrom,
  type ProviderQuery,
} from '../_runtime/providerHttp'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'geocodio'
const http = createProviderHttpClient({ baseUrl: 'https://api.geocod.io/v1.12/', service: SERVICE })
type Query = Record<string, number | string | undefined>

async function request(ctx: ProviderContext, path: string, query: Query, body?: unknown): Promise<unknown> {
  const apiKey = requireApiKey(ctx, SERVICE)
  const pairs: ProviderQuery = [
    ...Object.entries(query),
    ['api_key', apiKey],
  ]
  const { data } = await http.request({
    path,
    query: pairs,
    ...(body === undefined ? {} : { method: 'POST' as const, json: body }),
    invalidJson: 'text',
    mapError: ({ data: payload, status }) => upstreamError(
      status === 0 ? 502 : status,
      messageFrom(payload, ['error', 'message'], 'Geocodio request failed'),
    ),
    mapTransportError: ({ message }) => upstreamError(
      502,
      message === undefined ? 'Geocodio request failed' : `Geocodio request failed: ${message}`,
    ),
  })
  return data ?? null
}

export function singleGeocode(
  input: z.infer<typeof singleGeocodeInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  const hasAny = [
    input.q,
    input.street,
    input.street2,
    input.city,
    input.state,
    input.postal_code,
    input.country,
    input.county,
  ].some(value => value !== undefined && value.trim() !== '')
  if (!hasAny) throw new TBError('invalid_argument', 'q or at least one address component is required')

  return request(ctx, 'geocode', {
    q: input.q,
    street: input.street,
    street2: input.street2,
    city: input.city,
    state: input.state,
    postal_code: input.postal_code,
    country: input.country,
    county: input.county,
    fields: input.fields,
    limit: input.limit,
    format: input.format,
  })
}

export function geocodeBatch(
  input: z.infer<typeof geocodeBatchInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, 'geocode', { fields: input.fields, limit: input.limit }, input.addresses)
}

export function singleReverseGeocode(
  input: z.infer<typeof singleReverseGeocodeInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, 'reverse', {
    q: `${input.lat},${input.lng}`,
    fields: input.fields,
    limit: input.limit,
    format: input.format,
  })
}

export function batchReverseGeocode(
  input: z.infer<typeof batchReverseGeocodeInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, 'reverse', { fields: input.fields, limit: input.limit }, input.coordinates)
}
