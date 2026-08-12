/**
 * Genderize 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const predictGenderInput = z.strictObject({
  name: z.string().min(1).describe('The first name or full name string to classify with Genderize.'),
  country_id: z.string().min(2).max(2).regex(new RegExp('^[A-Z]{2}$')).describe('The optional ISO 3166-1 alpha-2 country code used to localize the prediction.').optional(),
}).describe('The input payload for predicting the gender of a single name.')

export const predictGenderOutput = z.strictObject({
  name: z.string().describe('The input name echoed back by Genderize.'),
  gender: z.enum(['male', 'female']).describe('The inferred gender, or null when Genderize has no data for the name.').nullable(),
  probability: z.number().min(0).max(1).describe('The probability score returned by Genderize for the inferred gender.'),
  count: z.int().min(0).describe('The number of data rows Genderize used for the prediction.'),
  country_id: z.string().min(2).max(2).describe('The country code echoed by Genderize when the request was localized.').optional(),
}).describe('A single gender prediction returned by Genderize.')

export const predictGenderBatchInput = z.strictObject({
  names: z.array(z.string().min(1).describe('The first name or full name string to classify with Genderize.')).min(1).max(10).describe('Up to 10 names to classify in one Genderize batch request.'),
  country_id: z.string().min(2).max(2).regex(new RegExp('^[A-Z]{2}$')).describe('The optional ISO 3166-1 alpha-2 country code used to localize the prediction.').optional(),
}).describe('The input payload for predicting the gender of up to 10 names.')

export const predictGenderBatchOutput = z.strictObject({
  predictions: z.array(z.strictObject({
    name: z.string().describe('The input name echoed back by Genderize.'),
    gender: z.enum(['male', 'female']).describe('The inferred gender, or null when Genderize has no data for the name.').nullable(),
    probability: z.number().min(0).max(1).describe('The probability score returned by Genderize for the inferred gender.'),
    count: z.int().min(0).describe('The number of data rows Genderize used for the prediction.'),
    country_id: z.string().min(2).max(2).describe('The country code echoed by Genderize when the request was localized.').optional(),
  }).describe('A single gender prediction returned by Genderize.')).min(1).max(10).describe('The ordered list of gender predictions returned for the requested names.'),
}).describe('The batch prediction result returned by Genderize.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const genderizeActions = {
  predict_gender: {
    description: 'Predict the gender probability for a single name, optionally localized to one country.',
    effect: 'write',
    inputSchema: predictGenderInput,
    outputSchema: z.toJSONSchema(predictGenderOutput, { io: 'output', unrepresentable: 'any' }),
  },
  predict_gender_batch: {
    description: 'Predict the gender probability for up to 10 names in a single request, optionally localized to one country.',
    effect: 'write',
    inputSchema: predictGenderBatchInput,
    outputSchema: z.toJSONSchema(predictGenderBatchOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
