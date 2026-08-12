/**
 * Wolfram|Alpha 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const validateQueryInput = z.strictObject({
  query: z.string().min(1).describe('Natural-language query or mathematical expression sent to Wolfram|Alpha.'),
  mode: z.enum(['default', 'voice']).describe('Recognizer mode. Use default for general queries or voice for spoken phrasing.').optional(),
}).describe('Input parameters for validating whether Wolfram|Alpha can interpret a query.')

export const validateQueryOutput = z.strictObject({
  query: z.string().describe('Original query sent to the recognizer endpoint.'),
  mode: z.enum(['default', 'voice']).describe('Recognizer mode. Use default for general queries or voice for spoken phrasing.'),
  accepted: z.boolean().describe('Whether Wolfram|Alpha accepted the query.'),
  domain: z.string().describe('Recognized Wolfram|Alpha domain for the query, when available.').nullable(),
  timingMs: z.number().describe('Recognizer timing value returned by Wolfram|Alpha in milliseconds.').nullable(),
  resultSignificanceScore: z.number().describe('Recognizer significance score returned by Wolfram|Alpha, when available.').nullable(),
  spellingCorrection: z.string().describe('Suggested spelling correction returned by Wolfram|Alpha, when available.').nullable(),
  summaryBoxPath: z.string().describe('Summary box path returned by Wolfram|Alpha, when available.').nullable(),
}).describe('Normalized query validation result returned by Wolfram|Alpha.')

export const getShortAnswerInput = z.strictObject({
  query: z.string().min(1).describe('Natural-language query or mathematical expression sent to Wolfram|Alpha.'),
  units: z.enum(['metric', 'imperial']).describe('Measurement system requested by Wolfram|Alpha for unit-sensitive answers.').optional(),
  timeout: z.int().min(1).describe('Maximum processing time in seconds accepted by Wolfram|Alpha.').optional(),
}).describe('Input parameters for retrieving a concise short answer from Wolfram|Alpha.')

export const getShortAnswerOutput = z.strictObject({
  query: z.string().describe('Original query sent to the short answer endpoint.'),
  answer: z.string().describe('Short textual answer returned by Wolfram|Alpha.'),
}).describe('Normalized short answer payload returned by Wolfram|Alpha.')

export const getSpokenResultInput = z.strictObject({
  query: z.string().min(1).describe('Natural-language query or mathematical expression sent to Wolfram|Alpha.'),
  units: z.enum(['metric', 'imperial']).describe('Measurement system requested by Wolfram|Alpha for unit-sensitive answers.').optional(),
  timeout: z.int().min(1).describe('Maximum processing time in seconds accepted by Wolfram|Alpha.').optional(),
}).describe('Input parameters for retrieving a spoken-style result from Wolfram|Alpha.')

export const getSpokenResultOutput = z.strictObject({
  query: z.string().describe('Original query sent to the spoken result endpoint.'),
  result: z.string().describe('Spoken-style text returned by Wolfram|Alpha.'),
}).describe('Normalized spoken result payload returned by Wolfram|Alpha.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const wolframAlphaApiActions = {
  validate_query: {
    description: 'Validate whether Wolfram|Alpha can interpret a query.',
    effect: 'write',
    inputSchema: validateQueryInput,
    outputSchema: z.toJSONSchema(validateQueryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_short_answer: {
    description: 'Get a concise short answer from Wolfram|Alpha.',
    effect: 'read',
    inputSchema: getShortAnswerInput,
    outputSchema: z.toJSONSchema(getShortAnswerOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_spoken_result: {
    description: 'Get a spoken-style single-sentence result from Wolfram|Alpha.',
    effect: 'read',
    inputSchema: getSpokenResultInput,
    outputSchema: z.toJSONSchema(getSpokenResultOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
