/**
 * L2S 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const shortenUrlInput = z.strictObject({
  url: z.string().min(1).describe('The URL to be shortened or stored in L2S.'),
  customKey: z.string().min(1).describe('Custom key for the shortened URL.').optional(),
  utmSource: z.string().min(1).describe('UTM source parameter.').optional(),
  utmMedium: z.string().min(1).describe('UTM medium parameter.').optional(),
  utmCampaign: z.string().min(1).describe('UTM campaign parameter.').optional(),
  utmTerm: z.string().min(1).describe('UTM term parameter.').optional(),
  utmContent: z.string().min(1).describe('UTM content parameter.').optional(),
  title: z.string().min(1).describe('Title for the shortened URL.').optional(),
  tags: z.array(z.string().min(1).describe('One tag associated with the shortened URL.')).describe('The tags associated with the shortened URL.').optional(),
}).describe('The input payload for creating a shortened URL in L2S.')

export const shortenUrlOutput = z.strictObject({
  ok: z.boolean().describe('Whether the L2S request succeeded.').optional(),
  response: z.strictObject({
    message: z.string().describe('The message returned by L2S.'),
    data: z.looseObject({}).describe('The L2S response data payload.').optional(),
  }).describe('The response envelope returned by L2S.').optional(),
}).describe('The standard L2S success response envelope.')

export const getUrlDetailsInput = z.strictObject({
  id: z.string().min(1).describe('The L2S URL ID path parameter.').optional(),
}).describe('The input payload for retrieving one L2S shortened URL.')

export const getUrlDetailsOutput = z.strictObject({
  ok: z.boolean().describe('Whether the L2S request succeeded.').optional(),
  response: z.strictObject({
    message: z.string().describe('The message returned by L2S.'),
    data: z.looseObject({}).describe('The L2S response data payload.').optional(),
  }).describe('The response envelope returned by L2S.').optional(),
}).describe('The standard L2S success response envelope.')

export const updateUrlDetailsInput = z.strictObject({
  id: z.string().min(1).describe('The L2S URL ID path parameter.'),
  url: z.string().min(1).describe('The URL to be shortened or stored in L2S.'),
  customKey: z.string().min(1).describe('Custom key for the shortened URL.').optional(),
  utmSource: z.string().min(1).describe('UTM source parameter.').optional(),
  utmMedium: z.string().min(1).describe('UTM medium parameter.').optional(),
  utmCampaign: z.string().min(1).describe('UTM campaign parameter.').optional(),
  utmTerm: z.string().min(1).describe('UTM term parameter.').optional(),
  utmContent: z.string().min(1).describe('UTM content parameter.').optional(),
  title: z.string().min(1).describe('Title for the shortened URL.').optional(),
  tags: z.array(z.string().min(1).describe('One tag associated with the shortened URL.')).describe('The tags associated with the shortened URL.').optional(),
}).describe('The input payload for updating one L2S shortened URL.')

export const updateUrlDetailsOutput = z.strictObject({
  ok: z.boolean().describe('Whether the L2S request succeeded.').optional(),
  response: z.strictObject({
    message: z.string().describe('The message returned by L2S.'),
    data: z.looseObject({}).describe('The L2S response data payload.').optional(),
  }).describe('The response envelope returned by L2S.').optional(),
}).describe('The standard L2S success response envelope.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const l2sActions = {
  shorten_url: {
    description: 'Create a shortened URL in L2S with optional custom key, UTM tags, and title.',
    effect: 'write',
    inputSchema: shortenUrlInput,
    outputSchema: z.toJSONSchema(shortenUrlOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_url_details: {
    description: 'Get the stored details for one shortened URL in L2S.',
    effect: 'read',
    inputSchema: getUrlDetailsInput,
    outputSchema: z.toJSONSchema(getUrlDetailsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_url_details: {
    description: 'Update the stored details for one shortened URL in L2S.',
    effect: 'write',
    inputSchema: updateUrlDetailsInput,
    outputSchema: z.toJSONSchema(updateUrlDetailsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
