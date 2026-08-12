/**
 * Meituan 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const queryTravelInput = z.strictObject({
  query: z.string().min(1).describe('The user\'s travel question or request, including useful details such as dates, origin, destination, budget, and number of travelers.'),
  city: z.string().min(1).describe('The user\'s current city or the city used as context for the travel query. Defaults to Beijing when omitted.').optional(),
  originQuery: z.string().min(1).describe('The complete original user request used for Meituan attribution and analytics. Defaults to query when omitted.').optional(),
}).describe('The input payload for a Meituan Travel natural-language query.')

export const queryTravelOutput = z.strictObject({
  content: z.string().min(1).describe('The Meituan Travel result as Markdown text, which may include recommendations, prices, images, and booking links.'),
}).describe('The normalized result returned by Meituan Travel.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const meituanActions = {
  query_travel: {
    description: 'Query Meituan Travel for flights, trains, hotels, attractions, itineraries, local transportation, and other travel information using natural language. Requests may take up to two minutes, so use a caller timeout longer than 120 seconds.',
    effect: 'write',
    inputSchema: queryTravelInput,
    outputSchema: z.toJSONSchema(queryTravelOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
