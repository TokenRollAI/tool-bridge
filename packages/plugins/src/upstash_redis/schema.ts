/**
 * Upstash Redis 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getInput = z.strictObject({
  key: z.string().min(1).describe('The Redis key.'),
}).describe('The Redis key to retrieve.')

export const getOutput = z.strictObject({
  value: z.string().describe('The stored string value, or null when the key does not exist. Upstash replaces bytes that are not valid UTF-8 with U+FFFD, so only text values round-trip exactly.').nullable(),
}).describe('The value returned for the Redis key.')

export const setInput = z.strictObject({
  key: z.string().min(1).describe('The Redis key.'),
  value: z.string().min(1).describe('The string value stored for the Redis key.'),
  expirationSeconds: z.int().min(1).describe('Expiration time in seconds.').optional(),
  condition: z.enum(['NX', 'XX']).describe('Optional Redis write condition: NX stores only a new key; XX stores only an existing key.').optional(),
}).describe('The Redis string value to store.')

export const setOutput = z.strictObject({
  stored: z.boolean().describe('Whether Redis stored the value. False means the requested condition was not met.'),
}).describe('The result of the Redis SET command.')

export const deleteInput = z.strictObject({
  key: z.string().min(1).describe('The Redis key.'),
}).describe('The Redis key to delete.')

export const deleteOutput = z.strictObject({
  deleted: z.boolean().describe('Whether Redis deleted an existing key.'),
}).describe('The result of the Redis DEL command.')

export const existsInput = z.strictObject({
  key: z.string().min(1).describe('The Redis key.'),
}).describe('The Redis key to check.')

export const existsOutput = z.strictObject({
  exists: z.boolean().describe('Whether the Redis key exists.'),
}).describe('The result of the Redis EXISTS command.')

export const expireInput = z.strictObject({
  key: z.string().min(1).describe('The Redis key.'),
  expirationSeconds: z.int().min(1).describe('Expiration time in seconds.'),
}).describe('The Redis key and its new expiration time.')

export const expireOutput = z.strictObject({
  updated: z.boolean().describe('Whether Redis updated the expiration for an existing key.'),
}).describe('The result of the Redis EXPIRE command.')

export const ttlInput = z.strictObject({
  key: z.string().min(1).describe('The Redis key.'),
}).describe('The Redis key whose expiration to retrieve.')

export const ttlOutput = z.strictObject({
  ttlSeconds: z.int().describe('Remaining expiration in seconds. -2 means the key does not exist; -1 means the key has no expiration.'),
}).describe('The result of the Redis TTL command.')

export const scanInput = z.strictObject({
  cursor: z.string().min(1).describe('The cursor returned by a previous scan. Omit it to start at cursor 0.').optional(),
  match: z.string().min(1).describe('Optional Redis glob pattern used to filter keys.').optional(),
  count: z.int().min(1).max(1000).describe('Optional scan work hint from 1 to 1000.').optional(),
}).describe('Cursor pagination and optional filters for Redis SCAN.')

export const scanOutput = z.strictObject({
  nextCursor: z.string().min(1).describe('Cursor to pass to the next scan request. A value of 0 means scanning is complete.'),
  keys: z.array(z.string().min(1)).describe('Keys returned in this scan page.'),
  complete: z.boolean().describe('Whether this scan reached cursor 0.'),
}).describe('One page returned by Redis SCAN.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const upstashRedisActions = {
  get: {
    description: 'Get the string value stored for one Redis key.',
    effect: 'write',
    inputSchema: getInput,
    outputSchema: z.toJSONSchema(getOutput, { io: 'output', unrepresentable: 'any' }),
  },
  set: {
    description: 'Store a string value for one Redis key, optionally with an expiration or conditional write.',
    effect: 'write',
    inputSchema: setInput,
    outputSchema: z.toJSONSchema(setOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete: {
    description: 'Delete one Redis key.',
    effect: 'write',
    inputSchema: deleteInput,
    outputSchema: z.toJSONSchema(deleteOutput, { io: 'output', unrepresentable: 'any' }),
  },
  exists: {
    description: 'Check whether one Redis key exists.',
    effect: 'write',
    inputSchema: existsInput,
    outputSchema: z.toJSONSchema(existsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  expire: {
    description: 'Set or replace the expiration time for one Redis key.',
    effect: 'write',
    inputSchema: expireInput,
    outputSchema: z.toJSONSchema(expireOutput, { io: 'output', unrepresentable: 'any' }),
  },
  ttl: {
    description: 'Get the remaining expiration time for one Redis key.',
    effect: 'write',
    inputSchema: ttlInput,
    outputSchema: z.toJSONSchema(ttlOutput, { io: 'output', unrepresentable: 'any' }),
  },
  scan: {
    description: 'Scan one page of Redis keys without reading the full keyspace.',
    effect: 'write',
    inputSchema: scanInput,
    outputSchema: z.toJSONSchema(scanOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
