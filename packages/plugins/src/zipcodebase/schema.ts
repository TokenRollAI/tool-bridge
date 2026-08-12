/**
 * Zipcodebase 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getStatusInput = z.strictObject({}).describe('The input payload for checking Zipcodebase account status.')

export const getStatusOutput = z.looseObject({
  requests_remaining: z.int().describe('The number of remaining requests reported by Zipcodebase.').optional(),
}).describe('The status payload returned by Zipcodebase.')

export const searchPostalCodesInput = z.strictObject({
  codes: z.array(z.string().min(1).describe('A postal code to include in the request.')).min(1).describe('The postal codes to query.'),
  country: z.string().min(2).max(2).describe('Optional ISO 3166-1 alpha-2 country code used to narrow the request.').optional(),
}).describe('The input payload for looking up postal code location information.')

export const searchPostalCodesOutput = z.looseObject({
  results: z.record(z.string(), z.looseObject({
    code: z.string().describe('The postal code.').optional(),
    city: z.string().describe('The city name associated with the postal code.').nullable().optional(),
    state: z.string().describe('The state or region associated with the postal code.').nullable().optional(),
    country: z.string().describe('The country code associated with the postal code.').optional(),
    latitude: z.number().describe('The latitude coordinate.').optional(),
    longitude: z.number().describe('The longitude coordinate.').optional(),
  }).describe('A postal code record returned by Zipcodebase.')).describe('Postal code records keyed by submitted code.').optional(),
}).describe('The postal code search payload returned by Zipcodebase.')

export const calculateDistanceInput = z.strictObject({
  code: z.string().min(1).describe('The postal code to query.'),
  compare: z.array(z.string().min(1).describe('A postal code to include in the request.')).min(1).describe('The postal codes to query.'),
  country: z.string().min(2).max(2).describe('The ISO 3166-1 alpha-2 country code, such as us or nl.'),
  unit: z.enum(['km', 'mile']).describe('Optional distance unit returned by Zipcodebase.').optional(),
}).describe('The input payload for calculating postal code distances.')

export const calculateDistanceOutput = z.looseObject({
  results: z.array(z.looseObject({
    code: z.string().describe('The compared postal code.').optional(),
    distance: z.number().describe('The distance from the origin postal code.').optional(),
  }).describe('A distance result returned by Zipcodebase.')).describe('The distance results returned by Zipcodebase.').optional(),
}).describe('The distance payload returned by Zipcodebase.')

export const listPostalCodesWithinRadiusInput = z.strictObject({
  code: z.string().min(1).describe('The postal code to query.'),
  radius: z.number().gt(0).describe('The positive distance or radius value.'),
  country: z.string().min(2).max(2).describe('The ISO 3166-1 alpha-2 country code, such as us or nl.'),
  unit: z.enum(['km', 'mile']).describe('Optional distance unit returned by Zipcodebase.').optional(),
}).describe('The input payload for finding postal codes within a radius.')

export const listPostalCodesWithinRadiusOutput = z.looseObject({
  results: z.array(z.looseObject({
    code: z.string().describe('The postal code.').optional(),
    city: z.string().describe('The city name associated with the postal code.').nullable().optional(),
    state: z.string().describe('The state or region associated with the postal code.').nullable().optional(),
    country: z.string().describe('The country code associated with the postal code.').optional(),
    latitude: z.number().describe('The latitude coordinate.').optional(),
    longitude: z.number().describe('The longitude coordinate.').optional(),
  }).describe('A postal code record returned by Zipcodebase.')).describe('The postal codes found within the requested radius.').optional(),
}).describe('The radius search payload returned by Zipcodebase.')

export const matchPostalCodesByDistanceInput = z.strictObject({
  codes: z.array(z.string().min(1).describe('A postal code to include in the request.')).min(1).describe('The postal codes to query.'),
  distance: z.number().gt(0).describe('The positive distance or radius value.'),
  country: z.string().min(2).max(2).describe('The ISO 3166-1 alpha-2 country code, such as us or nl.'),
  unit: z.enum(['km', 'mile']).describe('Optional distance unit returned by Zipcodebase.').optional(),
}).describe('The input payload for matching postal codes by distance.')

export const matchPostalCodesByDistanceOutput = z.looseObject({
  results: z.array(z.looseObject({}).describe('A postal code match result.')).describe('The postal code pairs within the requested distance.').optional(),
}).describe('The postal code match payload returned by Zipcodebase.')

export const listPostalCodesByCityInput = z.strictObject({
  city: z.string().min(1).describe('The city name to search for.'),
  country: z.string().min(2).max(2).describe('The ISO 3166-1 alpha-2 country code, such as us or nl.'),
  state_name: z.string().min(1).describe('The state or province name to search for.').optional(),
}).describe('The input payload for listing postal codes by city.')

export const listPostalCodesByCityOutput = z.looseObject({
  results: z.array(z.looseObject({
    code: z.string().describe('The postal code.').optional(),
    city: z.string().describe('The city name associated with the postal code.').nullable().optional(),
    state: z.string().describe('The state or region associated with the postal code.').nullable().optional(),
    country: z.string().describe('The country code associated with the postal code.').optional(),
    latitude: z.number().describe('The latitude coordinate.').optional(),
    longitude: z.number().describe('The longitude coordinate.').optional(),
  }).describe('A postal code record returned by Zipcodebase.')).describe('The postal codes returned for the city.').optional(),
}).describe('The city lookup payload returned by Zipcodebase.')

export const listPostalCodesByStateInput = z.strictObject({
  state_name: z.string().min(1).describe('The state or province name to search for.').optional(),
  country: z.string().min(2).max(2).describe('The ISO 3166-1 alpha-2 country code, such as us or nl.').optional(),
}).describe('The input payload for listing postal codes by state.')

export const listPostalCodesByStateOutput = z.looseObject({
  results: z.array(z.looseObject({
    code: z.string().describe('The postal code.').optional(),
    city: z.string().describe('The city name associated with the postal code.').nullable().optional(),
    state: z.string().describe('The state or region associated with the postal code.').nullable().optional(),
    country: z.string().describe('The country code associated with the postal code.').optional(),
    latitude: z.number().describe('The latitude coordinate.').optional(),
    longitude: z.number().describe('The longitude coordinate.').optional(),
  }).describe('A postal code record returned by Zipcodebase.')).describe('The postal codes returned for the state.').optional(),
}).describe('The state lookup payload returned by Zipcodebase.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const zipcodebaseActions = {
  get_status: {
    description: 'Return Zipcodebase account status and remaining request credits.',
    effect: 'read',
    inputSchema: getStatusInput,
    outputSchema: z.toJSONSchema(getStatusOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_postal_codes: {
    description: 'Look up location information for one or more postal codes.',
    effect: 'read',
    inputSchema: searchPostalCodesInput,
    outputSchema: z.toJSONSchema(searchPostalCodesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  calculate_distance: {
    description: 'Calculate distance from one postal code to one or more comparison postal codes.',
    effect: 'write',
    inputSchema: calculateDistanceInput,
    outputSchema: z.toJSONSchema(calculateDistanceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_postal_codes_within_radius: {
    description: 'List postal codes located within a radius of a postal code.',
    effect: 'read',
    inputSchema: listPostalCodesWithinRadiusInput,
    outputSchema: z.toJSONSchema(listPostalCodesWithinRadiusOutput, { io: 'output', unrepresentable: 'any' }),
  },
  match_postal_codes_by_distance: {
    description: 'Find submitted postal code pairs that are within a given distance.',
    effect: 'write',
    inputSchema: matchPostalCodesByDistanceInput,
    outputSchema: z.toJSONSchema(matchPostalCodesByDistanceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_postal_codes_by_city: {
    description: 'List postal codes associated with a city and optional state or province.',
    effect: 'read',
    inputSchema: listPostalCodesByCityInput,
    outputSchema: z.toJSONSchema(listPostalCodesByCityOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_postal_codes_by_state: {
    description: 'List postal codes associated with a state or province.',
    effect: 'read',
    inputSchema: listPostalCodesByStateInput,
    outputSchema: z.toJSONSchema(listPostalCodesByStateOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
