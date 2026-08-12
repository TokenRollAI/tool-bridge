/**
 * LiveSession 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listSessionsInput = z.strictObject({
  page: z.int().min(0).max(10000).describe('The page number to start with. LiveSession defaults to 0.').optional(),
  size: z.int().min(1).max(100).describe('The number of sessions per page. LiveSession defaults to 25.').optional(),
  email: z.email().describe('Filter sessions by the identified visitor email address.').optional(),
  visitorId: z.string().min(1).describe('Filter sessions by LiveSession visitor ID.').optional(),
  timezone: z.string().min(1).describe('IANA timezone used by LiveSession for relative date filters.').optional(),
  dateFrom: z.union([z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp accepted by LiveSession.'), z.enum(['TODAY', 'YESTERDAY', 'BEGINNING_OF_WEEK', 'BEGINNING_OF_MONTH']).describe('A LiveSession relative date shortcut.')]).describe('An ISO 8601 timestamp or LiveSession relative date string.').optional(),
  dateTo: z.union([z.iso.datetime({ offset: true }).describe('An ISO 8601 timestamp accepted by LiveSession.'), z.enum(['TODAY', 'YESTERDAY', 'BEGINNING_OF_WEEK', 'BEGINNING_OF_MONTH']).describe('A LiveSession relative date shortcut.')]).describe('An ISO 8601 timestamp or LiveSession relative date string.').optional(),
}).describe('Query parameters for listing LiveSession sessions.')

export const listSessionsOutput = z.strictObject({
  total: z.int().min(0).describe('Total sessions matching the query.').optional(),
  page: z.strictObject({
    num: z.int().describe('The current LiveSession page number.').optional(),
    size: z.int().describe('The page size used by LiveSession.').optional(),
  }).describe('LiveSession pagination metadata.').optional(),
  sessions: z.array(z.looseObject({
    id: z.string().describe('The LiveSession session identifier.').optional(),
    websiteId: z.string().describe('The website identifier where the session was recorded.').nullable().optional(),
    sessionUrl: z.string().describe('The URL to open the session in the LiveSession dashboard.').nullable().optional(),
    creationTimestamp: z.int().describe('Unix timestamp when the session was created, as returned by LiveSession.').nullable().optional(),
    duration: z.int().describe('Total session duration in seconds when returned.').nullable().optional(),
    device: z.string().describe('Device type reported for the session.').nullable().optional(),
    visitor: z.looseObject({}).describe('Nested LiveSession session data.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw LiveSession session object.').optional(),
  }).describe('A normalized LiveSession session.')).describe('Sessions returned by LiveSession.').optional(),
  raw: z.looseObject({}).describe('The raw LiveSession list sessions response.').optional(),
}).describe('A LiveSession session list response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const livesessionActions = {
  list_sessions: {
    description: 'List LiveSession session replays with pagination and common filters.',
    effect: 'read',
    inputSchema: listSessionsInput,
    outputSchema: z.toJSONSchema(listSessionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
