/**
 * Geocodio 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const singleGeocodeInput = z.strictObject({
  q: z.string().min(1).describe('The full address string to geocode.').optional(),
  street: z.string().min(1).describe('The street address component.').optional(),
  street2: z.string().min(1).describe('The secondary street address component.').optional(),
  city: z.string().min(1).describe('The city name used for the lookup.').optional(),
  state: z.string().min(1).describe('The state or province code used for the lookup.').optional(),
  postal_code: z.string().min(1).describe('The postal or ZIP code used for the lookup.').optional(),
  country: z.string().min(1).describe('The country context for the lookup.').optional(),
  county: z.string().min(1).describe('The county name used for the lookup.').optional(),
  fields: z.string().min(1).describe('A comma-separated list of Geocodio data append codes.').optional(),
  limit: z.int().min(0).describe('The maximum number of results to return.').optional(),
  format: z.literal('simple').describe('Return Geocodio\'s simplified single-result response format.').optional(),
}).describe('The input payload for geocoding a single address with Geocodio.')

export const singleGeocodeOutput = z.looseObject({
  input: z.record(z.string(), z.unknown().describe('A property value in a JSON-like object.')).describe('A JSON-like object with arbitrary string keys.').optional(),
  results: z.array(z.looseObject({
    formatted_address: z.string().describe('The full formatted address.').optional(),
    location: z.looseObject({
      lat: z.number().describe('The latitude coordinate.'),
      lng: z.number().describe('The longitude coordinate.'),
    }).describe('Latitude and longitude returned by Geocodio.').optional(),
    accuracy: z.number().describe('The match accuracy score from 0.0 to 1.0.').optional(),
    accuracy_type: z.string().describe('The Geocodio accuracy type for the match.').optional(),
    source: z.string().describe('The source dataset for the match.').optional(),
    address_components: z.record(z.string(), z.unknown().describe('A property value in a JSON-like object.')).describe('A JSON-like object with arbitrary string keys.').optional(),
    address_lines: z.array(z.string().describe('One formatted address line.')).describe('Formatted address lines.').optional(),
    fields: z.record(z.string(), z.unknown().describe('A property value in a JSON-like object.')).describe('A JSON-like object with arbitrary string keys.').optional(),
  }).describe('A single Geocodio geocoding result.')).describe('The ordered geocoding match results.').optional(),
  lat: z.number().describe('The latitude returned by Geocodio simple format.').optional(),
  lng: z.number().describe('The longitude returned by Geocodio simple format.').optional(),
  address: z.string().describe('The address returned by Geocodio simple format.').optional(),
  source: z.string().describe('The source returned by Geocodio simple format.').optional(),
}).describe('The Geocodio response for a single geocode or reverse geocode request.')

export const geocodeBatchInput = z.strictObject({
  addresses: z.array(z.string().min(1).describe('One address string to geocode.')).min(1).max(10000).describe('The address strings to geocode in one batch request.'),
  fields: z.string().min(1).describe('A comma-separated list of Geocodio data append codes.').optional(),
  limit: z.int().min(0).describe('The maximum number of results per address.').optional(),
}).describe('The input payload for batch geocoding addresses with Geocodio.')

export const geocodeBatchOutput = z.strictObject({
  results: z.array(z.looseObject({
    query: z.string().describe('The original query string from the batch request.'),
    response: z.record(z.string(), z.unknown().describe('A property value in a JSON-like object.')).describe('A JSON-like object with arbitrary string keys.'),
  }).describe('One batch geocoding or reverse geocoding result.')).describe('The ordered batch response items.'),
}).describe('The Geocodio response for a batch geocoding request.')

export const singleReverseGeocodeInput = z.strictObject({
  lat: z.number().min(-90).max(90).describe('The latitude to reverse geocode.'),
  lng: z.number().min(-180).max(180).describe('The longitude to reverse geocode.'),
  fields: z.string().min(1).describe('A comma-separated list of Geocodio data append codes.').optional(),
  limit: z.int().min(0).describe('The maximum number of results to return.').optional(),
  format: z.literal('simple').describe('Return Geocodio\'s simplified single-result response format.').optional(),
}).describe('The input payload for reverse geocoding a single latitude and longitude pair.')

export const singleReverseGeocodeOutput = z.looseObject({
  input: z.record(z.string(), z.unknown().describe('A property value in a JSON-like object.')).describe('A JSON-like object with arbitrary string keys.').optional(),
  results: z.array(z.looseObject({
    formatted_address: z.string().describe('The full formatted address.').optional(),
    location: z.looseObject({
      lat: z.number().describe('The latitude coordinate.'),
      lng: z.number().describe('The longitude coordinate.'),
    }).describe('Latitude and longitude returned by Geocodio.').optional(),
    accuracy: z.number().describe('The match accuracy score from 0.0 to 1.0.').optional(),
    accuracy_type: z.string().describe('The Geocodio accuracy type for the match.').optional(),
    source: z.string().describe('The source dataset for the match.').optional(),
    address_components: z.record(z.string(), z.unknown().describe('A property value in a JSON-like object.')).describe('A JSON-like object with arbitrary string keys.').optional(),
    address_lines: z.array(z.string().describe('One formatted address line.')).describe('Formatted address lines.').optional(),
    fields: z.record(z.string(), z.unknown().describe('A property value in a JSON-like object.')).describe('A JSON-like object with arbitrary string keys.').optional(),
  }).describe('A single Geocodio geocoding result.')).describe('The ordered geocoding match results.').optional(),
  lat: z.number().describe('The latitude returned by Geocodio simple format.').optional(),
  lng: z.number().describe('The longitude returned by Geocodio simple format.').optional(),
  address: z.string().describe('The address returned by Geocodio simple format.').optional(),
  source: z.string().describe('The source returned by Geocodio simple format.').optional(),
}).describe('The Geocodio response for a single geocode or reverse geocode request.')

export const batchReverseGeocodeInput = z.strictObject({
  coordinates: z.array(z.string().min(1).describe('One `latitude,longitude` coordinate string.')).min(1).max(10000).describe('The coordinate strings to reverse geocode in one batch request.'),
  fields: z.string().min(1).describe('A comma-separated list of Geocodio data append codes.').optional(),
  limit: z.int().min(0).describe('The maximum number of results per coordinate.').optional(),
}).describe('The input payload for batch reverse geocoding coordinate pairs with Geocodio.')

export const batchReverseGeocodeOutput = z.strictObject({
  results: z.array(z.looseObject({
    query: z.string().describe('The original query string from the batch request.'),
    response: z.record(z.string(), z.unknown().describe('A property value in a JSON-like object.')).describe('A JSON-like object with arbitrary string keys.'),
  }).describe('One batch geocoding or reverse geocoding result.')).describe('The ordered batch response items.'),
}).describe('The Geocodio response for a batch geocoding request.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const geocodioActions = {
  single_geocode: {
    description: 'Geocode a single address and return the official Geocodio response payload.',
    effect: 'write',
    inputSchema: singleGeocodeInput,
    outputSchema: z.toJSONSchema(singleGeocodeOutput, { io: 'output', unrepresentable: 'any' }),
  },
  geocode_batch: {
    description: 'Geocode multiple addresses in one batch request and return Geocodio batch results.',
    effect: 'write',
    inputSchema: geocodeBatchInput,
    outputSchema: z.toJSONSchema(geocodeBatchOutput, { io: 'output', unrepresentable: 'any' }),
  },
  single_reverse_geocode: {
    description: 'Reverse geocode a single latitude and longitude pair and return the official Geocodio response payload.',
    effect: 'write',
    inputSchema: singleReverseGeocodeInput,
    outputSchema: z.toJSONSchema(singleReverseGeocodeOutput, { io: 'output', unrepresentable: 'any' }),
  },
  batch_reverse_geocode: {
    description: 'Reverse geocode multiple coordinate pairs in one batch request and return Geocodio batch results.',
    effect: 'write',
    inputSchema: batchReverseGeocodeInput,
    outputSchema: z.toJSONSchema(batchReverseGeocodeOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
