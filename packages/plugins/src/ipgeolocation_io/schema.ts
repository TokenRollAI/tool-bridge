/**
 * IPGeolocation.io 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const lookupIpInput = z.strictObject({
  ip: z.string().min(1).regex(new RegExp('\\S')).describe('The IPv4 or IPv6 address to look up.').optional(),
  fields: z.array(z.string().min(1).describe('One IPGeolocation.io field name.')).min(1).describe('Specific response fields to request from IPGeolocation.io.').optional(),
  excludes: z.array(z.string().min(1).describe('One IPGeolocation.io field name.')).min(1).describe('Specific response fields to exclude from the IPGeolocation.io response.').optional(),
  includeHostname: z.boolean().describe('Whether to include hostname data in the geolocation response.').optional(),
  includeGeoAccuracy: z.boolean().describe('Whether to include geo accuracy fields in the geolocation response.').optional(),
  includeDmaCode: z.boolean().describe('Whether to include DMA code fields in the geolocation response.').optional(),
  includeSecurity: z.boolean().describe('Whether to include security threat intelligence fields.').optional(),
  includeAbuse: z.boolean().describe('Whether to include abuse contact fields.').optional(),
  includeUserAgent: z.boolean().describe('Whether to include user-agent derived fields when supported.').optional(),
}).describe('The input payload for looking up an IP address.')

export const lookupIpOutput = z.strictObject({
  geolocation: z.strictObject({
    ip: z.string().describe('The queried IP address.').nullable().optional(),
    hostname: z.string().describe('The hostname associated with the IP address when returned.').nullable().optional(),
    continentCode: z.string().describe('The continent code.').nullable().optional(),
    continentName: z.string().describe('The continent name.').nullable().optional(),
    countryCode2: z.string().describe('The ISO 3166-1 alpha-2 country code.').nullable().optional(),
    countryCode3: z.string().describe('The ISO 3166-1 alpha-3 country code.').nullable().optional(),
    countryName: z.string().describe('The country name.').nullable().optional(),
    stateProvince: z.string().describe('The state or province name.').nullable().optional(),
    district: z.string().describe('The district name.').nullable().optional(),
    city: z.string().describe('The city name.').nullable().optional(),
    zipcode: z.string().describe('The postal code.').nullable().optional(),
    latitude: z.number().describe('The latitude returned by IPGeolocation.io.').nullable().optional(),
    longitude: z.number().describe('The longitude returned by IPGeolocation.io.').nullable().optional(),
    callingCode: z.string().describe('The international calling code.').nullable().optional(),
    countryFlag: z.string().describe('The country flag URL or emoji field returned by IPGeolocation.io.').nullable().optional(),
    countryMetadata: z.looseObject({}).describe('The raw object returned by IPGeolocation.io.').nullable().optional(),
    network: z.looseObject({}).describe('The raw object returned by IPGeolocation.io.').nullable().optional(),
    asn: z.looseObject({}).describe('The raw object returned by IPGeolocation.io.').nullable().optional(),
    company: z.looseObject({}).describe('The raw object returned by IPGeolocation.io.').nullable().optional(),
    timeZone: z.looseObject({}).describe('The raw object returned by IPGeolocation.io.').nullable().optional(),
    currency: z.looseObject({}).describe('The raw object returned by IPGeolocation.io.').nullable().optional(),
    security: z.looseObject({}).describe('The raw object returned by IPGeolocation.io.').nullable().optional(),
    abuse: z.looseObject({}).describe('The raw object returned by IPGeolocation.io.').nullable().optional(),
    userAgent: z.looseObject({}).describe('The raw object returned by IPGeolocation.io.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw object returned by IPGeolocation.io.').optional(),
  }).describe('The normalized IP geolocation result.').optional(),
}).describe('The response returned when looking up an IP address.')

export const getTimezoneInput = z.strictObject({
  ip: z.string().min(1).regex(new RegExp('\\S')).describe('The IPv4 or IPv6 address to look up.').optional(),
  lat: z.number().min(-90).max(90).describe('The latitude coordinate.').optional(),
  long: z.number().min(-180).max(180).describe('The longitude coordinate.').optional(),
  location: z.string().min(1).regex(new RegExp('\\S')).describe('The location string accepted by IPGeolocation.io.').optional(),
  timeZone: z.string().min(1).regex(new RegExp('\\S')).describe('The IANA time zone name.').optional(),
}).describe('The input payload for getting IPGeolocation.io time zone data.')

export const getTimezoneOutput = z.strictObject({
  timeZone: z.strictObject({
    timeZone: z.string().describe('The IANA time zone name.').nullable().optional(),
    date: z.string().describe('The date returned by IPGeolocation.io.').nullable().optional(),
    dateTime: z.string().describe('The local date and time string.').nullable().optional(),
    dateTimeTxt: z.string().describe('The formatted local date and time text.').nullable().optional(),
    dateTimeWti: z.string().describe('The local date and time with time zone information.').nullable().optional(),
    dateTimeYmd: z.string().describe('The local date in YYYY-MM-DD format.').nullable().optional(),
    dateTimeUnix: z.number().describe('The local date and time as a Unix timestamp when returned.').nullable().optional(),
    time24: z.string().describe('The 24-hour local time string.').nullable().optional(),
    time12: z.string().describe('The 12-hour local time string.').nullable().optional(),
    week: z.int().describe('The week number.').nullable().optional(),
    month: z.int().describe('The month number.').nullable().optional(),
    year: z.int().describe('The year.').nullable().optional(),
    yearAbbr: z.string().describe('The abbreviated year.').nullable().optional(),
    isDst: z.boolean().describe('Whether daylight saving time is active.').nullable().optional(),
    dstSavings: z.int().describe('The daylight saving time offset in seconds.').nullable().optional(),
    geo: z.looseObject({}).describe('The raw object returned by IPGeolocation.io.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw object returned by IPGeolocation.io.').optional(),
  }).describe('The normalized IPGeolocation.io time zone result.').optional(),
}).describe('The response returned when getting time zone data.')

export const getAstronomyInput = z.strictObject({
  ip: z.string().min(1).regex(new RegExp('\\S')).describe('The IPv4 or IPv6 address to look up.').optional(),
  lat: z.number().min(-90).max(90).describe('The latitude coordinate.').optional(),
  long: z.number().min(-180).max(180).describe('The longitude coordinate.').optional(),
  location: z.string().min(1).regex(new RegExp('\\S')).describe('The location string accepted by IPGeolocation.io.').optional(),
  date: z.iso.date().describe('The date to use for astronomy data in YYYY-MM-DD format.').optional(),
}).describe('The input payload for getting IPGeolocation.io astronomy data.')

export const getAstronomyOutput = z.strictObject({
  astronomy: z.strictObject({
    location: z.looseObject({}).describe('The raw object returned by IPGeolocation.io.').nullable().optional(),
    date: z.string().describe('The date used for the astronomy result.').nullable().optional(),
    currentTime: z.string().describe('The current local time returned by IPGeolocation.io.').nullable().optional(),
    sunrise: z.string().describe('The sunrise time.').nullable().optional(),
    sunset: z.string().describe('The sunset time.').nullable().optional(),
    sunStatus: z.string().describe('The current sun status when returned.').nullable().optional(),
    solarNoon: z.string().describe('The solar noon time.').nullable().optional(),
    dayLength: z.string().describe('The day length.').nullable().optional(),
    moonrise: z.string().describe('The moonrise time.').nullable().optional(),
    moonset: z.string().describe('The moonset time.').nullable().optional(),
    moonStatus: z.string().describe('The current moon status when returned.').nullable().optional(),
    moonPhase: z.string().describe('The moon phase name.').nullable().optional(),
    moonIlluminationPercentage: z.number().describe('The moon illumination percentage when returned.').nullable().optional(),
    moonAngle: z.number().describe('The moon angle when returned.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw object returned by IPGeolocation.io.').optional(),
  }).describe('The normalized IPGeolocation.io astronomy result.').optional(),
}).describe('The response returned when getting astronomy data.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const ipgeolocationIoActions = {
  lookup_ip: {
    description: 'Look up IP geolocation data with optional field controls.',
    effect: 'write',
    inputSchema: lookupIpInput,
    outputSchema: z.toJSONSchema(lookupIpOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_timezone: {
    description: 'Get time zone information by IP address, coordinates, location, or time zone name.',
    effect: 'read',
    inputSchema: getTimezoneInput,
    outputSchema: z.toJSONSchema(getTimezoneOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_astronomy: {
    description: 'Get sunrise, sunset, moonrise, moonset, and moon phase data for a location.',
    effect: 'read',
    inputSchema: getAstronomyInput,
    outputSchema: z.toJSONSchema(getAstronomyOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
