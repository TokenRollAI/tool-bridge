/**
 * Umami 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getCurrentUserInput = z.strictObject({}).describe('No input is required to get the current Umami user.')

export const getCurrentUserOutput = z.strictObject({
  user: z.looseObject({
    id: z.string().describe('User ID.').optional(),
    username: z.string().describe('Username.').optional(),
    role: z.string().describe('User role.').optional(),
    isAdmin: z.boolean().describe('Whether the user has administrator privileges.').optional(),
  }).describe('Umami user profile.'),
  raw: z.looseObject({}).describe('Raw Umami response payload.'),
}).describe('Current Umami user response.')

export const listWebsitesInput = z.strictObject({
  query: z.string().describe('Search query filter for the endpoint.').optional(),
  page: z.int().min(1).describe('One-based page number for paginated Umami endpoints.').optional(),
  pageSize: z.int().min(1).describe('Number of items to return per page.').optional(),
}).describe('Optional pagination and search parameters for listing Umami websites.')

export const listWebsitesOutput = z.strictObject({
  websites: z.array(z.looseObject({
    id: z.string().describe('Website ID.').optional(),
    name: z.string().describe('Website name.').optional(),
    domain: z.string().describe('Website domain.').optional(),
    shareId: z.string().describe('Public share ID when sharing is enabled.').nullable().optional(),
  }).describe('Umami website.')).describe('Websites returned by Umami.'),
  count: z.int().min(0).describe('Total number of websites matching the query.'),
  page: z.int().min(1).describe('Current page number.'),
  pageSize: z.int().min(1).describe('Page size used by Umami.'),
  raw: z.looseObject({
    data: z.array(z.looseObject({
      id: z.string().describe('Website ID.').optional(),
      name: z.string().describe('Website name.').optional(),
      domain: z.string().describe('Website domain.').optional(),
      shareId: z.string().describe('Public share ID when sharing is enabled.').nullable().optional(),
    }).describe('Umami website.')).describe('Websites returned by Umami.').optional(),
    count: z.int().min(0).describe('Total number of websites matching the query.').optional(),
    page: z.int().min(1).describe('Current page number.').optional(),
    pageSize: z.int().min(1).describe('Page size used by Umami.').optional(),
  }).describe('Paginated Umami websites response.'),
}).describe('Umami website list response.')

export const getWebsiteInput = z.strictObject({
  websiteId: z.string().min(1).describe('The Umami website ID.'),
}).describe('Request parameters for retrieving an Umami website.')

export const getWebsiteOutput = z.strictObject({
  website: z.looseObject({
    id: z.string().describe('Website ID.').optional(),
    name: z.string().describe('Website name.').optional(),
    domain: z.string().describe('Website domain.').optional(),
    shareId: z.string().describe('Public share ID when sharing is enabled.').nullable().optional(),
  }).describe('Umami website.'),
  raw: z.looseObject({}).describe('Raw Umami response payload.'),
}).describe('Umami website response.')

export const getWebsiteStatsInput = z.strictObject({
  websiteId: z.string().min(1).describe('The Umami website ID.'),
  startAt: z.int().min(0).describe('Start timestamp in milliseconds since the Unix epoch.'),
  endAt: z.int().min(0).describe('End timestamp in milliseconds since the Unix epoch.'),
  timezone: z.string().min(1).describe('IANA timezone name used by Umami for date grouping.'),
  url: z.string().describe('URL path filter for the query.').optional(),
  referrer: z.string().describe('Referrer filter for the query.').optional(),
  title: z.string().describe('Page title filter for the query.').optional(),
  host: z.string().describe('Host filter for the query.').optional(),
  os: z.string().describe('Operating system filter for the query.').optional(),
  browser: z.string().describe('Browser filter for the query.').optional(),
  device: z.string().describe('Device filter for the query.').optional(),
  country: z.string().describe('Country filter for the query.').optional(),
  region: z.string().describe('Region filter for the query.').optional(),
  city: z.string().describe('City filter for the query.').optional(),
}).describe('Request parameters for retrieving Umami website statistics.')

export const getWebsiteStatsOutput = z.strictObject({
  stats: z.looseObject({
    pageviews: z.unknown().describe('Pageview count or comparison object returned by Umami.').optional(),
    visitors: z.unknown().describe('Visitor count or comparison object returned by Umami.').optional(),
    visits: z.unknown().describe('Visit count or comparison object returned by Umami.').optional(),
    bounces: z.unknown().describe('Bounce count or comparison object returned by Umami.').optional(),
    totaltime: z.unknown().describe('Total time count or comparison object returned by Umami.').optional(),
  }).describe('Umami website statistics.'),
  raw: z.looseObject({}).describe('Raw Umami response payload.'),
}).describe('Umami website statistics response.')

export const getPageviewsInput = z.strictObject({
  websiteId: z.string().min(1).describe('The Umami website ID.'),
  startAt: z.int().min(0).describe('Start timestamp in milliseconds since the Unix epoch.'),
  endAt: z.int().min(0).describe('End timestamp in milliseconds since the Unix epoch.'),
  timezone: z.string().min(1).describe('IANA timezone name used by Umami for date grouping.'),
  url: z.string().describe('URL path filter for the query.').optional(),
  referrer: z.string().describe('Referrer filter for the query.').optional(),
  title: z.string().describe('Page title filter for the query.').optional(),
  host: z.string().describe('Host filter for the query.').optional(),
  os: z.string().describe('Operating system filter for the query.').optional(),
  browser: z.string().describe('Browser filter for the query.').optional(),
  device: z.string().describe('Device filter for the query.').optional(),
  country: z.string().describe('Country filter for the query.').optional(),
  region: z.string().describe('Region filter for the query.').optional(),
  city: z.string().describe('City filter for the query.').optional(),
  unit: z.enum(['hour', 'day', 'month', 'year']).describe('Time unit used for timeseries grouping.').optional(),
}).describe('Request parameters for retrieving Umami pageview timeseries.')

export const getPageviewsOutput = z.strictObject({
  pageviews: z.looseObject({}).describe('Raw Umami response payload.'),
  raw: z.looseObject({}).describe('Raw Umami response payload.'),
}).describe('Umami pageview timeseries response.')

export const getMetricsInput = z.strictObject({
  websiteId: z.string().min(1).describe('The Umami website ID.'),
  startAt: z.int().min(0).describe('Start timestamp in milliseconds since the Unix epoch.'),
  endAt: z.int().min(0).describe('End timestamp in milliseconds since the Unix epoch.'),
  timezone: z.string().min(1).describe('IANA timezone name used by Umami for date grouping.'),
  url: z.string().describe('URL path filter for the query.').optional(),
  referrer: z.string().describe('Referrer filter for the query.').optional(),
  title: z.string().describe('Page title filter for the query.').optional(),
  host: z.string().describe('Host filter for the query.').optional(),
  os: z.string().describe('Operating system filter for the query.').optional(),
  browser: z.string().describe('Browser filter for the query.').optional(),
  device: z.string().describe('Device filter for the query.').optional(),
  country: z.string().describe('Country filter for the query.').optional(),
  region: z.string().describe('Region filter for the query.').optional(),
  city: z.string().describe('City filter for the query.').optional(),
  type: z.enum(['url', 'referrer', 'browser', 'os', 'device', 'country', 'region', 'city', 'language', 'event']).describe('Website metric dimension to return.'),
  limit: z.int().min(1).describe('Maximum number of metric rows to return.').optional(),
}).describe('Request parameters for retrieving grouped Umami website metrics.')

export const getMetricsOutput = z.strictObject({
  metrics: z.array(z.looseObject({
    x: z.unknown().describe('Metric dimension value returned by Umami.').optional(),
    y: z.number().describe('Metric count returned by Umami.').optional(),
  }).describe('Umami metric row.')).describe('Metric rows returned by Umami.'),
  raw: z.array(z.unknown().describe('Raw Umami array item.')).describe('Raw Umami response array.'),
}).describe('Umami website metrics response.')

export const getRealtimeInput = z.strictObject({
  websiteId: z.string().min(1).describe('The Umami website ID.'),
}).describe('Request parameters for retrieving Umami realtime data.')

export const getRealtimeOutput = z.strictObject({
  realtime: z.looseObject({}).describe('Raw Umami response payload.'),
  raw: z.looseObject({}).describe('Raw Umami response payload.'),
}).describe('Umami realtime response.')

export const listEventsInput = z.strictObject({
  websiteId: z.string().min(1).describe('The Umami website ID.'),
  startAt: z.int().min(0).describe('Start timestamp in milliseconds since the Unix epoch.'),
  endAt: z.int().min(0).describe('End timestamp in milliseconds since the Unix epoch.'),
  timezone: z.string().min(1).describe('IANA timezone name used by Umami for date grouping.'),
  url: z.string().describe('URL path filter for the query.').optional(),
  referrer: z.string().describe('Referrer filter for the query.').optional(),
  title: z.string().describe('Page title filter for the query.').optional(),
  host: z.string().describe('Host filter for the query.').optional(),
  os: z.string().describe('Operating system filter for the query.').optional(),
  browser: z.string().describe('Browser filter for the query.').optional(),
  device: z.string().describe('Device filter for the query.').optional(),
  country: z.string().describe('Country filter for the query.').optional(),
  region: z.string().describe('Region filter for the query.').optional(),
  city: z.string().describe('City filter for the query.').optional(),
  query: z.string().describe('Search query filter for the endpoint.').optional(),
  page: z.int().min(1).describe('One-based page number for paginated Umami endpoints.').optional(),
  pageSize: z.int().min(1).describe('Number of items to return per page.').optional(),
}).describe('Request parameters for listing Umami events.')

export const listEventsOutput = z.strictObject({
  events: z.array(z.looseObject({
    id: z.string().describe('Event ID.').optional(),
    websiteId: z.string().describe('Website ID.').optional(),
    sessionId: z.string().describe('Session ID.').optional(),
    eventName: z.string().describe('Event name.').optional(),
    urlPath: z.string().describe('URL path associated with the event.').optional(),
    createdAt: z.string().describe('Event creation timestamp returned by Umami.').optional(),
  }).describe('Umami event row.')).describe('Events returned by Umami.'),
  count: z.int().min(0).describe('Total number of events matching the query.'),
  page: z.int().min(1).describe('Current page number.'),
  pageSize: z.int().min(1).describe('Page size used by Umami.'),
  raw: z.looseObject({}).describe('Raw Umami event list response.'),
}).describe('Umami event list response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const umamiActions = {
  get_current_user: {
    description: 'Get the current Umami user for the configured API token.',
    effect: 'read',
    inputSchema: getCurrentUserInput,
    outputSchema: z.toJSONSchema(getCurrentUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_websites: {
    description: 'List Umami websites available to the configured API token.',
    effect: 'read',
    inputSchema: listWebsitesInput,
    outputSchema: z.toJSONSchema(listWebsitesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_website: {
    description: 'Get metadata for a single Umami website.',
    effect: 'read',
    inputSchema: getWebsiteInput,
    outputSchema: z.toJSONSchema(getWebsiteOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_website_stats: {
    description: 'Get aggregate pageview, visitor, visit, bounce, and time statistics for a website.',
    effect: 'read',
    inputSchema: getWebsiteStatsInput,
    outputSchema: z.toJSONSchema(getWebsiteStatsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_pageviews: {
    description: 'Get Umami pageview and session timeseries for a website.',
    effect: 'read',
    inputSchema: getPageviewsInput,
    outputSchema: z.toJSONSchema(getPageviewsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_metrics: {
    description: 'Get grouped Umami website metrics such as URLs, referrers, browsers, or countries.',
    effect: 'read',
    inputSchema: getMetricsInput,
    outputSchema: z.toJSONSchema(getMetricsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_realtime: {
    description: 'Get realtime active visitor data for an Umami website.',
    effect: 'read',
    inputSchema: getRealtimeInput,
    outputSchema: z.toJSONSchema(getRealtimeOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_events: {
    description: 'List tracked Umami events for a website within a time range.',
    effect: 'read',
    inputSchema: listEventsInput,
    outputSchema: z.toJSONSchema(listEventsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
