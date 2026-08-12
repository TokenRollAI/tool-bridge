/**
 * LogSnag 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const publishEventInput = z.strictObject({
  project: z.string().min(1).describe('The LogSnag project name.'),
  channel: z.string().min(1).describe('The LogSnag channel name.'),
  event: z.string().min(1).describe('The event name.'),
  description: z.string().describe('The optional event description.').optional(),
  icon: z.string().describe('The optional emoji or emoji shortcode shown with the event.').optional(),
  notify: z.boolean().describe('Whether LogSnag should send a push notification.').optional(),
  tags: z.record(z.string(), z.union([z.string().describe('A string value.'), z.number().describe('A numeric value.'), z.boolean().describe('A boolean value.')]).describe('A string, number, or boolean value accepted by LogSnag.')).describe('A LogSnag key-value object.').optional(),
  parser: z.enum(['markdown', 'text']).describe('The parser LogSnag should apply to the description.').optional(),
  user_id: z.string().describe('The optional user identifier associated with the event.').optional(),
  timestamp: z.number().describe('The optional Unix timestamp in seconds for historical events.').optional(),
}).describe('The payload for publishing a LogSnag event.')

export const publishEventOutput = z.strictObject({
  ok: z.boolean().describe('Whether LogSnag accepted the request.'),
  status: z.int().describe('The upstream HTTP status code returned by LogSnag.'),
  payload: z.unknown().describe('The parsed JSON response body returned by LogSnag, when present.').optional(),
}).describe('The result returned after LogSnag accepts the request.')

export const identifyUserInput = z.strictObject({
  project: z.string().min(1).describe('The LogSnag project name.'),
  user_id: z.string().min(1).describe('The user identifier to update.'),
  properties: z.record(z.string(), z.union([z.string().describe('A string value.'), z.number().describe('A numeric value.'), z.boolean().describe('A boolean value.')]).describe('A string, number, or boolean value accepted by LogSnag.')).describe('A LogSnag key-value object.'),
}).describe('The payload for updating a LogSnag user profile.')

export const identifyUserOutput = z.strictObject({
  ok: z.boolean().describe('Whether LogSnag accepted the request.'),
  status: z.int().describe('The upstream HTTP status code returned by LogSnag.'),
  payload: z.unknown().describe('The parsed JSON response body returned by LogSnag, when present.').optional(),
}).describe('The result returned after LogSnag accepts the request.')

export const publishInsightInput = z.strictObject({
  project: z.string().min(1).describe('The LogSnag project name.'),
  title: z.string().min(1).describe('The insight title.'),
  value: z.union([z.string().describe('A string insight value.'), z.number().describe('A numeric insight value.')]).describe('The insight value.'),
  icon: z.string().describe('The optional emoji or emoji shortcode shown with the insight.').optional(),
}).describe('The payload for publishing a LogSnag insight value.')

export const publishInsightOutput = z.strictObject({
  ok: z.boolean().describe('Whether LogSnag accepted the request.'),
  status: z.int().describe('The upstream HTTP status code returned by LogSnag.'),
  payload: z.unknown().describe('The parsed JSON response body returned by LogSnag, when present.').optional(),
}).describe('The result returned after LogSnag accepts the request.')

export const mutateInsightInput = z.strictObject({
  project: z.string().min(1).describe('The LogSnag project name.'),
  title: z.string().min(1).describe('The insight title.'),
  value: z.strictObject({
    $inc: z.number().describe('The numeric amount to increment or decrement the insight value by.'),
  }).describe('The LogSnag mutation object.'),
  icon: z.string().describe('The optional emoji or emoji shortcode shown with the insight.').optional(),
}).describe('The payload for mutating a numeric LogSnag insight.')

export const mutateInsightOutput = z.strictObject({
  ok: z.boolean().describe('Whether LogSnag accepted the request.'),
  status: z.int().describe('The upstream HTTP status code returned by LogSnag.'),
  payload: z.unknown().describe('The parsed JSON response body returned by LogSnag, when present.').optional(),
}).describe('The result returned after LogSnag accepts the request.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const logsnagActions = {
  publish_event: {
    description: 'Publish an event to a LogSnag project channel.',
    effect: 'write',
    inputSchema: publishEventInput,
    outputSchema: z.toJSONSchema(publishEventOutput, { io: 'output', unrepresentable: 'any' }),
  },
  identify_user: {
    description: 'Add or update key-value properties on a LogSnag user profile.',
    effect: 'read',
    inputSchema: identifyUserInput,
    outputSchema: z.toJSONSchema(identifyUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  publish_insight: {
    description: 'Publish the latest value for a LogSnag real-time insight.',
    effect: 'write',
    inputSchema: publishInsightInput,
    outputSchema: z.toJSONSchema(publishInsightOutput, { io: 'output', unrepresentable: 'any' }),
  },
  mutate_insight: {
    description: 'Increment or decrement an existing numeric LogSnag insight.',
    effect: 'write',
    inputSchema: mutateInsightInput,
    outputSchema: z.toJSONSchema(mutateInsightOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
