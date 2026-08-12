/**
 * AMap 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const geocodeInput = z.strictObject({
  address: z.string().describe('The address to geocode.'),
  city: z.string().describe('The city used to narrow the geocode lookup.').optional(),
}).describe('The input parameters for geocoding an address.')

export const geocodeOutput = z.strictObject({
  geocodes: z.array(z.strictObject({
    formattedAddress: z.string().describe('The formatted address.').optional(),
    country: z.string().describe('The country name.').optional(),
    province: z.string().describe('The province or state name.').optional(),
    city: z.union([z.string().describe('A single string value.'), z.array(z.string().describe('A string value in the list.')).describe('A list of string values.')]).describe('A string or an array of strings.').optional(),
    district: z.string().describe('The district or county name.').optional(),
    adcode: z.string().describe('The administrative code.').optional(),
    location: z.string().describe('The coordinate string.').optional(),
  }).describe('A geocoding result entry.')).describe('The list of geocoding results.').optional(),
}).describe('The response payload returned by the geocode action.')

export const reverseGeocodeInput = z.strictObject({
  location: z.string().describe('The coordinates to reverse geocode.'),
  radius: z.int().describe('The search radius in meters.').optional(),
  extensions: z.enum(['base', 'all']).describe('The requested response detail level.').optional(),
  roadLevel: z.int().describe('The road level filter.').optional(),
}).describe('The input parameters for reverse geocoding coordinates.')

export const reverseGeocodeOutput = z.strictObject({
  formattedAddress: z.string().describe('The formatted address.').optional(),
  addressComponent: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
  pois: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('The nearby points of interest.'),
  roads: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('The nearby roads.'),
  roadinters: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('The nearby road intersections.'),
  aois: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('The nearby areas of interest.'),
}).describe('The response payload returned by the reverse geocode action.')

export const searchPlacesInput = z.strictObject({
  keywords: z.string().describe('The keywords used to search places.'),
  region: z.string().describe('The optional region filter.').optional(),
  cityLimit: z.boolean().describe('Whether to limit results to the region.').optional(),
  types: z.string().describe('The optional place type filter.').optional(),
  pageNum: z.int().describe('The page number to fetch.').optional(),
  pageSize: z.int().describe('The page size to fetch.').optional(),
  showFields: z.string().describe('The requested output fields.').optional(),
}).describe('The input parameters for searching places by keyword.')

export const searchPlacesOutput = z.strictObject({
  count: z.string().describe('The total number of matching points of interest.').optional(),
  pois: z.array(z.strictObject({
    id: z.string().describe('The point of interest identifier.').optional(),
    name: z.string().describe('The point of interest name.').optional(),
    type: z.string().describe('The point of interest type.').optional(),
    typecode: z.string().describe('The type code.').optional(),
    address: z.string().describe('The formatted address.').optional(),
    location: z.string().describe('The coordinate string.').optional(),
    pname: z.string().describe('The province name.').optional(),
    cityname: z.string().describe('The city name.').optional(),
    adname: z.string().describe('The district or area name.').optional(),
  }).describe('A point of interest record.')).describe('The matching points of interest.'),
}).describe('The response payload returned by the place search actions.')

export const searchPlacesAroundInput = z.strictObject({
  location: z.string().describe('The center coordinate for the search.'),
  radius: z.int().describe('The search radius in meters.').optional(),
  keywords: z.string().describe('The optional keyword filter.').optional(),
  types: z.string().describe('The optional place type filter.').optional(),
  sortRule: z.string().describe('The optional sort rule.').optional(),
  pageNum: z.int().describe('The page number to fetch.').optional(),
  pageSize: z.int().describe('The page size to fetch.').optional(),
  showFields: z.string().describe('The requested output fields.').optional(),
}).describe('The input parameters for searching places around a location.')

export const searchPlacesAroundOutput = z.strictObject({
  count: z.string().describe('The total number of matching points of interest.').optional(),
  pois: z.array(z.strictObject({
    id: z.string().describe('The point of interest identifier.').optional(),
    name: z.string().describe('The point of interest name.').optional(),
    type: z.string().describe('The point of interest type.').optional(),
    typecode: z.string().describe('The type code.').optional(),
    address: z.string().describe('The formatted address.').optional(),
    location: z.string().describe('The coordinate string.').optional(),
    pname: z.string().describe('The province name.').optional(),
    cityname: z.string().describe('The city name.').optional(),
    adname: z.string().describe('The district or area name.').optional(),
  }).describe('A point of interest record.')).describe('The matching points of interest.'),
}).describe('The response payload returned by the place search actions.')

export const searchPlacesPolygonInput = z.strictObject({
  polygon: z.string().describe('The polygon used to bound the search.'),
  keywords: z.string().describe('The optional keyword filter.').optional(),
  types: z.string().describe('The optional place type filter.').optional(),
  pageNum: z.int().describe('The page number to fetch.').optional(),
  pageSize: z.int().describe('The page size to fetch.').optional(),
  showFields: z.string().describe('The requested output fields.').optional(),
}).describe('The input parameters for searching places inside a polygon.')

export const searchPlacesPolygonOutput = z.strictObject({
  count: z.string().describe('The total number of matching points of interest.').optional(),
  pois: z.array(z.strictObject({
    id: z.string().describe('The point of interest identifier.').optional(),
    name: z.string().describe('The point of interest name.').optional(),
    type: z.string().describe('The point of interest type.').optional(),
    typecode: z.string().describe('The type code.').optional(),
    address: z.string().describe('The formatted address.').optional(),
    location: z.string().describe('The coordinate string.').optional(),
    pname: z.string().describe('The province name.').optional(),
    cityname: z.string().describe('The city name.').optional(),
    adname: z.string().describe('The district or area name.').optional(),
  }).describe('A point of interest record.')).describe('The matching points of interest.'),
}).describe('The response payload returned by the place search actions.')

export const getPlaceDetailInput = z.strictObject({
  id: z.string().describe('The place identifier.'),
  showFields: z.string().describe('The requested output fields.').optional(),
}).describe('The input parameters for fetching place details.')

export const getPlaceDetailOutput = z.strictObject({
  pois: z.array(z.strictObject({
    id: z.string().describe('The point of interest identifier.').optional(),
    name: z.string().describe('The point of interest name.').optional(),
    type: z.string().describe('The point of interest type.').optional(),
    typecode: z.string().describe('The type code.').optional(),
    address: z.string().describe('The formatted address.').optional(),
    location: z.string().describe('The coordinate string.').optional(),
    pname: z.string().describe('The province name.').optional(),
    cityname: z.string().describe('The city name.').optional(),
    adname: z.string().describe('The district or area name.').optional(),
  }).describe('A point of interest record.')).describe('The place detail records.').optional(),
}).describe('The response payload returned by the place detail action.')

export const inputTipsInput = z.strictObject({
  keywords: z.string().describe('The keywords used to search tips.'),
  type: z.string().describe('The optional category filter.').optional(),
  location: z.string().describe('The optional location bias.').optional(),
  city: z.string().describe('The optional city filter.').optional(),
  cityLimit: z.boolean().describe('Whether to limit results to the specified city.').optional(),
  dataType: z.string().describe('The optional data type filter.').optional(),
}).describe('The input parameters for fetching input tips.')

export const inputTipsOutput = z.strictObject({
  tips: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('The returned tip records.').optional(),
}).describe('The response payload returned by the input tips action.')

export const ipLocateInput = z.strictObject({
  ip: z.string().describe('The IP address to locate.').optional(),
}).describe('The input parameters for IP geolocation.')

export const ipLocateOutput = z.strictObject({
  province: z.string().describe('The province or state name.').optional(),
  city: z.string().describe('The city name.').optional(),
  adcode: z.string().describe('The administrative code.').optional(),
  rectangle: z.string().describe('The bounding rectangle string.').optional(),
}).describe('The response payload returned by the IP locate action.')

export const districtSearchInput = z.strictObject({
  keywords: z.string().describe('The district search keywords.'),
  subDistrict: z.int().describe('The subdistrict depth.').optional(),
  extensions: z.string().describe('The requested response detail level.').optional(),
  page: z.int().describe('The page number to fetch.').optional(),
  offset: z.int().describe('The result offset.').optional(),
  filter: z.string().describe('The optional filter expression.').optional(),
}).describe('The input parameters for district search.')

export const districtSearchOutput = z.strictObject({
  count: z.string().describe('The total number of matching districts.').optional(),
  districts: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('The matching districts.'),
}).describe('The response payload returned by the district search action.')

export const weatherInput = z.strictObject({
  city: z.string().describe('The city to query.'),
  extensions: z.enum(['base', 'all']).describe('The requested response detail level.').optional(),
}).describe('The input parameters for fetching weather information.')

export const weatherOutput = z.strictObject({
  lives: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('The current weather records.').optional(),
  forecasts: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('The forecast weather records.').optional(),
}).describe('The response payload returned by the weather action.')

export const routeDrivingInput = z.strictObject({
  origin: z.string().describe('The route origin.'),
  destination: z.string().describe('The route destination.'),
  waypoints: z.string().describe('The optional waypoint list.').optional(),
  strategy: z.string().describe('The optional routing strategy.').optional(),
  plate: z.string().describe('The optional license plate.').optional(),
  carType: z.string().describe('The optional car type.').optional(),
  avoidPolygons: z.string().describe('The optional avoid polygon list.').optional(),
  showFields: z.string().describe('The requested output fields.').optional(),
}).describe('The input parameters for planning a driving route.')

export const routeDrivingOutput = z.strictObject({
  route: z.strictObject({
    origin: z.string().describe('The route origin.').optional(),
    destination: z.string().describe('The route destination.').optional(),
    taxi_cost: z.string().describe('The estimated taxi cost.').optional(),
    paths: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('The available driving paths.'),
  }).describe('The route summary returned by the driving route API.').optional(),
}).describe('The response payload returned by the driving route action.')

export const routeWalkingInput = z.strictObject({
  origin: z.string().describe('The route origin.'),
  destination: z.string().describe('The route destination.'),
  showFields: z.string().describe('The requested output fields.').optional(),
}).describe('The input parameters for planning a walking route.')

export const routeWalkingOutput = z.strictObject({
  route: z.strictObject({
    origin: z.string().describe('The route origin.').optional(),
    destination: z.string().describe('The route destination.').optional(),
    paths: z.array(z.strictObject({
      distance: z.string().describe('The route distance.').optional(),
      steps: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('The route steps.'),
      cost: z.strictObject({
        duration: z.string().describe('The estimated duration.').optional(),
      }).describe('The cost summary for the route path.').optional(),
    }).describe('A single route path entry.')).describe('The available route paths.'),
  }).describe('The route summary returned by the API.').optional(),
}).describe('The response payload returned by the simple route actions.')

export const routeBicyclingInput = z.strictObject({
  origin: z.string().describe('The route origin.'),
  destination: z.string().describe('The route destination.'),
  alternativeRoute: z.string().describe('The optional alternative route mode.').optional(),
  showFields: z.string().describe('The requested output fields.').optional(),
}).describe('The input parameters for planning a bicycling route.')

export const routeBicyclingOutput = z.strictObject({
  route: z.strictObject({
    origin: z.string().describe('The route origin.').optional(),
    destination: z.string().describe('The route destination.').optional(),
    paths: z.array(z.strictObject({
      distance: z.string().describe('The route distance.').optional(),
      steps: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('The route steps.'),
      cost: z.strictObject({
        duration: z.string().describe('The estimated duration.').optional(),
      }).describe('The cost summary for the route path.').optional(),
    }).describe('A single route path entry.')).describe('The available route paths.'),
  }).describe('The route summary returned by the API.').optional(),
}).describe('The response payload returned by the simple route actions.')

export const routeElectrobikeInput = z.strictObject({
  origin: z.string().describe('The route origin.'),
  destination: z.string().describe('The route destination.'),
  showFields: z.string().describe('The requested output fields.').optional(),
}).describe('The input parameters for planning a walking route.')

export const routeElectrobikeOutput = z.strictObject({
  route: z.strictObject({
    origin: z.string().describe('The route origin.').optional(),
    destination: z.string().describe('The route destination.').optional(),
    paths: z.array(z.strictObject({
      distance: z.string().describe('The route distance.').optional(),
      steps: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('The route steps.'),
      cost: z.strictObject({
        duration: z.string().describe('The estimated duration.').optional(),
      }).describe('The cost summary for the route path.').optional(),
    }).describe('A single route path entry.')).describe('The available route paths.'),
  }).describe('The route summary returned by the API.').optional(),
}).describe('The response payload returned by the simple route actions.')

export const routeTransitInput = z.strictObject({
  origin: z.string().describe('The route origin.'),
  destination: z.string().describe('The route destination.'),
  originCity: z.string().describe('The origin city.'),
  destinationCity: z.string().describe('The destination city.'),
  strategy: z.string().describe('The optional routing strategy.').optional(),
  nightFlag: z.string().describe('The optional night transit flag.').optional(),
  showFields: z.string().describe('The requested output fields.').optional(),
}).describe('The input parameters for planning a transit route.')

export const routeTransitOutput = z.strictObject({
  route: z.strictObject({
    origin: z.string().describe('The route origin.').optional(),
    destination: z.string().describe('The route destination.').optional(),
    cost: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
    transits: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('The available transit options.'),
  }).describe('The route summary returned by the transit route API.').optional(),
}).describe('The response payload returned by the transit route action.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const amapActions = {
  geocode: {
    description: 'Convert an address to coordinates.',
    effect: 'write',
    inputSchema: geocodeInput,
    outputSchema: z.toJSONSchema(geocodeOutput, { io: 'output', unrepresentable: 'any' }),
  },
  reverse_geocode: {
    description: 'Convert coordinates to an address.',
    effect: 'write',
    inputSchema: reverseGeocodeInput,
    outputSchema: z.toJSONSchema(reverseGeocodeOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_places: {
    description: 'Search places by keyword.',
    effect: 'read',
    inputSchema: searchPlacesInput,
    outputSchema: z.toJSONSchema(searchPlacesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_places_around: {
    description: 'Search places around a location.',
    effect: 'read',
    inputSchema: searchPlacesAroundInput,
    outputSchema: z.toJSONSchema(searchPlacesAroundOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_places_polygon: {
    description: 'Search places inside a polygon.',
    effect: 'read',
    inputSchema: searchPlacesPolygonInput,
    outputSchema: z.toJSONSchema(searchPlacesPolygonOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_place_detail: {
    description: 'Get place details by id.',
    effect: 'read',
    inputSchema: getPlaceDetailInput,
    outputSchema: z.toJSONSchema(getPlaceDetailOutput, { io: 'output', unrepresentable: 'any' }),
  },
  input_tips: {
    description: 'Get input tips by keywords.',
    effect: 'write',
    inputSchema: inputTipsInput,
    outputSchema: z.toJSONSchema(inputTipsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  ip_locate: {
    description: 'Locate by IP address.',
    effect: 'write',
    inputSchema: ipLocateInput,
    outputSchema: z.toJSONSchema(ipLocateOutput, { io: 'output', unrepresentable: 'any' }),
  },
  district_search: {
    description: 'Search administrative districts.',
    effect: 'write',
    inputSchema: districtSearchInput,
    outputSchema: z.toJSONSchema(districtSearchOutput, { io: 'output', unrepresentable: 'any' }),
  },
  weather: {
    description: 'Get weather information.',
    effect: 'write',
    inputSchema: weatherInput,
    outputSchema: z.toJSONSchema(weatherOutput, { io: 'output', unrepresentable: 'any' }),
  },
  route_driving: {
    description: 'Plan a driving route.',
    effect: 'write',
    inputSchema: routeDrivingInput,
    outputSchema: z.toJSONSchema(routeDrivingOutput, { io: 'output', unrepresentable: 'any' }),
  },
  route_walking: {
    description: 'Plan a walking route.',
    effect: 'write',
    inputSchema: routeWalkingInput,
    outputSchema: z.toJSONSchema(routeWalkingOutput, { io: 'output', unrepresentable: 'any' }),
  },
  route_bicycling: {
    description: 'Plan a bicycling route.',
    effect: 'write',
    inputSchema: routeBicyclingInput,
    outputSchema: z.toJSONSchema(routeBicyclingOutput, { io: 'output', unrepresentable: 'any' }),
  },
  route_electrobike: {
    description: 'Plan an electric bike route.',
    effect: 'write',
    inputSchema: routeElectrobikeInput,
    outputSchema: z.toJSONSchema(routeElectrobikeOutput, { io: 'output', unrepresentable: 'any' }),
  },
  route_transit: {
    description: 'Plan a transit route.',
    effect: 'write',
    inputSchema: routeTransitInput,
    outputSchema: z.toJSONSchema(routeTransitOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
