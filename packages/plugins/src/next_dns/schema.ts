/**
 * NextDNS 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listProfilesInput = z.strictObject({}).describe('The input payload for listing NextDNS profiles.')

export const listProfilesOutput = z.strictObject({
  data: z.array(z.looseObject({
    id: z.string().describe('The NextDNS profile ID.').optional(),
    name: z.string().describe('The profile name.').optional(),
    role: z.string().describe('The current user\'s role for this profile.').optional(),
    fingerprint: z.string().describe('The profile fingerprint when returned by NextDNS.').optional(),
  }).describe('A NextDNS profile summary.')).describe('The items returned by NextDNS.'),
  meta: z.looseObject({
    pagination: z.strictObject({
      cursor: z.string().describe('The cursor for the next page of results.').optional(),
    }).describe('The pagination metadata returned by NextDNS.').optional(),
  }).describe('The response metadata returned by NextDNS.').nullable(),
  raw: z.looseObject({}).describe('The raw response returned by NextDNS.'),
}).describe('The response returned when listing NextDNS profiles.')

export const getProfileInput = z.strictObject({
  profileId: z.string().min(1).regex(new RegExp('\\S')).describe('The NextDNS profile ID.'),
}).describe('The input payload for retrieving a NextDNS profile.')

export const getProfileOutput = z.strictObject({
  profile: z.looseObject({}).describe('The raw profile object returned by NextDNS.'),
  raw: z.looseObject({}).describe('The raw response returned by NextDNS.'),
}).describe('The response returned when retrieving a NextDNS profile.')

export const getLogsInput = z.strictObject({
  profileId: z.string().min(1).regex(new RegExp('\\S')).describe('The NextDNS profile ID.'),
  from: z.string().min(1).regex(new RegExp('\\S')).describe('The inclusive start date filter. NextDNS accepts ISO timestamps, Unix timestamps, and relative values such as -1d.').optional(),
  to: z.string().min(1).regex(new RegExp('\\S')).describe('The exclusive end date filter. NextDNS accepts ISO timestamps, Unix timestamps, and relative values such as now.').optional(),
  limit: z.int().min(10).max(1000).describe('The maximum number of log entries to return.').optional(),
  cursor: z.string().min(1).describe('The opaque pagination cursor from a previous response.').optional(),
  device: z.string().min(1).describe('The NextDNS device ID to filter by, or __UNIDENTIFIED__ for unidentified devices.').optional(),
  search: z.string().min(1).describe('The domain or substring to search for in logs.').optional(),
  status: z.enum(['default', 'error', 'blocked', 'allowed']).describe('The DNS query status to filter by.').optional(),
  sort: z.enum(['asc', 'desc']).describe('The log order to request from NextDNS.').optional(),
  raw: z.boolean().describe('Whether to return raw DNS queries instead of filtered navigational logs.').optional(),
}).describe('The input payload for listing NextDNS logs.')

export const getLogsOutput = z.strictObject({
  data: z.array(z.looseObject({
    timestamp: z.string().describe('The query timestamp.').optional(),
    domain: z.string().describe('The queried domain.').optional(),
    status: z.string().describe('The query status.').optional(),
    protocol: z.string().describe('The query protocol.').optional(),
    reasons: z.array(z.looseObject({}).describe('One log reason.')).describe('The reasons attached to this log entry.').optional(),
  }).describe('One NextDNS log entry.')).describe('The items returned by NextDNS.'),
  meta: z.looseObject({
    pagination: z.strictObject({
      cursor: z.string().describe('The cursor for the next page of results.').optional(),
    }).describe('The pagination metadata returned by NextDNS.').optional(),
  }).describe('The response metadata returned by NextDNS.').nullable(),
  raw: z.looseObject({}).describe('The raw response returned by NextDNS.'),
}).describe('The response returned when listing NextDNS logs.')

export const getAnalyticsDomainsInput = z.strictObject({
  profileId: z.string().min(1).regex(new RegExp('\\S')).describe('The NextDNS profile ID.'),
  from: z.string().min(1).regex(new RegExp('\\S')).describe('The inclusive start date filter. NextDNS accepts ISO timestamps, Unix timestamps, and relative values such as -7d.').optional(),
  to: z.string().min(1).regex(new RegExp('\\S')).describe('The exclusive end date filter. NextDNS accepts ISO timestamps, Unix timestamps, and relative values such as now.').optional(),
  limit: z.int().min(1).max(500).describe('The maximum number of items to return.').optional(),
  cursor: z.string().min(1).describe('The opaque pagination cursor from a previous response.').optional(),
  device: z.string().min(1).describe('The NextDNS device ID to filter by, or __UNIDENTIFIED__ for unidentified devices.').optional(),
  status: z.enum(['default', 'blocked', 'allowed']).describe('The analytics status to filter by.').optional(),
  root: z.boolean().describe('Whether to aggregate results by root domain.').optional(),
}).describe('The input payload for retrieving NextDNS domain analytics.')

export const getAnalyticsDomainsOutput = z.strictObject({
  data: z.array(z.looseObject({
    id: z.string().describe('The item identifier when returned by NextDNS.').optional(),
    name: z.string().describe('The item display name when returned by NextDNS.').optional(),
    domain: z.string().describe('The domain value when returned by NextDNS.').optional(),
    status: z.string().describe('The status value when returned by NextDNS.').optional(),
    queries: z.int().describe('The query count for this item.').optional(),
  }).describe('One NextDNS analytics item.')).describe('The items returned by NextDNS.'),
  meta: z.looseObject({
    pagination: z.strictObject({
      cursor: z.string().describe('The cursor for the next page of results.').optional(),
    }).describe('The pagination metadata returned by NextDNS.').optional(),
  }).describe('The response metadata returned by NextDNS.').nullable(),
  raw: z.looseObject({}).describe('The raw response returned by NextDNS.'),
}).describe('The response returned when listing NextDNS domain analytics.')

export const getAnalyticsDevicesInput = z.strictObject({
  profileId: z.string().min(1).regex(new RegExp('\\S')).describe('The NextDNS profile ID.'),
  from: z.string().min(1).regex(new RegExp('\\S')).describe('The inclusive start date filter. NextDNS accepts ISO timestamps, Unix timestamps, and relative values such as -7d.').optional(),
  to: z.string().min(1).regex(new RegExp('\\S')).describe('The exclusive end date filter. NextDNS accepts ISO timestamps, Unix timestamps, and relative values such as now.').optional(),
  limit: z.int().min(1).max(500).describe('The maximum number of items to return.').optional(),
  cursor: z.string().min(1).describe('The opaque pagination cursor from a previous response.').optional(),
  device: z.string().min(1).describe('The NextDNS device ID to filter by, or __UNIDENTIFIED__ for unidentified devices.').optional(),
}).describe('The input payload for retrieving NextDNS device analytics.')

export const getAnalyticsDevicesOutput = z.strictObject({
  data: z.array(z.looseObject({
    id: z.string().describe('The item identifier when returned by NextDNS.').optional(),
    name: z.string().describe('The item display name when returned by NextDNS.').optional(),
    domain: z.string().describe('The domain value when returned by NextDNS.').optional(),
    status: z.string().describe('The status value when returned by NextDNS.').optional(),
    queries: z.int().describe('The query count for this item.').optional(),
  }).describe('One NextDNS analytics item.')).describe('The items returned by NextDNS.'),
  meta: z.looseObject({
    pagination: z.strictObject({
      cursor: z.string().describe('The cursor for the next page of results.').optional(),
    }).describe('The pagination metadata returned by NextDNS.').optional(),
  }).describe('The response metadata returned by NextDNS.').nullable(),
  raw: z.looseObject({}).describe('The raw response returned by NextDNS.'),
}).describe('The response returned when listing NextDNS device analytics.')

export const getAnalyticsStatusInput = z.strictObject({
  profileId: z.string().min(1).regex(new RegExp('\\S')).describe('The NextDNS profile ID.'),
  from: z.string().min(1).regex(new RegExp('\\S')).describe('The inclusive start date filter. NextDNS accepts ISO timestamps, Unix timestamps, and relative values such as -7d.').optional(),
  to: z.string().min(1).regex(new RegExp('\\S')).describe('The exclusive end date filter. NextDNS accepts ISO timestamps, Unix timestamps, and relative values such as now.').optional(),
  limit: z.int().min(1).max(500).describe('The maximum number of items to return.').optional(),
  cursor: z.string().min(1).describe('The opaque pagination cursor from a previous response.').optional(),
  device: z.string().min(1).describe('The NextDNS device ID to filter by, or __UNIDENTIFIED__ for unidentified devices.').optional(),
}).describe('The input payload for retrieving NextDNS status analytics.')

export const getAnalyticsStatusOutput = z.strictObject({
  data: z.array(z.looseObject({
    id: z.string().describe('The item identifier when returned by NextDNS.').optional(),
    name: z.string().describe('The item display name when returned by NextDNS.').optional(),
    domain: z.string().describe('The domain value when returned by NextDNS.').optional(),
    status: z.string().describe('The status value when returned by NextDNS.').optional(),
    queries: z.int().describe('The query count for this item.').optional(),
  }).describe('One NextDNS analytics item.')).describe('The items returned by NextDNS.'),
  meta: z.looseObject({
    pagination: z.strictObject({
      cursor: z.string().describe('The cursor for the next page of results.').optional(),
    }).describe('The pagination metadata returned by NextDNS.').optional(),
  }).describe('The response metadata returned by NextDNS.').nullable(),
  raw: z.looseObject({}).describe('The raw response returned by NextDNS.'),
}).describe('The response returned when listing NextDNS status analytics.')

export const getAnalyticsReasonsInput = z.strictObject({
  profileId: z.string().min(1).regex(new RegExp('\\S')).describe('The NextDNS profile ID.'),
  from: z.string().min(1).regex(new RegExp('\\S')).describe('The inclusive start date filter. NextDNS accepts ISO timestamps, Unix timestamps, and relative values such as -7d.').optional(),
  to: z.string().min(1).regex(new RegExp('\\S')).describe('The exclusive end date filter. NextDNS accepts ISO timestamps, Unix timestamps, and relative values such as now.').optional(),
  limit: z.int().min(1).max(500).describe('The maximum number of items to return.').optional(),
  cursor: z.string().min(1).describe('The opaque pagination cursor from a previous response.').optional(),
  device: z.string().min(1).describe('The NextDNS device ID to filter by, or __UNIDENTIFIED__ for unidentified devices.').optional(),
}).describe('The input payload for retrieving NextDNS blocking-reason analytics.')

export const getAnalyticsReasonsOutput = z.strictObject({
  data: z.array(z.looseObject({
    id: z.string().describe('The item identifier when returned by NextDNS.').optional(),
    name: z.string().describe('The item display name when returned by NextDNS.').optional(),
    domain: z.string().describe('The domain value when returned by NextDNS.').optional(),
    status: z.string().describe('The status value when returned by NextDNS.').optional(),
    queries: z.int().describe('The query count for this item.').optional(),
  }).describe('One NextDNS analytics item.')).describe('The items returned by NextDNS.'),
  meta: z.looseObject({
    pagination: z.strictObject({
      cursor: z.string().describe('The cursor for the next page of results.').optional(),
    }).describe('The pagination metadata returned by NextDNS.').optional(),
  }).describe('The response metadata returned by NextDNS.').nullable(),
  raw: z.looseObject({}).describe('The raw response returned by NextDNS.'),
}).describe('The response returned when listing NextDNS blocking-reason analytics.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const nextDnsActions = {
  list_profiles: {
    description: 'List NextDNS profiles available to the authenticated account.',
    effect: 'read',
    inputSchema: listProfilesInput,
    outputSchema: z.toJSONSchema(listProfilesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_profile: {
    description: 'Get one NextDNS profile with its current settings and setup details.',
    effect: 'read',
    inputSchema: getProfileInput,
    outputSchema: z.toJSONSchema(getProfileOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_logs: {
    description: 'List DNS query logs for a NextDNS profile with optional filters.',
    effect: 'read',
    inputSchema: getLogsInput,
    outputSchema: z.toJSONSchema(getLogsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_analytics_domains: {
    description: 'List per-domain DNS query analytics for a NextDNS profile.',
    effect: 'read',
    inputSchema: getAnalyticsDomainsInput,
    outputSchema: z.toJSONSchema(getAnalyticsDomainsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_analytics_devices: {
    description: 'List per-device DNS query analytics for a NextDNS profile.',
    effect: 'read',
    inputSchema: getAnalyticsDevicesInput,
    outputSchema: z.toJSONSchema(getAnalyticsDevicesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_analytics_status: {
    description: 'List DNS query counts grouped by status for a NextDNS profile.',
    effect: 'read',
    inputSchema: getAnalyticsStatusInput,
    outputSchema: z.toJSONSchema(getAnalyticsStatusOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_analytics_reasons: {
    description: 'List DNS query counts grouped by blocking reason for a NextDNS profile.',
    effect: 'read',
    inputSchema: getAnalyticsReasonsInput,
    outputSchema: z.toJSONSchema(getAnalyticsReasonsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
