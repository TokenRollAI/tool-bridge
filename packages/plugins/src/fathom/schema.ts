/**
 * Fathom Analytics 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getAccountInput = z.strictObject({}).describe('No input is required to fetch the Fathom account.')

export const getAccountOutput = z.looseObject({
  id: z.int().describe('The numeric Fathom account ID.').optional(),
  object: z.string().min(1).describe('The Fathom object type, usually account.').optional(),
  name: z.string().min(1).describe('The account owner\'s display name.').optional(),
  email: z.email().describe('The account owner\'s email address.').optional(),
}).describe('The Fathom account that owns the API key.')

export const listSitesInput = z.strictObject({
  limit: z.int().min(1).max(100).describe('The maximum number of objects to return, from 1 to 100.').optional(),
  starting_after: z.string().min(1).describe('A cursor object ID used to page forward chronologically.').optional(),
  ending_before: z.string().min(1).describe('A cursor object ID used to page backward in reverse chronology.').optional(),
}).describe('The input payload for listing Fathom sites.')

export const listSitesOutput = z.strictObject({
  object: z.string().min(1).describe('The Fathom collection object type, usually list.'),
  url: z.string().min(1).describe('The Fathom API path used for this list response.'),
  has_more: z.boolean().describe('Whether more results are available after this page.'),
  data: z.array(z.looseObject({
    id: z.string().min(1).describe('The Fathom site ID.').optional(),
    object: z.string().min(1).describe('The Fathom object type, usually site.').optional(),
    name: z.string().min(1).describe('The site display name.').optional(),
    sharing: z.string().min(1).describe('The site\'s dashboard sharing configuration.').optional(),
    created_at: z.string().min(1).describe('A Fathom timestamp string, such as 2024-01-15 00:00:00.').optional(),
    timezone: z.string().min(1).describe('The site\'s reporting timezone as a TZ database name.').optional(),
  }).describe('A Fathom site object.')).describe('The Fathom sites returned for this page.'),
}).describe('A paginated Fathom site list.')

export const getSiteInput = z.strictObject({
  site_id: z.string().min(1).describe('The Fathom site ID used in the tracking code, such as CDBUGS.'),
}).describe('The input payload for fetching a Fathom site.')

export const getSiteOutput = z.looseObject({
  id: z.string().min(1).describe('The Fathom site ID.').optional(),
  object: z.string().min(1).describe('The Fathom object type, usually site.').optional(),
  name: z.string().min(1).describe('The site display name.').optional(),
  sharing: z.string().min(1).describe('The site\'s dashboard sharing configuration.').optional(),
  created_at: z.string().min(1).describe('A Fathom timestamp string, such as 2024-01-15 00:00:00.').optional(),
  timezone: z.string().min(1).describe('The site\'s reporting timezone as a TZ database name.').optional(),
}).describe('A Fathom site object.')

export const createSiteInput = z.strictObject({
  name: z.string().min(1).max(255).describe('The website display name, up to 255 characters.'),
  sharing: z.enum(['none', 'private', 'public']).describe('The dashboard sharing configuration for the site.').optional(),
  share_password: z.string().min(1).describe('The password required when sharing is set to private.').optional(),
  timezone: z.string().min(1).describe('The site\'s reporting timezone as a TZ database name.').optional(),
}).describe('The input payload for creating a Fathom site.')

export const createSiteOutput = z.looseObject({
  id: z.string().min(1).describe('The Fathom site ID.').optional(),
  object: z.string().min(1).describe('The Fathom object type, usually site.').optional(),
  name: z.string().min(1).describe('The site display name.').optional(),
  sharing: z.string().min(1).describe('The site\'s dashboard sharing configuration.').optional(),
  created_at: z.string().min(1).describe('A Fathom timestamp string, such as 2024-01-15 00:00:00.').optional(),
  timezone: z.string().min(1).describe('The site\'s reporting timezone as a TZ database name.').optional(),
}).describe('A Fathom site object.')

export const updateSiteInput = z.strictObject({
  site_id: z.string().min(1).describe('The Fathom site ID used in the tracking code, such as CDBUGS.'),
  name: z.string().min(1).max(255).describe('The website display name, up to 255 characters.').optional(),
  sharing: z.enum(['none', 'private', 'public']).describe('The dashboard sharing configuration for the site.').optional(),
  share_password: z.string().min(1).describe('The password required when sharing is set to private.').optional(),
  timezone: z.string().min(1).describe('The site\'s reporting timezone as a TZ database name.').optional(),
}).describe('The input payload for updating a Fathom site.')

export const updateSiteOutput = z.looseObject({
  id: z.string().min(1).describe('The Fathom site ID.').optional(),
  object: z.string().min(1).describe('The Fathom object type, usually site.').optional(),
  name: z.string().min(1).describe('The site display name.').optional(),
  sharing: z.string().min(1).describe('The site\'s dashboard sharing configuration.').optional(),
  created_at: z.string().min(1).describe('A Fathom timestamp string, such as 2024-01-15 00:00:00.').optional(),
  timezone: z.string().min(1).describe('The site\'s reporting timezone as a TZ database name.').optional(),
}).describe('A Fathom site object.')

export const listEventsInput = z.strictObject({
  site_id: z.string().min(1).describe('The Fathom site ID used in the tracking code, such as CDBUGS.'),
  limit: z.int().min(1).max(100).describe('The maximum number of objects to return, from 1 to 100.').optional(),
  starting_after: z.string().min(1).describe('A cursor object ID used to page forward chronologically.').optional(),
  ending_before: z.string().min(1).describe('A cursor object ID used to page backward in reverse chronology.').optional(),
}).describe('The input payload for listing Fathom events.')

export const listEventsOutput = z.strictObject({
  object: z.string().min(1).describe('The Fathom collection object type, usually list.'),
  url: z.string().min(1).describe('The Fathom API path used for this list response.'),
  has_more: z.boolean().describe('Whether more results are available after this page.'),
  data: z.array(z.looseObject({
    id: z.string().min(1).describe('The Fathom event ID.').optional(),
    object: z.string().min(1).describe('The Fathom object type, usually event.').optional(),
    name: z.string().min(1).describe('The event display name.').optional(),
    site_id: z.string().min(1).describe('The Fathom site ID that owns this event.').optional(),
    created_at: z.string().min(1).describe('A Fathom timestamp string, such as 2024-01-15 00:00:00.').optional(),
  }).describe('A Fathom event object.')).describe('The Fathom events returned for this page.'),
}).describe('A paginated Fathom event list.')

export const getEventInput = z.strictObject({
  site_id: z.string().min(1).describe('The Fathom site ID used in the tracking code, such as CDBUGS.'),
  event_id: z.string().min(1).describe('The Fathom event ID, such as signed-up-to-newsletter.'),
}).describe('The input payload for fetching a Fathom event.')

export const getEventOutput = z.looseObject({
  id: z.string().min(1).describe('The Fathom event ID.').optional(),
  object: z.string().min(1).describe('The Fathom object type, usually event.').optional(),
  name: z.string().min(1).describe('The event display name.').optional(),
  site_id: z.string().min(1).describe('The Fathom site ID that owns this event.').optional(),
  created_at: z.string().min(1).describe('A Fathom timestamp string, such as 2024-01-15 00:00:00.').optional(),
}).describe('A Fathom event object.')

export const createEventInput = z.strictObject({
  site_id: z.string().min(1).describe('The Fathom site ID used in the tracking code, such as CDBUGS.'),
  name: z.string().min(1).max(255).describe('The event display name, up to 255 characters.'),
}).describe('The input payload for creating a Fathom event.')

export const createEventOutput = z.looseObject({
  id: z.string().min(1).describe('The Fathom event ID.').optional(),
  object: z.string().min(1).describe('The Fathom object type, usually event.').optional(),
  name: z.string().min(1).describe('The event display name.').optional(),
  site_id: z.string().min(1).describe('The Fathom site ID that owns this event.').optional(),
  created_at: z.string().min(1).describe('A Fathom timestamp string, such as 2024-01-15 00:00:00.').optional(),
}).describe('A Fathom event object.')

export const updateEventInput = z.strictObject({
  site_id: z.string().min(1).describe('The Fathom site ID used in the tracking code, such as CDBUGS.'),
  event_id: z.string().min(1).describe('The Fathom event ID, such as signed-up-to-newsletter.'),
  name: z.string().min(1).max(255).describe('The event display name, up to 255 characters.').optional(),
}).describe('The input payload for updating a Fathom event.')

export const updateEventOutput = z.looseObject({
  id: z.string().min(1).describe('The Fathom event ID.').optional(),
  object: z.string().min(1).describe('The Fathom object type, usually event.').optional(),
  name: z.string().min(1).describe('The event display name.').optional(),
  site_id: z.string().min(1).describe('The Fathom site ID that owns this event.').optional(),
  created_at: z.string().min(1).describe('A Fathom timestamp string, such as 2024-01-15 00:00:00.').optional(),
}).describe('A Fathom event object.')

export const listMilestonesInput = z.strictObject({
  site_id: z.string().min(1).describe('The Fathom site ID used in the tracking code, such as CDBUGS.'),
  limit: z.int().min(1).max(100).describe('The maximum number of objects to return, from 1 to 100.').optional(),
  starting_after: z.string().min(1).describe('A cursor object ID used to page forward chronologically.').optional(),
  ending_before: z.string().min(1).describe('A cursor object ID used to page backward in reverse chronology.').optional(),
}).describe('The input payload for listing Fathom milestones.')

export const listMilestonesOutput = z.strictObject({
  object: z.string().min(1).describe('The Fathom collection object type, usually list.'),
  url: z.string().min(1).describe('The Fathom API path used for this list response.'),
  has_more: z.boolean().describe('Whether more results are available after this page.'),
  data: z.array(z.looseObject({
    id: z.string().min(1).describe('The Fathom milestone ID.').optional(),
    object: z.string().min(1).describe('The Fathom object type, usually milestone.').optional(),
    name: z.string().min(1).describe('The milestone display name.').optional(),
    milestone_date: z.string().min(1).describe('A Fathom timestamp string, such as 2024-01-15 00:00:00.').optional(),
    created_at: z.string().min(1).describe('A Fathom timestamp string, such as 2024-01-15 00:00:00.').optional(),
    updated_at: z.string().min(1).describe('A Fathom timestamp string, such as 2024-01-15 00:00:00.').optional(),
  }).describe('A Fathom milestone object.')).describe('The Fathom milestones returned for this page.'),
}).describe('A paginated Fathom milestone list.')

export const getMilestoneInput = z.strictObject({
  site_id: z.string().min(1).describe('The Fathom site ID used in the tracking code, such as CDBUGS.'),
  milestone_id: z.string().min(1).describe('The Fathom milestone ID.'),
}).describe('The input payload for fetching a Fathom milestone.')

export const getMilestoneOutput = z.looseObject({
  id: z.string().min(1).describe('The Fathom milestone ID.').optional(),
  object: z.string().min(1).describe('The Fathom object type, usually milestone.').optional(),
  name: z.string().min(1).describe('The milestone display name.').optional(),
  milestone_date: z.string().min(1).describe('A Fathom timestamp string, such as 2024-01-15 00:00:00.').optional(),
  created_at: z.string().min(1).describe('A Fathom timestamp string, such as 2024-01-15 00:00:00.').optional(),
  updated_at: z.string().min(1).describe('A Fathom timestamp string, such as 2024-01-15 00:00:00.').optional(),
}).describe('A Fathom milestone object.')

export const createMilestoneInput = z.strictObject({
  site_id: z.string().min(1).describe('The Fathom site ID used in the tracking code, such as CDBUGS.'),
  name: z.string().min(1).max(255).describe('The milestone display name, up to 255 characters.'),
  milestone_date: z.iso.date().describe('The milestone date in YYYY-MM-DD format. It must be before today.'),
}).describe('The input payload for creating a Fathom milestone.')

export const createMilestoneOutput = z.looseObject({
  id: z.string().min(1).describe('The Fathom milestone ID.').optional(),
  object: z.string().min(1).describe('The Fathom object type, usually milestone.').optional(),
  name: z.string().min(1).describe('The milestone display name.').optional(),
  milestone_date: z.string().min(1).describe('A Fathom timestamp string, such as 2024-01-15 00:00:00.').optional(),
  created_at: z.string().min(1).describe('A Fathom timestamp string, such as 2024-01-15 00:00:00.').optional(),
  updated_at: z.string().min(1).describe('A Fathom timestamp string, such as 2024-01-15 00:00:00.').optional(),
}).describe('A Fathom milestone object.')

export const updateMilestoneInput = z.strictObject({
  site_id: z.string().min(1).describe('The Fathom site ID used in the tracking code, such as CDBUGS.'),
  milestone_id: z.string().min(1).describe('The Fathom milestone ID.'),
  name: z.string().min(1).max(255).describe('The milestone display name, up to 255 characters.').optional(),
  milestone_date: z.iso.date().describe('The milestone date in YYYY-MM-DD format. It must be before today.').optional(),
}).describe('The input payload for updating a Fathom milestone.')

export const updateMilestoneOutput = z.looseObject({
  id: z.string().min(1).describe('The Fathom milestone ID.').optional(),
  object: z.string().min(1).describe('The Fathom object type, usually milestone.').optional(),
  name: z.string().min(1).describe('The milestone display name.').optional(),
  milestone_date: z.string().min(1).describe('A Fathom timestamp string, such as 2024-01-15 00:00:00.').optional(),
  created_at: z.string().min(1).describe('A Fathom timestamp string, such as 2024-01-15 00:00:00.').optional(),
  updated_at: z.string().min(1).describe('A Fathom timestamp string, such as 2024-01-15 00:00:00.').optional(),
}).describe('A Fathom milestone object.')

export const runAggregationInput = z.strictObject({
  entity: z.enum(['pageview', 'event']).describe('The Fathom entity to report on.'),
  entity_id: z.string().min(1).describe('The site ID for pageview aggregations.').optional(),
  site_id: z.string().min(1).describe('The Fathom site ID used in the tracking code, such as CDBUGS.').optional(),
  entity_name: z.string().min(1).describe('The event name for event aggregations.').optional(),
  aggregates: z.array(z.enum(['visits', 'uniques', 'pageviews', 'avg_duration', 'bounce_rate', 'conversions', 'unique_conversions', 'value']).describe('A Fathom aggregate field.')).min(1).describe('The SUM aggregate fields to include in the report.'),
  date_grouping: z.enum(['hour', 'day', 'month', 'year']).describe('The date grouping granularity for the report.').optional(),
  field_grouping: z.array(z.enum(['hostname', 'pathname', 'referrer_hostname', 'referrer_pathname', 'referrer_source', 'browser', 'country_code', 'city', 'region', 'device_type', 'operating_system', 'utm_campaign', 'utm_content', 'utm_medium', 'utm_source', 'utm_term', 'keyword', 'q', 'ref', 's']).describe('A Fathom grouping field.')).min(1).describe('The Fathom fields to group report rows by.').optional(),
  sort_by: z.string().min(1).describe('The sort expression in field:asc or field:desc form.').optional(),
  timezone: z.string().min(1).describe('Deprecated Fathom timezone override as a TZ database name.').optional(),
  date_from: z.string().min(1).describe('The report start timestamp, such as 2022-04-01 15:31:00.').optional(),
  date_to: z.string().min(1).describe('The report end timestamp, such as 2022-04-30 23:59:59.').optional(),
  limit: z.int().min(1).describe('The maximum number of aggregation rows to return.').optional(),
  filters: z.array(z.strictObject({
    property: z.string().min(1).describe('The Fathom field to filter on, such as pathname or device_type.'),
    operator: z.enum(['is', 'is not', 'is like', 'is not like', 'matching', 'not matching']).describe('The filter operator to apply.'),
    value: z.string().min(1).describe('The value to compare against the selected property.'),
  }).describe('A Fathom aggregation filter.')).min(1).describe('Structured Fathom filters to JSON-encode for the filters query parameter.').optional(),
}).describe('The input payload for generating a Fathom aggregation report.')

export const runAggregationOutput = z.array(z.record(z.string(), z.unknown().describe('A Fathom aggregation row value.')).describe('A Fathom aggregation row. Keys vary based on requested aggregates and groupings.')).describe('Rows returned by the Fathom aggregation report.')

export const getCurrentVisitorsInput = z.strictObject({
  site_id: z.string().min(1).describe('The Fathom site ID used in the tracking code, such as CDBUGS.'),
  detailed: z.boolean().describe('Whether to include top content and referrer breakdowns.').optional(),
}).describe('The input payload for fetching current Fathom visitors.')

export const getCurrentVisitorsOutput = z.looseObject({
  total: z.int().describe('The number of current visitors on the site.').optional(),
  content: z.array(z.looseObject({
    pathname: z.string().min(1).describe('The content pathname.').optional(),
    hostname: z.string().min(1).describe('The content hostname.').optional(),
    total: z.int().describe('The number of current visitors for this content row.').optional(),
  }).describe('A current visitor content row.')).describe('The top content rows when detailed mode is enabled.').optional(),
  referrers: z.array(z.looseObject({
    referrer_hostname: z.string().min(1).describe('The referrer hostname.').optional(),
    referrer_pathname: z.string().min(1).describe('The referrer pathname.').optional(),
    total: z.int().describe('The number of current visitors for this referrer row.').optional(),
  }).describe('A current visitor referrer row.')).describe('The top referrer rows when detailed mode is enabled.').optional(),
}).describe('The current visitor response from Fathom.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const fathomActions = {
  get_account: {
    description: 'Retrieve the Fathom account that owns the API key.',
    effect: 'read',
    inputSchema: getAccountInput,
    outputSchema: z.toJSONSchema(getAccountOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_sites: {
    description: 'List Fathom sites available to the API key.',
    effect: 'read',
    inputSchema: listSitesInput,
    outputSchema: z.toJSONSchema(listSitesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_site: {
    description: 'Retrieve a single Fathom site by site ID.',
    effect: 'read',
    inputSchema: getSiteInput,
    outputSchema: z.toJSONSchema(getSiteOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_site: {
    description: 'Create a Fathom site.',
    effect: 'write',
    inputSchema: createSiteInput,
    outputSchema: z.toJSONSchema(createSiteOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_site: {
    description: 'Update a Fathom site.',
    effect: 'write',
    inputSchema: updateSiteInput,
    outputSchema: z.toJSONSchema(updateSiteOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_events: {
    description: 'List events for a Fathom site.',
    effect: 'read',
    inputSchema: listEventsInput,
    outputSchema: z.toJSONSchema(listEventsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_event: {
    description: 'Retrieve a single Fathom event by site ID and event ID.',
    effect: 'read',
    inputSchema: getEventInput,
    outputSchema: z.toJSONSchema(getEventOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_event: {
    description: 'Create a Fathom event for a site.',
    effect: 'write',
    inputSchema: createEventInput,
    outputSchema: z.toJSONSchema(createEventOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_event: {
    description: 'Update a Fathom event.',
    effect: 'write',
    inputSchema: updateEventInput,
    outputSchema: z.toJSONSchema(updateEventOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_milestones: {
    description: 'List milestones for a Fathom site.',
    effect: 'read',
    inputSchema: listMilestonesInput,
    outputSchema: z.toJSONSchema(listMilestonesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_milestone: {
    description: 'Retrieve a single Fathom milestone by site ID and milestone ID.',
    effect: 'read',
    inputSchema: getMilestoneInput,
    outputSchema: z.toJSONSchema(getMilestoneOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_milestone: {
    description: 'Create a Fathom milestone for a site.',
    effect: 'write',
    inputSchema: createMilestoneInput,
    outputSchema: z.toJSONSchema(createMilestoneOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_milestone: {
    description: 'Update a Fathom milestone.',
    effect: 'write',
    inputSchema: updateMilestoneInput,
    outputSchema: z.toJSONSchema(updateMilestoneOutput, { io: 'output', unrepresentable: 'any' }),
  },
  run_aggregation: {
    description: 'Generate a Fathom analytics aggregation report.',
    effect: 'write',
    inputSchema: runAggregationInput,
    outputSchema: z.toJSONSchema(runAggregationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_current_visitors: {
    description: 'Fetch the current visitor count and optional detailed breakdown for a Fathom site.',
    effect: 'read',
    inputSchema: getCurrentVisitorsInput,
    outputSchema: z.toJSONSchema(getCurrentVisitorsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
