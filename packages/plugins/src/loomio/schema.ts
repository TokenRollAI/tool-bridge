/**
 * Loomio 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listPollsInput = z.strictObject({
  groupId: z.int().min(1).describe('Group identifier to list polls from.'),
  status: z.enum(['active', 'closed', 'all']).describe('Poll status filter accepted by Loomio.').optional(),
  limit: z.int().min(1).max(200).describe('Maximum number of polls to return.').optional(),
  offset: z.int().min(0).describe('Zero-based offset for poll pagination.').optional(),
}).describe('Input parameters for listing Loomio polls in one group.')

export const listPollsOutput = z.strictObject({
  polls: z.array(z.looseObject({
    id: z.int().min(1).describe('Unique poll identifier returned by Loomio.'),
    key: z.string().describe('Poll key returned by Loomio when available.').nullable().optional(),
    title: z.string().describe('Poll title returned by Loomio when available.').nullable().optional(),
    pollType: z.string().describe('Poll type returned by Loomio when available.').nullable().optional(),
    groupId: z.int().describe('Group identifier attached to the poll when available.').nullable().optional(),
    authorId: z.int().describe('Author identifier attached to the poll when available.').nullable().optional(),
    discussionId: z.int().describe('Discussion identifier attached to the poll when available.').nullable().optional(),
    createdAt: z.string().describe('Poll creation timestamp returned by Loomio when available.').nullable().optional(),
    closingAt: z.string().describe('Poll closing timestamp returned by Loomio when available.').nullable().optional(),
    closedAt: z.string().describe('Poll closed timestamp returned by Loomio when available.').nullable().optional(),
    currentOutcome: z.looseObject({}).describe('Raw Loomio API object.').nullable().optional(),
    raw: z.looseObject({}).describe('Raw Loomio API object.').optional(),
  }).describe('Summary of one Loomio poll returned by the list endpoint.')).describe('Polls returned by Loomio.').optional(),
  total: z.int().min(0).describe('Total number of polls matching the filter.').optional(),
  rawMeta: z.looseObject({}).describe('Raw Loomio API object.').nullable().optional(),
}).describe('Loomio poll list response.')

export const getPollInput = z.strictObject({
  pollIdOrKey: z.string().min(1).describe('Numeric poll ID or poll key to retrieve.').optional(),
}).describe('Input parameters for getting one Loomio poll.')

export const getPollOutput = z.strictObject({
  poll: z.looseObject({
    id: z.int().min(1).describe('Unique poll identifier returned by Loomio.'),
    key: z.string().describe('Poll key returned by Loomio when available.').nullable().optional(),
    title: z.string().describe('Poll title returned by Loomio when available.').nullable().optional(),
    pollType: z.string().describe('Poll type returned by Loomio when available.').nullable().optional(),
    groupId: z.int().describe('Group identifier attached to the poll when available.').nullable().optional(),
    authorId: z.int().describe('Author identifier attached to the poll when available.').nullable().optional(),
    discussionId: z.int().describe('Discussion identifier attached to the poll when available.').nullable().optional(),
    createdAt: z.string().describe('Poll creation timestamp returned by Loomio when available.').nullable().optional(),
    closingAt: z.string().describe('Poll closing timestamp returned by Loomio when available.').nullable().optional(),
    closedAt: z.string().describe('Poll closed timestamp returned by Loomio when available.').nullable().optional(),
    currentOutcome: z.looseObject({}).describe('Raw Loomio API object.').nullable().optional(),
    raw: z.looseObject({}).describe('Raw Loomio API object.').optional(),
    status: z.string().describe('Poll status returned by Loomio when available.').nullable().optional(),
    details: z.string().describe('Poll details body returned by Loomio when available.').nullable().optional(),
    options: z.array(z.looseObject({
      id: z.int().min(1).describe('Unique option identifier returned by Loomio.'),
      name: z.string().describe('Display name of the poll option when Loomio returns it.').nullable().optional(),
      priority: z.int().describe('Display order priority of the poll option when Loomio returns it.').nullable().optional(),
      icon: z.string().describe('Icon identifier returned by Loomio for the poll option.').nullable().optional(),
      color: z.string().describe('Color value returned by Loomio for the poll option.').nullable().optional(),
      prompt: z.string().describe('Prompt text returned by Loomio for the poll option.').nullable().optional(),
      meaning: z.string().describe('Meaning text returned by Loomio for the poll option.').nullable().optional(),
      raw: z.looseObject({}).describe('Raw Loomio API object.').optional(),
    }).describe('One Loomio poll option returned by the poll detail endpoint.')).describe('Poll options returned by Loomio.').optional(),
  }).describe('Detailed Loomio poll payload returned by the show endpoint.').optional(),
}).describe('Single Loomio poll response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const loomioActions = {
  list_polls: {
    description: 'List Loomio polls in one group with optional status filtering and offset pagination.',
    effect: 'read',
    inputSchema: listPollsInput,
    outputSchema: z.toJSONSchema(listPollsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_poll: {
    description: 'Get one Loomio poll by numeric ID or poll key.',
    effect: 'read',
    inputSchema: getPollInput,
    outputSchema: z.toJSONSchema(getPollOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
