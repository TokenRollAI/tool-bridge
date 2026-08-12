/**
 * GraphHopper 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const calculateRouteInput = z.strictObject({
  point: z.array(z.string().min(3).describe('A coordinate string in `latitude,longitude` format.')).min(2).describe('Route waypoints in `latitude,longitude` format.'),
  profile: z.string().min(1).describe('The GraphHopper routing profile, such as `car`, `bike`, `foot`, or a custom profile id.').optional(),
  locale: z.string().min(1).describe('The locale for turn instructions, such as `en`, `de`, or `fr`.').optional(),
  pointHint: z.array(z.string().min(1).describe('One road name hint.')).min(1).describe('Optional road name hints for snapping each route waypoint.').optional(),
  snapPrevention: z.array(z.string().min(1).describe('One snap prevention value such as `motorway`, `trunk`, `ferry`, `tunnel`, `bridge`, or `ford`.')).min(1).describe('Road types that should be avoided while snapping input points.').optional(),
  curbside: z.array(z.enum(['any', 'right', 'left']).describe('One curbside preference.')).describe('Curbside preferences for each route waypoint.').optional(),
  details: z.array(z.string().min(1).describe('One GraphHopper path detail type.')).min(1).describe('Path detail types to include in the route response.').optional(),
  optimize: z.boolean().describe('Whether GraphHopper should reorder more than two points to reduce travel time.').optional(),
  instructions: z.boolean().describe('Whether GraphHopper should return turn-by-turn instructions.').optional(),
  calcPoints: z.boolean().describe('Whether GraphHopper should calculate route geometry points.').optional(),
  pointsEncoded: z.boolean().describe('Whether GraphHopper should return encoded polyline geometry.').optional(),
  elevation: z.boolean().describe('Whether GraphHopper should include altitude as a third coordinate.').optional(),
  debug: z.boolean().describe('Whether GraphHopper should format debug output.').optional(),
  chDisable: z.boolean().describe('Whether to enable flexible mode for advanced routing options.').optional(),
  heading: z.array(z.int().min(0).max(360).describe('One heading direction in degrees.')).describe('Preferred heading directions in degrees, north-based clockwise.').optional(),
  headingPenalty: z.int().min(0).describe('The time penalty in seconds for not obeying heading.').optional(),
  passThrough: z.boolean().describe('Whether GraphHopper should avoid u-turns at via-points.').optional(),
  algorithm: z.enum(['round_trip', 'alternative_route']).describe('The special route algorithm to use.').optional(),
  roundTripDistance: z.int().min(0).describe('The approximate round-trip length in meters.').optional(),
  roundTripSeed: z.int().describe('The random seed used for deterministic round-trip results.').optional(),
  alternativeRouteMaxPaths: z.int().min(1).describe('The maximum number of alternative routes.').optional(),
  alternativeRouteMaxWeightFactor: z.number().min(0).describe('The maximum factor by which alternative routes may be longer than the optimal route.').optional(),
  alternativeRouteMaxShareFactor: z.number().min(0).max(1).describe('The maximum similarity factor between an alternative route and the optimal route.').optional(),
}).describe('Input parameters for calculating a GraphHopper route.')

export const calculateRouteOutput = z.looseObject({
  paths: z.array(z.looseObject({
    distance: z.number().describe('The total route distance in meters.').optional(),
    time: z.int().describe('The total route travel time in milliseconds.').optional(),
    ascend: z.number().describe('The total ascent in meters.').optional(),
    descend: z.number().describe('The total descent in meters.').optional(),
    points: z.unknown().describe('The route geometry, either encoded or a coordinate object.').optional(),
    snapped_waypoints: z.unknown().describe('The snapped input waypoints, either encoded or a coordinate object.').optional(),
    points_encoded: z.boolean().describe('Whether route geometry fields use encoded polyline strings.').optional(),
    bbox: z.array(z.number().describe('One bounding box coordinate.')).describe('The route bounding box as `[minLon, minLat, maxLon, maxLat]`.').optional(),
    instructions: z.array(z.looseObject({}).describe('An upstream GraphHopper object returned as-is.')).describe('The turn-by-turn route instructions returned by GraphHopper.').optional(),
    details: z.looseObject({}).describe('Path details keyed by requested detail type.').optional(),
    points_order: z.array(z.int().describe('One zero-based input point index.')).describe('The optimized visit order when route optimization was requested.').optional(),
  }).describe('One route path returned by GraphHopper.')).describe('The calculated route paths.').optional(),
  info: z.looseObject({
    copyrights: z.array(z.string().describe('One notice.')).describe('The copyright notices returned by GraphHopper.').optional(),
    took: z.number().describe('The time GraphHopper spent processing the request.').optional(),
  }).describe('Additional GraphHopper response metadata.').optional(),
}).describe('The route response returned by GraphHopper.')

export const geocodeInput = z.strictObject({
  q: z.string().min(1).describe('The textual address or place query for forward geocoding.').optional(),
  point: z.string().min(1).describe('The `latitude,longitude` location bias for forward geocoding or target coordinate for reverse geocoding.').optional(),
  reverse: z.boolean().describe('Whether to perform reverse geocoding. When true, point is required and q must be omitted.').optional(),
  locale: z.string().min(1).describe('The locale used for localized geocoding results.').optional(),
  limit: z.int().min(1).describe('The maximum number of geocoding results to return.').optional(),
  provider: z.string().min(1).describe('The GraphHopper geocoding provider, such as `default`, `nominatim`, `gisgraphy`, or `opencagedata`.').optional(),
  debug: z.boolean().describe('Whether GraphHopper should format debug output.').optional(),
}).describe('Input parameters for forward or reverse geocoding with GraphHopper.')

export const geocodeOutput = z.looseObject({
  hits: z.array(z.looseObject({
    point: z.strictObject({
      lat: z.number().describe('The latitude coordinate.').optional(),
      lng: z.number().describe('The longitude coordinate.').optional(),
    }).describe('A latitude and longitude point returned by GraphHopper.').optional(),
    osm_id: z.int().describe('The OpenStreetMap entity id.').optional(),
    osm_type: z.string().describe('The OpenStreetMap entity type.').optional(),
    osm_key: z.string().describe('The OpenStreetMap key.').optional(),
    osm_value: z.string().describe('The OpenStreetMap value.').optional(),
    name: z.string().describe('The matched place, address, or entity name.').optional(),
    country: z.string().describe('The country of the result.').optional(),
    city: z.string().describe('The city of the result.').optional(),
    state: z.string().describe('The state or region of the result.').optional(),
    street: z.string().describe('The street of the result.').optional(),
    housenumber: z.string().describe('The house number of the result.').optional(),
    postcode: z.string().describe('The postal code of the result.').optional(),
  }).describe('One geocoding hit returned by GraphHopper.')).describe('The geocoding candidates returned by GraphHopper.').optional(),
  took: z.number().describe('The time GraphHopper spent processing the geocoding request in milliseconds.').optional(),
}).describe('The geocoding response returned by GraphHopper.')

export const computeMatrixInput = z.strictObject({
  point: z.array(z.string().min(3).describe('A coordinate string in `latitude,longitude` format.')).min(3).describe('Points in `latitude,longitude` format used as both origins and destinations.').optional(),
  fromPoint: z.array(z.string().min(3).describe('A coordinate string in `latitude,longitude` format.')).min(1).describe('Origin points in `latitude,longitude` format.').optional(),
  toPoint: z.array(z.string().min(3).describe('A coordinate string in `latitude,longitude` format.')).min(1).describe('Destination points in `latitude,longitude` format.').optional(),
  profile: z.string().min(1).describe('The GraphHopper routing profile, such as `car`, `bike`, `foot`, or a custom profile id.').optional(),
  pointHint: z.array(z.string().min(1).describe('One point hint.')).min(1).describe('Hints for point entries.').optional(),
  fromPointHint: z.array(z.string().min(1).describe('One origin point hint.')).min(1).describe('Hints for origin points.').optional(),
  toPointHint: z.array(z.string().min(1).describe('One destination point hint.')).min(1).describe('Hints for destination points.').optional(),
  snapPrevention: z.array(z.string().min(1).describe('One snap prevention value.')).min(1).describe('Road types that should be avoided while snapping matrix points.').optional(),
  curbside: z.array(z.enum(['any', 'right', 'left']).describe('One curbside preference.')).describe('Curbside preferences for point entries.').optional(),
  fromCurbside: z.array(z.enum(['any', 'right', 'left']).describe('One curbside preference.')).describe('Curbside preferences for origin points.').optional(),
  toCurbside: z.array(z.enum(['any', 'right', 'left']).describe('One curbside preference.')).describe('Curbside preferences for destination points.').optional(),
  outArray: z.array(z.enum(['weights', 'times', 'distances']).describe('One matrix output array name.')).min(1).describe('Matrix arrays to include in the response.').optional(),
  failFast: z.boolean().describe('Whether GraphHopper should fail immediately when points cannot be resolved.').optional(),
}).describe('Input parameters for computing a synchronous GraphHopper matrix.')

export const computeMatrixOutput = z.looseObject({
  distances: z.array(z.array(z.number().describe('One matrix value, or null when the route could not be calculated.').nullable()).describe('One matrix row.')).describe('A GraphHopper matrix of numeric values or null entries.').optional(),
  times: z.array(z.array(z.number().describe('One matrix value, or null when the route could not be calculated.').nullable()).describe('One matrix row.')).describe('A GraphHopper matrix of numeric values or null entries.').optional(),
  weights: z.array(z.array(z.number().describe('One matrix value, or null when the route could not be calculated.').nullable()).describe('One matrix row.')).describe('A GraphHopper matrix of numeric values or null entries.').optional(),
  info: z.looseObject({
    copyrights: z.array(z.string().describe('One notice.')).describe('The copyright notices returned by GraphHopper.').optional(),
    took: z.number().describe('The time GraphHopper spent processing the request.').optional(),
  }).describe('Additional GraphHopper response metadata.').optional(),
  hints: z.array(z.looseObject({}).describe('An upstream GraphHopper object returned as-is.')).describe('Additional GraphHopper matrix hints.').optional(),
}).describe('The matrix response returned by GraphHopper.')

export const computeIsochroneInput = z.strictObject({
  point: z.string().min(3).describe('A coordinate string in `latitude,longitude` format.'),
  profile: z.string().min(1).describe('The GraphHopper routing profile, such as `car`, `bike`, `foot`, or a custom profile id.').optional(),
  timeLimit: z.int().min(1).describe('The travel time limit in seconds.').optional(),
  distanceLimit: z.int().min(1).describe('The travel distance limit in meters.').optional(),
  buckets: z.int().min(1).describe('The number of nested isochrone buckets to return.').optional(),
  reverseFlow: z.boolean().describe('Whether the flow should go from polygons toward the point.').optional(),
}).describe('Input parameters for computing GraphHopper isochrone polygons.')

export const computeIsochroneOutput = z.looseObject({
  polygons: z.array(z.looseObject({}).describe('An upstream GraphHopper object returned as-is.')).describe('The GeoJSON isochrone polygons returned by GraphHopper.').optional(),
}).describe('The isochrone response returned by GraphHopper.')

export const listProfilesInput = z.strictObject({}).describe('Input parameters for listing GraphHopper custom profiles.')

export const listProfilesOutput = z.strictObject({
  profiles: z.array(z.looseObject({
    id: z.string().describe('The custom profile id.').optional(),
    profile: z.string().describe('The built-in routing profile this custom profile is based on.').optional(),
    bounds: z.looseObject({}).describe('The geographic bounds where this custom profile can be used.').optional(),
    custom_model: z.looseObject({}).describe('The custom model definition for this profile.').optional(),
  }).describe('One custom GraphHopper routing profile.')).describe('The available custom routing profiles.').optional(),
}).describe('The custom routing profiles returned by GraphHopper.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const graphhopperActions = {
  calculate_route: {
    description: 'Calculate the best route connecting two or more coordinates with the GraphHopper Routing API.',
    effect: 'write',
    inputSchema: calculateRouteInput,
    outputSchema: z.toJSONSchema(calculateRouteOutput, { io: 'output', unrepresentable: 'any' }),
  },
  geocode: {
    description: 'Convert text to coordinates or coordinates to place candidates with the GraphHopper Geocoding API.',
    effect: 'write',
    inputSchema: geocodeInput,
    outputSchema: z.toJSONSchema(geocodeOutput, { io: 'output', unrepresentable: 'any' }),
  },
  compute_matrix: {
    description: 'Compute a synchronous travel time, distance, or weight matrix with the GraphHopper Matrix API.',
    effect: 'write',
    inputSchema: computeMatrixInput,
    outputSchema: z.toJSONSchema(computeMatrixOutput, { io: 'output', unrepresentable: 'any' }),
  },
  compute_isochrone: {
    description: 'Compute GeoJSON isochrone polygons around a coordinate with the GraphHopper Isochrone API.',
    effect: 'write',
    inputSchema: computeIsochroneInput,
    outputSchema: z.toJSONSchema(computeIsochroneOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_profiles: {
    description: 'List custom routing profiles available to the GraphHopper API key.',
    effect: 'read',
    inputSchema: listProfilesInput,
    outputSchema: z.toJSONSchema(listProfilesOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
