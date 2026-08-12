/**
 * Geokeo 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const geocodeForwardInput = z.strictObject({
  q: z.string().min(1).describe('Address or place query string to geocode.'),
  country: z.string().min(2).max(2).describe('Optional ISO 3166-1 alpha-2 country code used to narrow the search.').optional(),
}).describe('Input parameters for forward geocoding an address or place with Geokeo.')

export const geocodeForwardOutput = z.strictObject({
  results: z.array(z.looseObject({
    class: z.string().min(1).describe('The OpenStreetMap class of the matched place.').optional(),
    type: z.string().min(1).describe('The OpenStreetMap type of the matched place.').optional(),
    address_components: z.record(z.string(), z.unknown().describe('One upstream address component value.')).describe('Structured address components keyed by upstream field name.').optional(),
    formatted_address: z.string().min(1).describe('The formatted postal-style address returned by Geokeo.').optional(),
    geometry: z.looseObject({
      location: z.looseObject({
        lat: z.string().min(1).describe('Latitude in WGS 84 format returned by Geokeo.'),
        lng: z.string().min(1).describe('Longitude in WGS 84 format returned by Geokeo.'),
      }).describe('The centroid coordinates of the matched place.'),
      viewport: z.looseObject({
        northeast: z.looseObject({
          lat: z.string().min(1).describe('Latitude in WGS 84 format returned by Geokeo.'),
          lng: z.string().min(1).describe('Longitude in WGS 84 format returned by Geokeo.'),
        }).describe('The northeast corner of the bounding box.'),
        southwest: z.looseObject({
          lat: z.string().min(1).describe('Latitude in WGS 84 format returned by Geokeo.'),
          lng: z.string().min(1).describe('Longitude in WGS 84 format returned by Geokeo.'),
        }).describe('The southwest corner of the bounding box.'),
      }).describe('The bounding box of the matched place.'),
    }).describe('Geometry details for the matched place.').optional(),
    osmurl: z.string().min(1).describe('OpenStreetMap URL for the matched coordinates.').optional(),
    distance: z.string().min(1).describe('Distance from the reverse query coordinates in kilometers.').optional(),
  }).describe('One Geokeo result item.')).describe('The ordered geocoding results returned by Geokeo.').optional(),
  credits: z.string().min(1).describe('Credits URL returned by Geokeo.').optional(),
  status: z.string().min(1).describe('Geokeo status string such as ok or ZERO_RESULTS.'),
}).describe('The JSON response payload returned by Geokeo geocoding endpoints.')

export const geocodeReverseInput = z.strictObject({
  lat: z.number().min(-90).max(90).describe('Latitude to reverse geocode.'),
  lng: z.number().min(-180).max(180).describe('Longitude to reverse geocode.'),
}).describe('Input parameters for reverse geocoding coordinates with Geokeo.')

export const geocodeReverseOutput = z.strictObject({
  results: z.array(z.looseObject({
    class: z.string().min(1).describe('The OpenStreetMap class of the matched place.').optional(),
    type: z.string().min(1).describe('The OpenStreetMap type of the matched place.').optional(),
    address_components: z.record(z.string(), z.unknown().describe('One upstream address component value.')).describe('Structured address components keyed by upstream field name.').optional(),
    formatted_address: z.string().min(1).describe('The formatted postal-style address returned by Geokeo.').optional(),
    geometry: z.looseObject({
      location: z.looseObject({
        lat: z.string().min(1).describe('Latitude in WGS 84 format returned by Geokeo.'),
        lng: z.string().min(1).describe('Longitude in WGS 84 format returned by Geokeo.'),
      }).describe('The centroid coordinates of the matched place.'),
      viewport: z.looseObject({
        northeast: z.looseObject({
          lat: z.string().min(1).describe('Latitude in WGS 84 format returned by Geokeo.'),
          lng: z.string().min(1).describe('Longitude in WGS 84 format returned by Geokeo.'),
        }).describe('The northeast corner of the bounding box.'),
        southwest: z.looseObject({
          lat: z.string().min(1).describe('Latitude in WGS 84 format returned by Geokeo.'),
          lng: z.string().min(1).describe('Longitude in WGS 84 format returned by Geokeo.'),
        }).describe('The southwest corner of the bounding box.'),
      }).describe('The bounding box of the matched place.'),
    }).describe('Geometry details for the matched place.').optional(),
    osmurl: z.string().min(1).describe('OpenStreetMap URL for the matched coordinates.').optional(),
    distance: z.string().min(1).describe('Distance from the reverse query coordinates in kilometers.').optional(),
  }).describe('One Geokeo result item.')).describe('The ordered geocoding results returned by Geokeo.').optional(),
  credits: z.string().min(1).describe('Credits URL returned by Geokeo.').optional(),
  status: z.string().min(1).describe('Geokeo status string such as ok or ZERO_RESULTS.'),
}).describe('The JSON response payload returned by Geokeo geocoding endpoints.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const geokeoActions = {
  geocode_forward: {
    description: 'Convert an address or place query into Geokeo geocoding results.',
    effect: 'write',
    inputSchema: geocodeForwardInput,
    outputSchema: z.toJSONSchema(geocodeForwardOutput, { io: 'output', unrepresentable: 'any' }),
  },
  geocode_reverse: {
    description: 'Convert coordinates into Geokeo reverse geocoding results.',
    effect: 'write',
    inputSchema: geocodeReverseInput,
    outputSchema: z.toJSONSchema(geocodeReverseOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
