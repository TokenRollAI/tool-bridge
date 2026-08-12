/**
 * OpenRouter `create_coinbase_charge` 的手写 schema。
 *
 * 为什么不走生成:`chain_id` 是 `oneOf` 三个字面量常量(1 / 137 / 8453),**每个分支各带
 * 自己的 description**(链名)。Zod 侧写成 `z.union([z.literal(1), …])` 反推回 JSON Schema
 * 时分支级 description 会丢,等价闸门因此红(见 handwritten.json)。
 *
 * 手写在这里,把链名保留成可读的语义标注 —— `~help` 的消费方是 agent,
 * "8453 是 Base"这种信息正是它需要而无从推断的。
 */

import { z } from 'zod/v4'

export const createCoinbaseChargeInput = z.strictObject({
  amount: z.number().gt(0).describe('The USD amount to top up.'),
  sender: z.string().min(1).describe('The wallet address that initiated the payment.'),
  chain_id: z.union([
    z.literal(1).describe('Ethereum mainnet.'),
    z.literal(137).describe('Polygon.'),
    z.literal(8453).describe('Base.'),
  ]).describe('The chain ID used to initiate the payment.'),
  httpReferer: z.string().describe(
    'The application URL sent in the HTTP-Referer header for OpenRouter attribution and analytics.',
  ).optional(),
  xTitle: z.string().describe(
    'The application display name sent in the X-Title header for OpenRouter console display.',
  ).optional(),
}).describe('Input parameters when creating a Coinbase deposit order.')

export const createCoinbaseChargeOutput = z.strictObject({
  data: z.looseObject({}).describe('A JSON object returned by OpenRouter.').optional(),
}).describe('Returns the standard response for Coinbase charge results.')
