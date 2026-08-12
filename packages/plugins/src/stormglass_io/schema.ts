/**
 * Stormglass 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getWeatherPointInput = z.strictObject({
  lat: z.number().min(-90).max(90).describe('Latitude of the requested coordinate in decimal degrees.'),
  lng: z.number().min(-180).max(180).describe('Longitude of the requested coordinate in decimal degrees.'),
  params: z.array(z.enum(['airTemperature', 'airTemperature80m', 'airTemperature100m', 'airTemperature1000hpa', 'airTemperature800hpa', 'airTemperature500hpa', 'airTemperature200hpa', 'pressure', 'cloudCover', 'currentDirection', 'currentSpeed', 'dewPointTemperature', 'gust', 'humidity', 'iceCover', 'precipitation', 'rain', 'snow', 'graupel', 'snowAlbedo', 'snowDepth', 'seaIceThickness', 'seaLevel', 'swellDirection', 'swellHeight', 'swellPeriod', 'secondarySwellPeriod', 'secondarySwellDirection', 'secondarySwellHeight', 'visibility', 'waterTemperature', 'surfaceTemperature', 'waveDirection', 'waveHeight', 'wavePeriod', 'windWaveDirection', 'windWaveHeight', 'windWavePeriod', 'windDirection', 'windDirection20m', 'windDirection30m', 'windDirection40m', 'windDirection50m', 'windDirection80m', 'windDirection100m', 'windDirection1000hpa', 'windDirection800hpa', 'windDirection500hpa', 'windDirection200hpa', 'windSpeed', 'windSpeed20m', 'windSpeed30m', 'windSpeed40m', 'windSpeed50m', 'windSpeed80m', 'windSpeed100m', 'windSpeed1000hpa', 'windSpeed800hpa', 'windSpeed500hpa', 'windSpeed200hpa']).describe('One Stormglass weather parameter to request.')).min(1).describe('Weather parameters to request from Stormglass.'),
  start: z.union([z.string().min(1).describe('An ISO 8601 timestamp or date string accepted by Stormglass.'), z.int().describe('A UNIX timestamp accepted by Stormglass.')]).describe('A Stormglass time value in ISO 8601 or UNIX timestamp format.').optional(),
  end: z.union([z.string().min(1).describe('An ISO 8601 timestamp or date string accepted by Stormglass.'), z.int().describe('A UNIX timestamp accepted by Stormglass.')]).describe('A Stormglass time value in ISO 8601 or UNIX timestamp format.').optional(),
  source: z.array(z.enum(['sg', 'noaa', 'dwd', 'icon', 'meteo', 'smhi']).describe('One Stormglass weather source identifier.')).min(1).describe('Weather sources to request from Stormglass.').optional(),
}).describe('Input parameters for querying a Stormglass weather point.')

export const getWeatherPointOutput = z.strictObject({
  hours: z.array(z.looseObject({
    time: z.string().describe('The UTC timestamp for this weather hour.'),
  }).describe('One Stormglass weather hour entry.')).describe('Hourly weather entries returned by Stormglass.'),
  meta: z.looseObject({
    dailyQuota: z.int().describe('The daily request quota assigned to the API key.'),
    requestCount: z.int().describe('The number of requests used so far today.'),
    lat: z.number().describe('The latitude resolved by Stormglass.'),
    lng: z.number().describe('The longitude resolved by Stormglass.'),
  }).describe('Metadata returned by a Stormglass weather request.'),
}).describe('Stormglass weather point response.')

export const getTideExtremesInput = z.strictObject({
  lat: z.number().min(-90).max(90).describe('Latitude of the requested coordinate in decimal degrees.'),
  lng: z.number().min(-180).max(180).describe('Longitude of the requested coordinate in decimal degrees.'),
  start: z.union([z.string().min(1).describe('An ISO 8601 timestamp or date string accepted by Stormglass.'), z.int().describe('A UNIX timestamp accepted by Stormglass.')]).describe('A Stormglass time value in ISO 8601 or UNIX timestamp format.').optional(),
  end: z.union([z.string().min(1).describe('An ISO 8601 timestamp or date string accepted by Stormglass.'), z.int().describe('A UNIX timestamp accepted by Stormglass.')]).describe('A Stormglass time value in ISO 8601 or UNIX timestamp format.').optional(),
  datum: z.enum(['MLLW', 'MSL']).describe('The tide datum used for relative sea-level values.').optional(),
}).describe('Input parameters for querying a Stormglass tide point.')

export const getTideExtremesOutput = z.strictObject({
  extremes: z.array(z.strictObject({
    height: z.number().describe('The relative tide height in meters.'),
    time: z.string().describe('The UTC timestamp of the tide extreme.'),
    type: z.enum(['high', 'low']).describe('The tide extreme type returned by Stormglass.'),
  }).describe('One Stormglass tide extreme record.')).describe('Tide extreme records returned by Stormglass.'),
  meta: z.looseObject({
    station: z.looseObject({
      distance: z.number().describe('The distance from the requested coordinate in kilometers.').optional(),
      lat: z.number().describe('The latitude of the selected tide station.').optional(),
      lng: z.number().describe('The longitude of the selected tide station.').optional(),
      name: z.string().describe('The tide station name.').optional(),
      source: z.string().describe('The tide station owner or data source.').optional(),
    }).describe('The tide station metadata returned by Stormglass.').optional(),
    datum: z.enum(['MLLW', 'MSL']).describe('The tide datum used for relative sea-level values.').optional(),
  }).describe('Metadata returned by a Stormglass tide request.'),
}).describe('Stormglass tide extremes response.')

export const getTideSeaLevelInput = z.strictObject({
  lat: z.number().min(-90).max(90).describe('Latitude of the requested coordinate in decimal degrees.'),
  lng: z.number().min(-180).max(180).describe('Longitude of the requested coordinate in decimal degrees.'),
  start: z.union([z.string().min(1).describe('An ISO 8601 timestamp or date string accepted by Stormglass.'), z.int().describe('A UNIX timestamp accepted by Stormglass.')]).describe('A Stormglass time value in ISO 8601 or UNIX timestamp format.').optional(),
  end: z.union([z.string().min(1).describe('An ISO 8601 timestamp or date string accepted by Stormglass.'), z.int().describe('A UNIX timestamp accepted by Stormglass.')]).describe('A Stormglass time value in ISO 8601 or UNIX timestamp format.').optional(),
  datum: z.enum(['MLLW', 'MSL']).describe('The tide datum used for relative sea-level values.').optional(),
}).describe('Input parameters for querying a Stormglass tide point.')

export const getTideSeaLevelOutput = z.strictObject({
  seaLevels: z.array(z.looseObject({
    time: z.string().describe('The UTC timestamp of the sea-level reading.'),
  }).describe('One Stormglass tide sea-level record.')).describe('Hourly sea-level entries returned by Stormglass.'),
  meta: z.looseObject({
    station: z.looseObject({
      distance: z.number().describe('The distance from the requested coordinate in kilometers.').optional(),
      lat: z.number().describe('The latitude of the selected tide station.').optional(),
      lng: z.number().describe('The longitude of the selected tide station.').optional(),
      name: z.string().describe('The tide station name.').optional(),
      source: z.string().describe('The tide station owner or data source.').optional(),
    }).describe('The tide station metadata returned by Stormglass.').optional(),
    datum: z.enum(['MLLW', 'MSL']).describe('The tide datum used for relative sea-level values.').optional(),
  }).describe('Metadata returned by a Stormglass tide request.'),
}).describe('Stormglass tide sea-level response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const stormglassIoActions = {
  get_weather_point: {
    description: 'Get Stormglass forecast weather data for one coordinate.',
    effect: 'read',
    inputSchema: getWeatherPointInput,
    outputSchema: z.toJSONSchema(getWeatherPointOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_tide_extremes: {
    description: 'Get Stormglass high and low tide extremes for one coordinate.',
    effect: 'read',
    inputSchema: getTideExtremesInput,
    outputSchema: z.toJSONSchema(getTideExtremesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_tide_sea_level: {
    description: 'Get Stormglass hourly tide sea-level data for one coordinate.',
    effect: 'read',
    inputSchema: getTideSeaLevelInput,
    outputSchema: z.toJSONSchema(getTideSeaLevelOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
